-- =====================================================================
-- Migración 2026-11-18 (c) — Fotos de productos en Supabase Storage
-- Ejecutar UNA vez en SQL Editor, después de 20261118b.
--
-- Bucket "product-images" PÚBLICO: las fotos del catálogo no son datos
-- sensibles y se muestran con su URL pública (sin firmar), así cargan
-- rápido en la tarjeta del pedido. Solo admin sube, cambia o borra.
-- Límite 5 MB por archivo; solo JPG, PNG y WebP (la app las reduce a
-- ~1000 px en WebP antes de subirlas).
-- No se toca RLS de las tablas de la app.
-- =====================================================================
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images', 'product-images', true, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "product images admin insert" ON storage.objects;
DROP POLICY IF EXISTS "product images admin update" ON storage.objects;
DROP POLICY IF EXISTS "product images admin delete" ON storage.objects;

CREATE POLICY "product images admin insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND public.is_admin());
CREATE POLICY "product images admin update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'product-images' AND public.is_admin());
CREATE POLICY "product images admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND public.is_admin());

COMMIT;

-- Verificación (1 bucket público y 3 políticas):
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'product-images';
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname = 'storage' AND policyname LIKE 'product images%';
