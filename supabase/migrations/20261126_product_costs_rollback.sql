-- =====================================================================
-- MARCHA ATRÁS de 20261126_product_costs.sql
-- Se pierden los costos registrados. Si se quieren conservar, exportar antes:
--   SELECT * FROM public.product_costs;
-- =====================================================================
BEGIN;
DROP TABLE IF EXISTS public.product_costs;
ALTER TABLE public.suppliers DROP COLUMN IF EXISTS own;
NOTIFY pgrst, 'reload schema';
COMMIT;
