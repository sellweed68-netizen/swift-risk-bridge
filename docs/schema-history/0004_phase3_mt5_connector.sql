CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Connector tokens: one active per account; only a SHA-256 hash is stored.
CREATE TABLE public.connector_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.broker_accounts(id),
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX connector_tokens_one_active ON public.connector_tokens(account_id) WHERE revoked_at IS NULL;
GRANT SELECT (id, user_id, account_id, token_prefix, created_at, last_used_at, revoked_at) ON public.connector_tokens TO authenticated;
GRANT ALL ON public.connector_tokens TO service_role;
ALTER TABLE public.connector_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tokens read" ON public.connector_tokens FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin read all tokens" ON public.connector_tokens FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Latest heartbeat + account snapshot per account (written only by the ingest function).
CREATE TABLE public.account_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid NOT NULL UNIQUE REFERENCES public.broker_accounts(id),
  last_heartbeat_at timestamptz NOT NULL,
  ea_version text,
  terminal_connected boolean NOT NULL DEFAULT false,
  trade_allowed boolean NOT NULL DEFAULT false,
  reported_login text,
  balance numeric,
  equity numeric,
  margin_free numeric,
  broker_server_time timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.account_health TO authenticated;
GRANT ALL ON public.account_health TO service_role;
ALTER TABLE public.account_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own health read" ON public.account_health FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin read all health" ON public.account_health FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Latest quote per account+broker symbol (no permanent raw tick storage).
CREATE TABLE public.market_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.broker_accounts(id),
  broker_symbol text NOT NULL,
  canonical_symbol text NOT NULL,
  bid numeric NOT NULL CHECK (bid > 0),
  ask numeric NOT NULL CHECK (ask > 0),
  spread_points integer NOT NULL CHECK (spread_points >= 0),
  digits integer,
  tick_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, broker_symbol)
);
GRANT SELECT ON public.market_quotes TO authenticated;
GRANT ALL ON public.market_quotes TO service_role;
ALTER TABLE public.market_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own quotes read" ON public.market_quotes FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin read all quotes" ON public.market_quotes FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Issue a token for the caller's own account. Revokes the previous one. Returns plaintext once.
CREATE OR REPLACE FUNCTION public.issue_connector_token(p_account_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_token text; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid,'viewer') THEN RAISE EXCEPTION 'permission denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.broker_accounts WHERE id = p_account_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'OWNER_MISMATCH: account not found for this user';
  END IF;
  UPDATE public.connector_tokens SET revoked_at = now() WHERE account_id = p_account_id AND revoked_at IS NULL;
  v_token := 'nxr_' || encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.connector_tokens(user_id, account_id, token_hash, token_prefix)
  VALUES (v_uid, p_account_id, encode(digest(v_token,'sha256'),'hex'), left(v_token, 10));
  INSERT INTO public.audit_log(user_id, actor_id, action, entity, details)
  VALUES (v_uid, v_uid, 'CONNECTOR_TOKEN_ISSUED', 'connector_tokens', jsonb_build_object('account_id', p_account_id, 'prefix', left(v_token,10)));
  RETURN v_token;
END $$;
REVOKE ALL ON FUNCTION public.issue_connector_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_connector_token(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_connector_token(p_account_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid,'viewer') THEN RAISE EXCEPTION 'permission denied'; END IF;
  UPDATE public.connector_tokens SET revoked_at = now()
   WHERE account_id = p_account_id AND user_id = v_uid AND revoked_at IS NULL;
  IF FOUND THEN
    INSERT INTO public.audit_log(user_id, actor_id, action, entity, details)
    VALUES (v_uid, v_uid, 'CONNECTOR_TOKEN_REVOKED', 'connector_tokens', jsonb_build_object('account_id', p_account_id));
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.revoke_connector_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_connector_token(uuid) TO authenticated;

-- Ingest from the EA. Called only by the server with service_role after payload validation.
CREATE OR REPLACE FUNCTION public.connector_ingest(p_token text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  t record; a record; q jsonb; v_count int := 0; v_first boolean;
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
    WHERE m.tick_time <= EXCLUDED.tick_time;  -- never let an older tick overwrite a newer one
    v_count := v_count + 1;
  END LOOP;

  IF v_first THEN
    INSERT INTO public.audit_log(user_id, actor_id, action, entity, details)
    VALUES (a.user_id, NULL, 'CONNECTOR_FIRST_HEARTBEAT', 'account_health',
      jsonb_build_object('account_id', a.id, 'ea_version', p_payload->>'ea_version'));
  END IF;
  RETURN jsonb_build_object('ok', true, 'quotes', v_count, 'account_status', a.status);
END $$;
REVOKE ALL ON FUNCTION public.connector_ingest(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connector_ingest(text, jsonb) TO service_role;