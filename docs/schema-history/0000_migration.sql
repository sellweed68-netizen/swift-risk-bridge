-- Phase 1: identity, roles, control state, audit
CREATE TYPE public.app_role AS ENUM ('owner','admin','trader','viewer');
CREATE TYPE public.trading_mode AS ENUM ('data_only','analysis','signal','auto_trade','ultimate_auto');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  display_name text,
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own roles read" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

CREATE TABLE public.control_state (
  user_id uuid PRIMARY KEY,
  trading_mode public.trading_mode NOT NULL DEFAULT 'data_only',
  ai_trading_halted boolean NOT NULL DEFAULT false,
  halted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.control_state TO authenticated;
GRANT UPDATE (trading_mode, ai_trading_halted) ON public.control_state TO authenticated;
GRANT ALL ON public.control_state TO service_role;
ALTER TABLE public.control_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own control read" ON public.control_state FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own control update (not viewer)" ON public.control_state FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND NOT public.has_role(auth.uid(),'viewer'))
  WITH CHECK (user_id = auth.uid());

CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_user_time ON public.audit_log(user_id, created_at DESC);
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own audit read" ON public.audit_log FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Deterministic safety gate on control state changes + audit
CREATE OR REPLACE FUNCTION public.control_state_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.trading_mode IN ('auto_trade','ultimate_auto') AND OLD.trading_mode IS DISTINCT FROM NEW.trading_mode THEN
    RAISE EXCEPTION 'AUTO_TRADE_LOCKED: execution plane not verified; auto modes unavailable';
  END IF;
  IF NEW.ai_trading_halted AND NEW.trading_mode IN ('auto_trade','ultimate_auto') THEN
    RAISE EXCEPTION 'HALTED: cannot run auto modes while AI trading is stopped';
  END IF;
  -- Stopping AI trading drops auto modes to SIGNAL (never closes positions, never removes SL/TP)
  IF NEW.ai_trading_halted AND NOT OLD.ai_trading_halted THEN
    NEW.halted_at := now();
    IF NEW.trading_mode IN ('auto_trade','ultimate_auto') THEN NEW.trading_mode := 'signal'; END IF;
  ELSIF NOT NEW.ai_trading_halted THEN
    NEW.halted_at := NULL;
  END IF;
  NEW.updated_at := now();
  INSERT INTO public.audit_log(user_id, actor_id, action, entity, details)
  VALUES (NEW.user_id, auth.uid(), 'CONTROL_STATE_CHANGED', 'control_state',
    jsonb_build_object('from_mode', OLD.trading_mode, 'to_mode', NEW.trading_mode,
                       'from_halted', OLD.ai_trading_halted, 'to_halted', NEW.ai_trading_halted));
  RETURN NEW;
END $$;
CREATE TRIGGER control_state_guard BEFORE UPDATE ON public.control_state
FOR EACH ROW EXECUTE FUNCTION public.control_state_guard();

-- New user bootstrap
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles(id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)));
  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'owner');
  INSERT INTO public.control_state(user_id) VALUES (NEW.id);
  INSERT INTO public.audit_log(user_id, actor_id, action, entity, details)
  VALUES (NEW.id, NEW.id, 'USER_CREATED', 'user', jsonb_build_object('default_mode','data_only'));
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.control_state_guard() FROM PUBLIC, anon, authenticated;