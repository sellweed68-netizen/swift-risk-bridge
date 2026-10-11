CREATE OR REPLACE FUNCTION public.log_security_event(p_action text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_action NOT IN ('AUTH_LOGIN','AUTH_LOGOUT','AUTH_LOGOUT_ALL','AUTH_PASSWORD_CHANGED','AUTH_PASSWORD_RESET_COMPLETED') THEN
    RAISE EXCEPTION 'INVALID_SECURITY_EVENT';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE user_id = v_uid AND action LIKE 'AUTH_%' AND created_at > now() - interval '1 minute') >= 20 THEN
    RETURN; -- rate limit: drop flood silently
  END IF;
  INSERT INTO public.audit_log(user_id, actor_id, action, entity, details)
  VALUES (v_uid, v_uid, p_action, 'auth', jsonb_build_object('method', left(coalesce(p_details->>'method',''),20)));
END $$;
REVOKE ALL ON FUNCTION public.log_security_event(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_security_event(text, jsonb) TO authenticated;