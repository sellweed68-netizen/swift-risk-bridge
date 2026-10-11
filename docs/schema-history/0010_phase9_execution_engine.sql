
CREATE TABLE public.execution_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.broker_accounts(id),
  analysis_id uuid NOT NULL REFERENCES public.ai_analyses(id),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 80),
  canonical_symbol text NOT NULL,
  broker_symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY','SELL')),
  volume numeric NOT NULL CHECK (volume > 0),
  requested_price numeric,
  stop_loss numeric,
  take_profit numeric,
  digits integer,
  max_slippage_points integer NOT NULL DEFAULT 30,
  state text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED','VALIDATING','APPROVED','SENT','ACKNOWLEDGED','FILLED','REJECTED','CANCELLED','UNKNOWN')),
  gate jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  broker_ticket text,
  fill_price numeric,
  fill_volume numeric,
  slippage_points integer,
  retcode integer,
  latency_ms integer,
  approved_at timestamptz,
  sent_at timestamptz,
  acked_at timestamptz,
  filled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX execution_orders_account_state ON public.execution_orders(account_id, state);
-- At most one live (non-terminal) order per trade plan.
CREATE UNIQUE INDEX execution_orders_one_live_per_plan ON public.execution_orders(analysis_id)
  WHERE state IN ('REQUESTED','VALIDATING','APPROVED','SENT','ACKNOWLEDGED','UNKNOWN');
GRANT SELECT ON public.execution_orders TO authenticated;
GRANT ALL ON public.execution_orders TO service_role;
ALTER TABLE public.execution_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own orders read" ON public.execution_orders FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin read orders" ON public.execution_orders FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.execution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.execution_orders(id),
  user_id uuid NOT NULL,
  from_state text,
  to_state text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX execution_events_order ON public.execution_events(order_id, created_at);
GRANT SELECT ON public.execution_events TO authenticated;
GRANT ALL ON public.execution_events TO service_role;
ALTER TABLE public.execution_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own events read" ON public.execution_events FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin read events" ON public.execution_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- State machine: the only allowed transitions. SENT never goes back to APPROVED (no resend).
CREATE OR REPLACE FUNCTION public.execution_transition_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id <> OLD.user_id OR NEW.account_id <> OLD.account_id OR NEW.idempotency_key <> OLD.idempotency_key
       OR NEW.direction <> OLD.direction OR NEW.volume <> OLD.volume OR NEW.analysis_id <> OLD.analysis_id THEN
      RAISE EXCEPTION 'EXECUTION_IMMUTABLE';
    END IF;
    IF NEW.state = OLD.state THEN NEW.updated_at := now(); RETURN NEW; END IF;
    ok := (OLD.state, NEW.state) IN (
      ('REQUESTED','VALIDATING'),('REQUESTED','CANCELLED'),
      ('VALIDATING','APPROVED'),('VALIDATING','REJECTED'),
      ('APPROVED','SENT'),('APPROVED','CANCELLED'),
      ('SENT','ACKNOWLEDGED'),('SENT','FILLED'),('SENT','REJECTED'),('SENT','UNKNOWN'),
      ('ACKNOWLEDGED','FILLED'),('ACKNOWLEDGED','REJECTED'),('ACKNOWLEDGED','UNKNOWN'),
      ('UNKNOWN','ACKNOWLEDGED'),('UNKNOWN','FILLED'),('UNKNOWN','REJECTED'));
    IF NOT ok THEN RAISE EXCEPTION 'INVALID_TRANSITION: % -> %', OLD.state, NEW.state; END IF;
    NEW.updated_at := now();
  ELSIF NEW.state <> 'REQUESTED' THEN
    RAISE EXCEPTION 'ORDERS_START_REQUESTED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER execution_orders_guard BEFORE INSERT OR UPDATE ON public.execution_orders
  FOR EACH ROW EXECUTE FUNCTION public.execution_transition_guard();

CREATE OR REPLACE FUNCTION public.execution_event_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO public.execution_events(order_id, user_id, from_state, to_state, details)
    VALUES (NEW.id, NEW.user_id, CASE WHEN TG_OP='UPDATE' THEN OLD.state END, NEW.state,
      jsonb_build_object('reason', NEW.reason, 'ticket', NEW.broker_ticket, 'retcode', NEW.retcode));
    INSERT INTO public.audit_log(user_id, actor_id, action, entity, details)
    VALUES (NEW.user_id, auth.uid(), 'EXECUTION_' || NEW.state, 'execution_orders',
      jsonb_build_object('order_id', NEW.id, 'analysis_id', NEW.analysis_id, 'symbol', NEW.broker_symbol,
        'direction', NEW.direction, 'volume', NEW.volume, 'reason', NEW.reason));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER execution_orders_events AFTER INSERT OR UPDATE ON public.execution_orders
  FOR EACH ROW EXECUTE FUNCTION public.execution_event_log();

