CREATE TABLE public.market_candles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.broker_accounts(id) ON DELETE CASCADE,
  broker_symbol text NOT NULL,
  canonical_symbol text NOT NULL,
  bucket timestamptz NOT NULL,
  open numeric NOT NULL, high numeric NOT NULL, low numeric NOT NULL, close numeric NOT NULL,
  ticks int NOT NULL DEFAULT 1,
  UNIQUE (account_id, broker_symbol, bucket)
);
GRANT SELECT ON public.market_candles TO authenticated;
GRANT ALL ON public.market_candles TO service_role;
ALTER TABLE public.market_candles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own candles" ON public.market_candles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin read candles" ON public.market_candles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.quote_to_candle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b timestamptz := date_trunc('minute', NEW.tick_time);
BEGIN
  INSERT INTO public.market_candles AS c (user_id, account_id, broker_symbol, canonical_symbol, bucket, open, high, low, close)
  VALUES (NEW.user_id, NEW.account_id, NEW.broker_symbol, NEW.canonical_symbol, b, NEW.bid, NEW.bid, NEW.bid, NEW.bid)
  ON CONFLICT (account_id, broker_symbol, bucket) DO UPDATE SET
    high = greatest(c.high, EXCLUDED.high), low = least(c.low, EXCLUDED.low), close = EXCLUDED.close,
    canonical_symbol = EXCLUDED.canonical_symbol, ticks = c.ticks + 1;
  IF random() < 0.01 THEN
    DELETE FROM public.market_candles WHERE account_id = NEW.account_id AND bucket < now() - interval '3 days';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER market_quotes_candle AFTER INSERT OR UPDATE ON public.market_quotes
  FOR EACH ROW EXECUTE FUNCTION public.quote_to_candle();
CREATE INDEX market_candles_lookup ON public.market_candles (account_id, canonical_symbol, bucket DESC);

CREATE TABLE public.ai_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  account_id uuid NOT NULL REFERENCES public.broker_accounts(id) ON DELETE CASCADE,
  canonical_symbol text NOT NULL,
  broker_symbol text NOT NULL,
  version int NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('completed','blocked','error')),
  decision text NOT NULL CHECK (decision IN ('BUY','SELL','WAIT','NO_TRADE')),
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  gate jsonb NOT NULL DEFAULT '{}'::jsonb,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ai_analyses TO authenticated;
GRANT ALL ON public.ai_analyses TO service_role;
ALTER TABLE public.ai_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own analyses read" ON public.ai_analyses FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own analyses insert" ON public.ai_analyses FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "admin read analyses" ON public.ai_analyses FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX ai_analyses_lookup ON public.ai_analyses (user_id, created_at DESC);

-- Versioned + guarded: never overwritten (no UPDATE/DELETE grants); DATA_ONLY mode forbids analysis.
CREATE OR REPLACE FUNCTION public.ai_analysis_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.trading_mode;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.broker_accounts WHERE id = NEW.account_id AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_OWNED';
  END IF;
  SELECT trading_mode INTO m FROM public.control_state WHERE user_id = NEW.user_id;
  IF m IS NULL OR m = 'data_only' THEN RAISE EXCEPTION 'ANALYSIS_NOT_ALLOWED: mode is DATA_ONLY'; END IF;
  SELECT COALESCE(max(version),0)+1 INTO NEW.version FROM public.ai_analyses
   WHERE account_id = NEW.account_id AND canonical_symbol = NEW.canonical_symbol;
  NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER ai_analyses_guard BEFORE INSERT ON public.ai_analyses FOR EACH ROW EXECUTE FUNCTION public.ai_analysis_guard();

CREATE OR REPLACE FUNCTION public.ai_analysis_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_log(user_id, actor_id, action, entity, details)
  VALUES (NEW.user_id, NEW.user_id, 'AI_ANALYSIS_' || upper(NEW.status), 'ai_analyses',
    jsonb_build_object('analysis_id', NEW.id, 'symbol', NEW.canonical_symbol, 'version', NEW.version, 'decision', NEW.decision, 'model', NEW.model));
  RETURN NEW;
END $$;
CREATE TRIGGER ai_analyses_audit AFTER INSERT ON public.ai_analyses FOR EACH ROW EXECUTE FUNCTION public.ai_analysis_audit();