CREATE OR REPLACE FUNCTION public.simulate_demo_feed(p_account_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_acc record;
  v_price numeric := 2350.00;
  v_o numeric; v_c numeric; i int;
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF has_role(v_uid,'viewer') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_acc FROM broker_accounts WHERE id = p_account_id AND user_id = v_uid AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND'; END IF;
  IF NOT v_acc.is_demo THEN RAISE EXCEPTION 'DEMO_ONLY: simulated feed is allowed on demo accounts only'; END IF;

  FOR i IN REVERSE 60..1 LOOP
    v_o := v_price;
    v_c := round(v_o + (random() - 0.48) * 2.0, 2);
    INSERT INTO market_candles(user_id, account_id, broker_symbol, canonical_symbol, bucket, open, high, low, close, ticks)
    VALUES (v_uid, p_account_id, 'XAUUSD.sim', 'XAUUSD', date_trunc('minute', v_now) - make_interval(mins => i),
            v_o, greatest(v_o,v_c) + round((random()*0.8)::numeric,2), least(v_o,v_c) - round((random()*0.8)::numeric,2), v_c, 30)
    ON CONFLICT (account_id, broker_symbol, bucket) DO NOTHING;
    v_price := v_c;
  END LOOP;

  INSERT INTO account_health(user_id, account_id, last_heartbeat_at, ea_version, terminal_connected, trade_allowed, reported_login, balance, equity, margin_free, broker_server_time, updated_at)
  VALUES (v_uid, p_account_id, v_now, 'SIMULATED', true, false, v_acc.mt5_login, 10000, 10000, 10000, v_now, v_now)
  ON CONFLICT (account_id) DO UPDATE SET last_heartbeat_at = v_now, ea_version = 'SIMULATED', terminal_connected = true, trade_allowed = false, broker_server_time = v_now, updated_at = v_now;

  INSERT INTO market_quotes(user_id, account_id, broker_symbol, canonical_symbol, bid, ask, spread_points, digits, tick_time, received_at)
  VALUES (v_uid, p_account_id, 'XAUUSD.sim', 'XAUUSD', v_price, v_price + 0.20, 20, 2, v_now, v_now)
  ON CONFLICT (account_id, broker_symbol) DO UPDATE SET bid = EXCLUDED.bid, ask = EXCLUDED.ask, spread_points = 20, tick_time = v_now, received_at = v_now;

  INSERT INTO audit_log(user_id, actor_id, action, entity, details)
  VALUES (v_uid, v_uid, 'demo_feed.simulated', 'market_quotes', jsonb_build_object('account_id', p_account_id, 'symbol', 'XAUUSD.sim', 'price', v_price));
  RETURN jsonb_build_object('ok', true, 'price', v_price);
END $$;
REVOKE ALL ON FUNCTION public.simulate_demo_feed(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.simulate_demo_feed(uuid) TO authenticated;