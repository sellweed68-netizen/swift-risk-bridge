ALTER TABLE public.account_health
  ADD COLUMN IF NOT EXISTS session_epoch bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_instance_id text,
  ADD COLUMN IF NOT EXISTS last_init_nonce text,
  ADD COLUMN IF NOT EXISTS last_positions_seq bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_positions_snapshot_at timestamptz,
  ADD COLUMN IF NOT EXISTS positions_count integer,
  ADD COLUMN IF NOT EXISTS positions_reported_total integer,
  ADD COLUMN IF NOT EXISTS snapshot_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS snapshot_reject_reason text,
  ADD COLUMN IF NOT EXISTS snapshot_checked_at timestamptz;

COMMENT ON COLUMN public.account_health.last_positions_snapshot_at IS 'Server time of the last VERIFIED complete position snapshot. Never advanced by heartbeats or rejected snapshots.';
COMMENT ON COLUMN public.account_health.snapshot_status IS 'none | verified | rejected — outcome of the most recent snapshot evaluation.';

CREATE OR REPLACE FUNCTION public.connector_ingest(p_token text, p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  t record; a record; h record; q jsonb; p jsonb; s jsonb;
  v_count int := 0; v_pos int := 0; v_closed int := 0; v_first boolean; v_order uuid;
  v_tickets text[] := '{}'; v_epoch bigint; v_seq bigint; v_n int; v_reason text := NULL;
  v_inst text; v_nonce text; v_fresh boolean; v_snapshot text := 'absent';
BEGIN
  SELECT * INTO t FROM public.connector_tokens
   WHERE token_hash = encode(digest(p_token,'sha256'),'hex') AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN'); END IF;
  SELECT * INTO a FROM public.broker_accounts WHERE id = t.account_id;
  IF a.status = 'archived' THEN RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_ARCHIVED'); END IF;
  IF p_payload->>'login' IS NOT NULL AND p_payload->>'login' <> a.mt5_login THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LOGIN_MISMATCH');
  END IF;

  v_first := NOT EXISTS (SELECT 1 FROM public.account_health WHERE account_id = a.id);
  -- Ensure a row exists, then serialize every request for this account on it.
  INSERT INTO public.account_health (user_id, account_id, last_heartbeat_at, terminal_connected, trade_allowed, updated_at)
  VALUES (a.user_id, a.id, to_timestamp(0), false, false, now())
  ON CONFLICT (account_id) DO NOTHING;
  SELECT * INTO h FROM public.account_health WHERE account_id = a.id FOR UPDATE;

  -- ---------- SESSION_INIT (server-controlled epoch fencing) ----------
  IF p_payload->>'action' = 'session_init' THEN
    v_inst := p_payload->>'instance_id'; v_nonce := p_payload->>'nonce';
    IF v_inst IS NULL OR v_nonce IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'BAD_INIT'); END IF;
    UPDATE public.connector_tokens SET last_used_at = now() WHERE id = t.id;
    IF h.active_instance_id = v_inst AND h.last_init_nonce = v_nonce THEN
      RETURN jsonb_build_object('ok', true, 'session_epoch', h.session_epoch, 'duplicate', true);
    END IF;
    v_fresh := h.last_heartbeat_at > now() - interval '15 seconds';
    IF h.active_instance_id IS NOT NULL AND h.active_instance_id <> v_inst AND v_fresh THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ACTIVE_SESSION_EXISTS');
    END IF;
    UPDATE public.account_health SET session_epoch = session_epoch + 1, active_instance_id = v_inst,
      last_init_nonce = v_nonce, last_positions_seq = 0, last_positions_snapshot_at = NULL,
      snapshot_status = 'none', snapshot_reject_reason = NULL, updated_at = now()
     WHERE account_id = a.id RETURNING session_epoch INTO v_epoch;
    INSERT INTO public.audit_log(user_id, actor_id, action, entity, details)
    VALUES (a.user_id, NULL, 'CONNECTOR_SESSION_STARTED', 'account_health',
      jsonb_build_object('account_id', a.id, 'session_epoch', v_epoch,
        'takeover', h.active_instance_id IS NOT NULL AND h.active_instance_id <> v_inst));
    RETURN jsonb_build_object('ok', true, 'session_epoch', v_epoch);
  END IF;

  -- ---------- Fencing for regular reports ----------
  IF p_payload ? 'session_epoch' THEN
    v_epoch := (p_payload->>'session_epoch')::bigint;
    IF v_epoch <> h.session_epoch OR h.active_instance_id IS DISTINCT FROM p_payload->>'instance_id' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'STALE_SESSION', 'session_epoch', h.session_epoch);
    END IF;
  ELSIF h.session_epoch > 0 THEN
    -- A fenced session exists; an unfenced (legacy) sender may not write anything.
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_REQUIRED');
  END IF;

  UPDATE public.connector_tokens SET last_used_at = now() WHERE id = t.id;
  UPDATE public.account_health SET last_heartbeat_at = now(), ea_version = p_payload->>'ea_version',
    terminal_connected = COALESCE((p_payload->>'terminal_connected')::boolean, false),
    trade_allowed = COALESCE((p_payload->>'trade_allowed')::boolean, false),
    reported_login = p_payload->>'login', balance = (p_payload->>'balance')::numeric,
    equity = (p_payload->>'equity')::numeric, margin_free = (p_payload->>'margin_free')::numeric,
    broker_server_time = (p_payload->>'server_time')::timestamptz, updated_at = now()
   WHERE account_id = a.id;

  FOR q IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'quotes','[]'::jsonb)) LOOP
    INSERT INTO public.market_quotes AS m (user_id, account_id, broker_symbol, canonical_symbol, bid, ask,
      spread_points, digits, tick_time, received_at)
    VALUES (a.user_id, a.id, q->>'symbol',
      COALESCE((SELECT canonical_symbol FROM public.symbol_aliases sa
                 WHERE sa.user_id = a.user_id AND sa.broker_id = a.broker_id AND sa.broker_symbol = q->>'symbol' LIMIT 1),
               upper(q->>'symbol')),
      (q->>'bid')::numeric, (q->>'ask')::numeric, (q->>'spread')::int, (q->>'digits')::int,
      (q->>'time')::timestamptz, now())
    ON CONFLICT (account_id, broker_symbol) DO UPDATE SET
      canonical_symbol = EXCLUDED.canonical_symbol, bid = EXCLUDED.bid, ask = EXCLUDED.ask,
      spread_points = EXCLUDED.spread_points, digits = EXCLUDED.digits,
      tick_time = EXCLUDED.tick_time, received_at = now()
    WHERE m.tick_time <= EXCLUDED.tick_time;
    v_count := v_count + 1;
  END LOOP;

  -- ---------- Position snapshot: only a verified complete snapshot touches broker_positions ----------
  IF p_payload ? 'positions' AND NOT (p_payload ? 'snapshot') THEN
    v_snapshot := 'rejected'; v_reason := 'LEGACY_UNVERIFIED';
  ELSIF p_payload ? 'snapshot' THEN
    s := p_payload->'snapshot';
    IF v_epoch IS NULL THEN v_reason := 'NO_SESSION';
    ELSIF jsonb_typeof(s->'seq') <> 'number' OR jsonb_typeof(s->'items') <> 'array' THEN v_reason := 'MALFORMED';
    ELSE
      v_seq := (s->>'seq')::bigint;
      IF v_seq = h.last_positions_seq THEN v_snapshot := 'duplicate';
      ELSIF v_seq < h.last_positions_seq THEN v_snapshot := 'out_of_order';
      ELSE
        v_n := jsonb_array_length(s->'items');
        IF COALESCE((s->>'truncated')::boolean, true) THEN v_reason := 'TRUNCATED';
        ELSIF COALESCE((s->>'skipped')::int, -1) <> 0 THEN v_reason := 'ENUMERATION_SKIPPED';
        ELSIF (s->>'total_start') IS NULL OR (s->>'total_end') IS NULL
              OR (s->>'total_start')::int <> (s->>'total_end')::int THEN v_reason := 'ENUMERATION_RACE';
        ELSIF (s->>'total_start')::int <> v_n THEN v_reason := 'COUNT_MISMATCH';
        ELSIF v_n > 150 THEN v_reason := 'TOO_MANY';
        ELSIF (SELECT count(DISTINCT e->>'ticket') FROM jsonb_array_elements(s->'items') e WHERE e->>'ticket' IS NOT NULL) <> v_n
          THEN v_reason := 'DUPLICATE_TICKETS';
        END IF;

        IF v_reason IS NULL THEN
          FOR p IN SELECT * FROM jsonb_array_elements(s->'items') LOOP
            v_tickets := v_tickets || (p->>'ticket');
            v_order := NULL;
            IF left(COALESCE(p->>'comment',''), 4) = 'NXR:' THEN
              SELECT id INTO v_order FROM public.execution_orders
               WHERE account_id = a.id AND id::text LIKE substr(p->>'comment', 5) || '%' LIMIT 1;
            END IF;
            INSERT INTO public.broker_positions AS bp (user_id, account_id, broker_ticket, broker_symbol, canonical_symbol, direction,
              volume, open_price, current_price, stop_loss, take_profit, swap, profit, comment, order_id, origin, opened_at, last_seen_at)
            VALUES (a.user_id, a.id, p->>'ticket', p->>'symbol',
              COALESCE((SELECT canonical_symbol FROM public.symbol_aliases sa
                         WHERE sa.user_id = a.user_id AND sa.broker_id = a.broker_id AND sa.broker_symbol = p->>'symbol' LIMIT 1),
                       upper(p->>'symbol')),
              p->>'type', (p->>'volume')::numeric, (p->>'open_price')::numeric, NULLIF(p->>'price','')::numeric,
              NULLIF((p->>'sl')::numeric, 0), NULLIF((p->>'tp')::numeric, 0), (p->>'swap')::numeric, (p->>'profit')::numeric,
              left(p->>'comment', 64), v_order, CASE WHEN v_order IS NULL THEN 'manual' ELSE 'nexora' END,
              (p->>'open_time')::timestamptz, now())
            ON CONFLICT (account_id, broker_ticket) DO UPDATE SET
              volume = EXCLUDED.volume, current_price = EXCLUDED.current_price, stop_loss = EXCLUDED.stop_loss,
              take_profit = EXCLUDED.take_profit, swap = EXCLUDED.swap, profit = EXCLUDED.profit,
              status = 'open', closed_at = NULL, last_seen_at = now();
            v_pos := v_pos + 1;
          END LOOP;
          UPDATE public.broker_positions SET status = 'closed', closed_at = now()
           WHERE account_id = a.id AND user_id = a.user_id AND status = 'open' AND NOT (broker_ticket = ANY(v_tickets));
          GET DIAGNOSTICS v_closed = ROW_COUNT;
          UPDATE public.account_health SET last_positions_seq = v_seq, last_positions_snapshot_at = now(),
            positions_count = v_n, positions_reported_total = v_n, snapshot_status = 'verified',
            snapshot_reject_reason = NULL, snapshot_checked_at = now()
           WHERE account_id = a.id;
          v_snapshot := 'verified';
        ELSE
          -- In-order but unverified: advance seq only (blocks older replays); verified state untouched.
          UPDATE public.account_health SET last_positions_seq = v_seq,
            positions_reported_total = NULLIF(s->>'total_start','')::int
           WHERE account_id = a.id;
        END IF;
      END IF;
    END IF;
    IF v_reason IS NOT NULL THEN v_snapshot := 'rejected'; END IF;
  END IF;

  IF v_snapshot = 'rejected' THEN
    UPDATE public.account_health SET snapshot_status = 'rejected', snapshot_reject_reason = v_reason,
      snapshot_checked_at = now() WHERE account_id = a.id;
  END IF;

  IF v_first THEN
    INSERT INTO public.audit_log(user_id, actor_id, action, entity, details)
    VALUES (a.user_id, NULL, 'CONNECTOR_FIRST_HEARTBEAT', 'account_health',
      jsonb_build_object('account_id', a.id, 'ea_version', p_payload->>'ea_version'));
  END IF;
  RETURN jsonb_build_object('ok', true, 'quotes', v_count, 'positions', v_pos, 'closed', v_closed,
    'snapshot', v_snapshot, 'reason', v_reason, 'account_status', a.status);
END $function$;

REVOKE ALL ON FUNCTION public.connector_ingest(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connector_ingest(text, jsonb) TO service_role;