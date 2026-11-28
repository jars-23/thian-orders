-- =====================================================================
-- 20261127 · Clasificación de clientes mayoristas
-- - Tabla nueva wholesale_customers: una fila por cliente clasificado.
--   customer_key = teléfono (solo dígitos, últimos 10) o, si no hay
--   teléfono, el nombre en minúsculas sin espacios repetidos.
--   La calcula la app (customerKey en src/main.jsx).
-- - Solo el Administrador lee, crea, cambia y borra.
-- - No cambia ninguna tabla, RPC, política ni Edge Function existente.
-- MARCHA ATRÁS: 20261127_wholesale_customers_rollback.sql
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.wholesale_customers (
  customer_key   text PRIMARY KEY CHECK (length(trim(customer_key)) > 0),
  customer_name  text NOT NULL CHECK (length(trim(customer_name)) > 0),
  customer_phone text,
  category       text NOT NULL
                 CHECK (category IN ('distribuidor','tienda','revendedor','empresa','otro')),
  notes          text CHECK (notes IS NULL OR length(notes) <= 500),
  updated_by     uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wholesale_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wholesale_customers admin read" ON public.wholesale_customers
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "wholesale_customers admin insert" ON public.wholesale_customers
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "wholesale_customers admin update" ON public.wholesale_customers
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "wholesale_customers admin delete" ON public.wholesale_customers
  FOR DELETE TO authenticated USING (public.is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wholesale_customers TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Verificación (solo lectura):
--   SELECT count(*) FROM public.wholesale_customers;            -- 0
--   SELECT policyname FROM pg_policies WHERE tablename = 'wholesale_customers';  -- 4
