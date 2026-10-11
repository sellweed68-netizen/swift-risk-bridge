CREATE TABLE public.broker_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.broker_accounts(id),
  broker_ticket text NOT NULL,
  broker_symbol text NOT NULL,
  canonical_symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY','SELL')),
  volume numeric NOT NULL,
  open_price numeric NOT NULL,
  current_price numeric,
  stop_loss numeric,
  take_profit numeric,
  swap numeric,
  profit numeric,
  comment text,
  order_id uuid REFERENCES public.execution_orders(id),
  origin text NOT NULL DEFAULT 'manual' CHECK (origin IN ('nexora','manual')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at timestamptz,
  closed_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, broker_ticket)
);
GRANT SELECT ON public.broker_positions TO authenticated;
GRANT ALL ON public.broker_positions TO service_role;
ALTER TABLE public.broker_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own positions read" ON public.broker_positions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin read positions" ON public.broker_positions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX broker_positions_open_idx ON public.broker_positions(account_id) WHERE status = 'open';

CREATE OR REPLACE FUNCTION public.position_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(user_id, actor_id, action, entity, details)
    VALUES (NEW.user_id, NULL, CASE WHEN NEW.origin='manual' THEN 'POSITION_OPENED_MANUAL' ELSE 'POSITION_OPENED' END, 'broker_positions',
      jsonb_build_object('ticket', NEW.broker_ticket, 'symbol', NEW.broker_symbol, 'direction', NEW.direction, 'volume', NEW.volume, 'order_id', NEW.order_id));
  ELSIF NEW.status = 'closed' AND OLD.status = 'open' THEN
    INSERT INTO public.audit_log(user_id, actor_id, action, entity, details)
    VALUES (NEW.user_id, NULL, 'POSITION_CLOSED', 'broker_positions',
      jsonb_build_object('ticket', NEW.broker_ticket, 'symbol', NEW.broker_symbol, 'last_profit', NEW.profit));
  ELSIF NEW.stop_loss IS DISTINCT FROM OLD.stop_loss OR NEW.take_profit IS DISTINCT FROM OLD.take_profit THEN
    INSERT INTO public.audit_log(user_id, actor_id, action, entity, details)
    VALUES (NEW.user_id, NULL, 'POSITION_LEVELS_CHANGED', 'broker_positions',
      jsonb_build_object('ticket', NEW.broker_ticket, 'from_sl', OLD.stop_loss, 'to_sl', NEW.stop_loss, 'from_tp', OLD.take_profit, 'to_tp', NEW.take_profit));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER broker_positions_audit AFTER INSERT OR UPDATE ON public.broker_positions FOR EACH ROW EXECUTE FUNCTION public.position_audit();

CREATE OR REPLACE FUNCTION public.connector_ingest(p_token text, p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  t record; a record; q jsonb; p jsonb; v_count int := 0; v_pos int := 0; v_first boolean; v_order uuid; v_tickets text[] := '{}';
BEGIN
  SELECT * INTO t FROM public.connector_tokens
   WHERE token_hash = encode(digest(p_token,'sha256'),'hex') AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN'); END IF;
  SELECT * INTO a FROM public.broker_accounts WHERE id = t.account_id;
  IF a.status = 'archived' THEN RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_ARCHIVED'); END IF;
  IF p_payload->>'login' IS NOT NULL AND p_payload->>'login' <> a.mt5_login THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LOGIN_MISMATCH');
  END IF;

  UPDATE public.connector_tokens SET last_used_at = now() WHERE id = t.id;
  v_first := NOT EXISTS (SELECT 1 FROM public.account_health WHERE account_id = a.id);

  INSERT INTO public.account_health AS h (user_id, account_id, last_heartbeat_at, ea_version, terminal_connected,
    trade_allowed, reported_login, balance, equity, margin_free, broker_server_time, updated_at)
  VALUES (a.user_id, a.id, now(), p_payload->>'ea_version',
    COALESCE((p_payload->>'terminal_connected')::boolean, false),
    COALESCE((p_payload->>'trade_allowed')::boolean, false),
    p_payload->>'login', (p_payload->>'balance')::numeric, (p_payload->>'equity')::numeric,
    (p_payload->>'margin_free')::numeric, (p_payload->>'server_time')::timestamptz, now())
  ON CONFLICT (account_id) DO UPDATE SET
    last_heartbeat_at = now(), ea_version = EXCLUDED.ea_version,
    terminal_connected = EXCLUDED.terminal_connected, trade_allowed = EXCLUDED.trade_allowed,
    reported_login = EXCLUDED.reported_login, balance = EXCLUDED.balance, equity = EXCLUDED.equity,
    margin_free = EXCLUDED.margin_free, broker_server_time = EXCLUDED.broker_server_time, updated_at = now();

  FOR q IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'quotes','[]'::jsonb)) LOOP
    INSERT INTO public.market_quotes AS m (user_id, account_id, broker_symbol, canonical_symbol, bid, ask,
      spread_points, digits, tick_time, received_at)
    VALUES (a.user_id, a.id, q->>'symbol',
      COALESCE((SELECT canonical_symbol FROM public.symbol_aliases s
                 WHERE s.user_id = a.user_id AND s.broker_id = a.broker_id AND s.broker_symbol = q->>'symbol' LIMIT 1),
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

  -- Positions: only reconciled when the EA reports the key (older EAs omit it => nothing is closed).
  IF p_payload ? 'positions' THEN
    FOR p IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'positions','[]'::jsonb)) LOOP
      v_tickets := v_tickets || (p->>'ticket');
      v_order := NULL;
      IF left(COALESCE(p->>'comment',''), 4) = 'NXR:' THEN
        SELECT id INTO v_order FROM public.execution_orders
         WHERE account_id = a.id AND id::text LIKE substr(p->>'comment', 5) || '%' LIMIT 1;
      END IF;
      INSERT INTO public.broker_positions AS bp (user_id, account_id, broker_ticket, broker_symbol, canonical_symbol, direction,
        volume, open_price, current_price, stop_loss, take_profit, swap, profit, comment, order_id, origin, opened_at, last_seen_at)
      VALUES (a.user_id, a.id, p->>'ticket', p->>'symbol',
        COALESCE((SELECT canonical_symbol FROM public.symbol_aliases s
                   WHERE s.user_id = a.user_id AND s.broker_id = a.broker_id AND s.broker_symbol = p->>'symbol' LIMIT 1),
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
     WHERE account_id = a.id AND status = 'open' AND NOT (broker_ticket = ANY(v_tickets));
  END IF;

  IF v_first THEN
    INSERT INTO public.audit_log(user_id, actor_id, action, entity, details)
    VALUES (a.user_id, NULL, 'CONNECTOR_FIRST_HEARTBEAT', 'account_health',
      jsonb_build_object('account_id', a.id, 'ea_version', p_payload->>'ea_version'));
  END IF;
  RETURN jsonb_build_object('ok', true, 'quotes', v_count, 'positions', v_pos, 'account_status', a.status);
END $function$;