-- SENT/ACKNOWLEDGED without a broker answer for 30s become UNKNOWN (never resent).
CREATE OR REPLACE FUNCTION public.execution_sweep(p_account_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.execution_orders SET state='UNKNOWN', reason='NO_BROKER_RESPONSE_30S'
   WHERE account_id=p_account_id AND state IN ('SENT','ACKNOWLEDGED') AND COALESCE(acked_at, sent_at) < now() - interval '30 seconds';
  UPDATE public.execution_orders SET state='CANCELLED', reason='EXPIRED_IN_QUEUE'
   WHERE account_id=p_account_id AND state='APPROVED' AND approved_at < now() - interval '2 minutes';
END $$;
REVOKE ALL ON FUNCTION public.execution_sweep(uuid) FROM PUBLIC, anon, authenticated;

-- Deterministic Execution Safety Gate. Called by the signed-in user = final approval.
CREATE OR REPLACE FUNCTION public.request_execution(p_analysis_id uuid, p_volume numeric, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid(); existing record; an record; acc record; br record; rp record; cs record; h record; q record;
  o_id uuid; checks jsonb := '[]'::jsonb; fails text[] := '{}'; v_price numeric; v_sl numeric; v_tp numeric;
  v_dist int; v_live int; v_steps numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO existing FROM public.execution_orders WHERE user_id=uid AND idempotency_key=p_idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('ok', existing.state NOT IN ('REJECTED','CANCELLED'), 'order_id', existing.id, 'state', existing.state, 'idempotent', true); END IF;

  SELECT * INTO an FROM public.ai_analyses WHERE id=p_analysis_id AND user_id=uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_NOT_FOUND'; END IF;
  IF an.decision NOT IN ('BUY','SELL') THEN RAISE EXCEPTION 'PLAN_NOT_TRADEABLE'; END IF;
  PERFORM public.execution_sweep(an.account_id);

  INSERT INTO public.execution_orders(user_id, account_id, analysis_id, idempotency_key, canonical_symbol, broker_symbol, direction, volume, stop_loss, take_profit)
  VALUES (uid, an.account_id, an.id, p_idempotency_key, an.canonical_symbol, an.broker_symbol, an.decision, p_volume,
    NULLIF(an.plan->>'stop_loss','')::numeric, NULLIF(an.plan->>'take_profit','')::numeric)
  RETURNING id INTO o_id;
  UPDATE public.execution_orders SET state='VALIDATING' WHERE id=o_id;

  SELECT * INTO cs FROM public.control_state WHERE user_id=uid;
  SELECT * INTO acc FROM public.broker_accounts WHERE id=an.account_id;
  SELECT * INTO br FROM public.brokers WHERE id=acc.broker_id;
  SELECT * INTO rp FROM public.risk_profiles WHERE account_id=acc.id AND is_active LIMIT 1;
  SELECT * INTO h FROM public.account_health WHERE account_id=acc.id;
  SELECT * INTO q FROM public.market_quotes WHERE account_id=acc.id AND broker_symbol=an.broker_symbol;
  v_sl := NULLIF(an.plan->>'stop_loss','')::numeric; v_tp := NULLIF(an.plan->>'take_profit','')::numeric;
  IF q.id IS NOT NULL THEN v_price := CASE WHEN an.decision='BUY' THEN q.ask ELSE q.bid END; END IF;

  -- 1 permission
  IF public.has_role(uid,'viewer') THEN fails := fails || 'PERMISSION_VIEWER'; END IF;
  IF cs.trading_mode <> 'signal' THEN fails := fails || 'MODE_NOT_SIGNAL'; END IF;
  IF cs.ai_trading_halted THEN fails := fails || 'AI_TRADING_HALTED'; END IF;
  -- 2 plan
  IF an.status <> 'completed' THEN fails := fails || 'PLAN_NOT_COMPLETED'; END IF;
  IF an.created_at < now() - interval '15 minutes' THEN fails := fails || 'PLAN_EXPIRED'; END IF;
  IF COALESCE((an.gate->>'plan_valid')::boolean, false) = false THEN fails := fails || 'PLAN_INVALID'; END IF;
  -- 3 account
  IF acc.status <> 'active' THEN fails := fails || 'ACCOUNT_NOT_ACTIVE'; END IF;
  -- 4 market data quality
  IF h.account_id IS NULL OR h.last_heartbeat_at < now() - interval '15 seconds' OR NOT h.terminal_connected THEN fails := fails || 'MT5_NOT_HEALTHY'; END IF;
  IF h.account_id IS NOT NULL AND NOT h.trade_allowed THEN fails := fails || 'MT5_TRADE_NOT_ALLOWED'; END IF;
  IF COALESCE(h.ea_version,'') = 'SIMULATED' THEN fails := fails || 'SIMULATED_FEED'; END IF;
  IF q.id IS NULL OR q.received_at < now() - interval '10 seconds' THEN fails := fails || 'QUOTE_STALE'; END IF;
  IF q.id IS NOT NULL AND q.spread_points > 80 THEN fails := fails || 'SPREAD_TOO_WIDE'; END IF;
  -- 5 levels at current market
  IF v_sl IS NULL OR v_tp IS NULL THEN fails := fails || 'MISSING_SL_TP';
  ELSIF v_price IS NOT NULL THEN
    IF (an.decision='BUY' AND NOT (v_sl < v_price AND v_price < v_tp)) OR (an.decision='SELL' AND NOT (v_tp < v_price AND v_price < v_sl)) THEN
      fails := fails || 'LEVELS_INVALID_AT_MARKET'; END IF;
    v_dist := round(abs(v_price - v_sl) * power(10, COALESCE(q.digits,5)));
  END IF;
  -- 6 broker capability
  IF p_volume < br.min_lot OR p_volume > br.max_lot THEN fails := fails || 'BROKER_LOT_RANGE'; END IF;
  v_steps := round((p_volume - br.min_lot) / br.lot_step, 6);
  IF v_steps <> trunc(v_steps) THEN fails := fails || 'BROKER_LOT_STEP'; END IF;
  -- 7 risk profile
  IF rp.id IS NULL THEN fails := fails || 'NO_RISK_PROFILE';
  ELSE
    IF p_volume > rp.max_lot THEN fails := fails || 'RISK_MAX_LOT'; END IF;
    IF v_dist IS NOT NULL AND v_dist < rp.min_stop_distance_points THEN fails := fails || 'RISK_STOP_TOO_CLOSE'; END IF;
    IF h.balance IS NOT NULL AND h.equity IS NOT NULL THEN
      IF h.balance - h.equity > rp.max_daily_loss THEN fails := fails || 'RISK_DAILY_LOSS'; END IF;
      IF h.balance > 0 AND (h.balance - h.equity) / h.balance * 100 > rp.max_drawdown_pct THEN fails := fails || 'RISK_DRAWDOWN'; END IF;
    ELSE fails := fails || 'RISK_NO_EQUITY_DATA'; END IF;
  END IF;
  -- 8 exposure
  SELECT count(*) INTO v_live FROM public.execution_orders
   WHERE account_id=acc.id AND id<>o_id AND state IN ('APPROVED','SENT','ACKNOWLEDGED','FILLED','UNKNOWN');
  IF rp.id IS NOT NULL AND v_live >= rp.max_open_positions THEN fails := fails || 'EXPOSURE_MAX_POSITIONS'; END IF;
  -- 9 unknown protection: reconcile before anything new
  IF EXISTS (SELECT 1 FROM public.execution_orders WHERE account_id=acc.id AND state='UNKNOWN') THEN fails := fails || 'UNKNOWN_ORDER_UNRECONCILED'; END IF;
  -- 10 duplicate
  IF EXISTS (SELECT 1 FROM public.execution_orders WHERE analysis_id=an.id AND id<>o_id AND state IN ('FILLED')) THEN fails := fails || 'PLAN_ALREADY_EXECUTED'; END IF;

  checks := jsonb_build_object('fails', to_jsonb(fails), 'price', v_price, 'spread_points', q.spread_points,
    'stop_distance_points', v_dist, 'live_orders', v_live, 'checked_at', now(),
    'limits', jsonb_build_object('max_lot', rp.max_lot, 'max_open_positions', rp.max_open_positions,
      'min_stop_distance_points', rp.min_stop_distance_points, 'broker_min_lot', br.min_lot, 'broker_lot_step', br.lot_step));

  IF array_length(fails,1) IS NULL THEN
    UPDATE public.execution_orders SET state='APPROVED', gate=checks, requested_price=v_price, digits=q.digits, approved_at=now() WHERE id=o_id;
    RETURN jsonb_build_object('ok', true, 'order_id', o_id, 'state', 'APPROVED');
  END IF;
  UPDATE public.execution_orders SET state='REJECTED', gate=checks, requested_price=v_price, digits=q.digits, reason=fails[1] WHERE id=o_id;
  RETURN jsonb_build_object('ok', false, 'order_id', o_id, 'state', 'REJECTED', 'fails', to_jsonb(fails));
END $$;
REVOKE ALL ON FUNCTION public.request_execution(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_execution(uuid, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_execution(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record;
BEGIN
  SELECT * INTO o FROM public.execution_orders WHERE id=p_order_id AND user_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  IF public.has_role(auth.uid(),'viewer') THEN RAISE EXCEPTION 'PERMISSION_VIEWER'; END IF;
  IF o.state NOT IN ('REQUESTED','APPROVED') THEN RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_SENT'); END IF;
  UPDATE public.execution_orders SET state='CANCELLED', reason='USER_CANCELLED' WHERE id=o.id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.cancel_execution(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_execution(uuid) TO authenticated;

-- EA pull: hands out APPROVED orders exactly once (APPROVED -> SENT), oldest first.
CREATE OR REPLACE FUNCTION public.connector_pull_orders(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE t record; res jsonb;
BEGIN
  SELECT * INTO t FROM public.connector_tokens WHERE token_hash = encode(digest(p_token,'sha256'),'hex') AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN'); END IF;
  PERFORM public.execution_sweep(t.account_id);
  WITH picked AS (
    UPDATE public.execution_orders SET state='SENT', sent_at=now()
     WHERE id IN (SELECT id FROM public.execution_orders WHERE account_id=t.account_id AND state='APPROVED' ORDER BY approved_at LIMIT 5 FOR UPDATE SKIP LOCKED)
    RETURNING id, broker_symbol, direction, volume, requested_price, stop_loss, take_profit, max_slippage_points)
  SELECT COALESCE(jsonb_agg(to_jsonb(picked)), '[]'::jsonb) INTO res FROM picked;
  RETURN jsonb_build_object('ok', true, 'orders', res);
END $$;
REVOKE ALL ON FUNCTION public.connector_pull_orders(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connector_pull_orders(text) TO service_role;

-- EA report: broker result for an order. Only valid state-machine transitions are accepted.
CREATE OR REPLACE FUNCTION public.connector_report_order(p_token text, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE t record; o record; v_state text := p_payload->>'state'; v_price numeric := NULLIF(p_payload->>'price','')::numeric;
BEGIN
  SELECT * INTO t FROM public.connector_tokens WHERE token_hash = encode(digest(p_token,'sha256'),'hex') AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN'); END IF;
  SELECT * INTO o FROM public.execution_orders WHERE id=(p_payload->>'order_id')::uuid AND account_id=t.account_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND'); END IF;
  IF v_state NOT IN ('ACKNOWLEDGED','FILLED','REJECTED') THEN RETURN jsonb_build_object('ok', false, 'error', 'BAD_STATE'); END IF;
  IF o.state = v_state THEN RETURN jsonb_build_object('ok', true, 'idempotent', true); END IF;
  IF o.state NOT IN ('SENT','ACKNOWLEDGED','UNKNOWN') THEN RETURN jsonb_build_object('ok', false, 'error', 'STATE_' || o.state); END IF;
  UPDATE public.execution_orders SET
    state = v_state,
    broker_ticket = COALESCE(p_payload->>'ticket', broker_ticket),
    retcode = COALESCE((p_payload->>'retcode')::int, retcode),
    reason = CASE WHEN v_state='REJECTED' THEN left(COALESCE(p_payload->>'message','BROKER_REJECTED'),200) WHEN o.state='UNKNOWN' THEN 'RECONCILED' ELSE reason END,
    acked_at = COALESCE(acked_at, now()),
    filled_at = CASE WHEN v_state='FILLED' THEN now() ELSE filled_at END,
    fill_price = CASE WHEN v_state='FILLED' THEN v_price ELSE fill_price END,
    fill_volume = CASE WHEN v_state='FILLED' THEN NULLIF(p_payload->>'volume','')::numeric ELSE fill_volume END,
    slippage_points = CASE WHEN v_state='FILLED' AND v_price IS NOT NULL AND requested_price IS NOT NULL
      THEN round((CASE WHEN direction='BUY' THEN v_price - requested_price ELSE requested_price - v_price END) * power(10, COALESCE(digits,5))) ELSE slippage_points END,
    latency_ms = CASE WHEN sent_at IS NOT NULL THEN (extract(epoch FROM now() - sent_at)*1000)::int ELSE latency_ms END
  WHERE id=o.id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.connector_report_order(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connector_report_order(text, jsonb) TO service_role;
