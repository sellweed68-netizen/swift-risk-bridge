-- Audit details should carry is_active as a real true/false value, not the text "true".
CREATE OR REPLACE FUNCTION public.account_activity_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user uuid;
  v_row jsonb;
  v_action text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user := OLD.user_id;
    v_row := to_jsonb(OLD);
    v_action := CASE WHEN TG_TABLE_NAME = 'broker_accounts' THEN 'ACCOUNT_DELETED' ELSE 'RISK_PROFILE_DELETED' END;
  ELSE
    v_user := NEW.user_id;
    v_row := to_jsonb(NEW);
    IF TG_OP = 'INSERT' THEN
      v_action := CASE WHEN TG_TABLE_NAME = 'broker_accounts' THEN 'ACCOUNT_CREATED' ELSE 'RISK_PROFILE_CREATED' END;
    ELSE
      v_action := CASE WHEN TG_TABLE_NAME = 'broker_accounts' THEN 'ACCOUNT_UPDATED' ELSE 'RISK_PROFILE_UPDATED' END;
    END IF;
  END IF;
  INSERT INTO public.audit_log(user_id, actor_id, action, entity, details)
  VALUES (v_user, auth.uid(), v_action, TG_TABLE_NAME,
    jsonb_strip_nulls(jsonb_build_object(
      'row_id', v_row->>'id',
      'label', v_row->>'label',
      'name', v_row->>'name',
      'status', v_row->>'status',
      'is_active', (v_row->'is_active')::boolean
    )));
  RETURN NULL;
END $function$;