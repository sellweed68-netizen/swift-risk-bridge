
CREATE OR REPLACE FUNCTION public.connector_pull_orders(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE t record; res jsonb; rec jsonb;
BEGIN
  SELECT * INTO t FROM public.connector_tokens WHERE token_hash = encode(digest(p_token,'sha256'),'hex') AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN'); END IF;
  PERFORM public.execution_sweep(t.account_id);
  -- UNKNOWN orders are handed back ONLY for reconciliation (EA inspects broker state, never resends).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'broker_symbol', broker_symbol, 'direction', direction, 'volume', volume, 'mode', 'R')), '[]'::jsonb)
    INTO rec FROM public.execution_orders WHERE account_id=t.account_id AND state='UNKNOWN';
  WITH picked AS (
    UPDATE public.execution_orders SET state='SENT', sent_at=now()
     WHERE id IN (SELECT id FROM public.execution_orders WHERE account_id=t.account_id AND state='APPROVED' ORDER BY approved_at LIMIT 5 FOR UPDATE SKIP LOCKED)
    RETURNING id, broker_symbol, direction, volume, stop_loss, take_profit, max_slippage_points)
  SELECT COALESCE(jsonb_agg(to_jsonb(picked) || jsonb_build_object('mode','X')), '[]'::jsonb) INTO res FROM picked;
  RETURN jsonb_build_object('ok', true, 'orders', res || rec);
END $$;
REVOKE ALL ON FUNCTION public.connector_pull_orders(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connector_pull_orders(text) TO service_role;
