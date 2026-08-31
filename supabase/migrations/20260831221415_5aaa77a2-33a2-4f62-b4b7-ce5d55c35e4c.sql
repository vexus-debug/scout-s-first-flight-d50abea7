CREATE TABLE public.loopline_execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  mode text NOT NULL,
  start_coin text NOT NULL,
  requested_amount numeric NOT NULL,
  route jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  failure_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loopline_execution_runs TO authenticated;
GRANT ALL ON public.loopline_execution_runs TO service_role;
ALTER TABLE public.loopline_execution_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own execution runs"
  ON public.loopline_execution_runs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.loopline_execution_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.loopline_execution_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  sequence integer NOT NULL,
  symbol text NOT NULL,
  from_coin text NOT NULL,
  to_coin text NOT NULL,
  side text NOT NULL,
  requested_quantity numeric,
  order_id text,
  status text NOT NULL DEFAULT 'pending',
  filled_quantity numeric,
  average_price numeric,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loopline_execution_legs TO authenticated;
GRANT ALL ON public.loopline_execution_legs TO service_role;
ALTER TABLE public.loopline_execution_legs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own execution legs"
  ON public.loopline_execution_legs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.loopline_execution_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER loopline_execution_runs_updated_at
  BEFORE UPDATE ON public.loopline_execution_runs
  FOR EACH ROW EXECUTE FUNCTION public.loopline_execution_set_updated_at();
CREATE TRIGGER loopline_execution_legs_updated_at
  BEFORE UPDATE ON public.loopline_execution_legs
  FOR EACH ROW EXECUTE FUNCTION public.loopline_execution_set_updated_at();