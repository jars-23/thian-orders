-- =====================================================================
-- Migración 2026-11-18 (b) — Precio y categoría de productos
-- Ejecutar UNA vez en SQL Editor, después de 20261118_order_seller_names.sql.
-- (setup.sql ya incluye estas columnas para instalaciones nuevas.)
--
-- price:    precio general (al público) en pesos colombianos, sin decimales.
-- category: línea o colección del catálogo (texto libre, opcional).
-- RLS y privilegios de products no cambian: todos los usuarios activos
-- leen, solo admin crea y edita.
-- =====================================================================
BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price    integer CHECK (price IS NULL OR price >= 0),
  ADD COLUMN IF NOT EXISTS category text;

CREATE INDEX IF NOT EXISTS products_category_name_idx ON public.products (category, name);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificación (debe devolver price | integer y category | text):
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'products'
--    AND column_name IN ('price', 'category');
