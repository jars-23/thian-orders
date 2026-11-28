-- =====================================================================
-- MARCHA ATRÁS de 20261127b_price_lists.sql
-- Se pierden las listas y qué vendedor es mayorista (precios: sin cambios,
-- la fase 1 no los toca).
-- Respaldo previo opcional:
--   CREATE TABLE public.backup_price_lists_20261127 AS TABLE public.price_lists;
--   CREATE TABLE public.backup_seller_price_lists_20261127 AS TABLE public.seller_price_lists;
-- =====================================================================
BEGIN;
DROP TABLE IF EXISTS public.seller_price_lists;
DROP TABLE IF EXISTS public.price_lists;
NOTIFY pgrst, 'reload schema';
COMMIT;
