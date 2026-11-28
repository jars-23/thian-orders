-- =====================================================================
-- MARCHA ATRÁS de 20261127_wholesale_customers.sql
-- Se pierden las clasificaciones de mayoristas (nada más cambia).
-- Respaldo previo opcional:
--   CREATE TABLE public.backup_wholesale_customers_20261127 AS TABLE public.wholesale_customers;
-- =====================================================================
BEGIN;
DROP TABLE IF EXISTS public.wholesale_customers;
NOTIFY pgrst, 'reload schema';
COMMIT;
