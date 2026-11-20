-- =====================================================================
-- THIAN ORDERS — Instalación completa desde cero (equivale a v1.0 + v1.1 + v1.2)
-- Ejecutar UNA sola vez en un proyecto Supabase NUEVO y vacío,
-- desde SQL Editor (rol postgres). No ejecutar sobre una base con datos.
-- Sustituye a schema.sql + scripts de roles + migrate_v1_1.sql + migrate_v1_2.sql
-- (archivados en supabase/legacy/).
-- =====================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Tipos y tablas
-- ---------------------------------------------------------------------
CREATE TYPE public.production_status AS ENUM ('pending','in_progress','finished');

CREATE TABLE public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username   text NOT NULL CHECK (username ~ '^[a-zA-Z0-9._]{4,20}$'),
  full_name  text NOT NULL DEFAULT '' CHECK (length(full_name) <= 100),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Username único sin distinguir mayúsculas (login-username usa ilike).
CREATE UNIQUE INDEX profiles_username_lower_key ON public.profiles (lower(username));

CREATE TABLE public.roles (
  id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE public.user_roles (
  user_id    uuid   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id    bigint NOT NULL REFERENCES public.roles(id)    ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX ON public.user_roles (role_id);

CREATE TABLE public.products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  sku         text UNIQUE,
  description text,
  image_url   text,
  price       integer CHECK (price IS NULL OR price >= 0), -- precio general en COP
  price_wholesale integer CHECK (price_wholesale IS NULL OR price_wholesale >= 0), -- mayorista
  category    text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_category_name_idx ON public.products (category, name);

CREATE TABLE public.orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number   bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  seller_id      uuid NOT NULL REFERENCES public.profiles(id),
  customer_name  text NOT NULL CHECK (length(trim(customer_name)) > 0),
  customer_phone text,
  delivery_date  date,
  delivery_time  time,          -- hora de entrega (opcional)
  delivery_address text,        -- dirección de entrega (opcional)
  notes          text,
  wholesale      boolean NOT NULL DEFAULT false, -- cobrado a precio mayorista
  payment_status text NOT NULL DEFAULT 'pending'     -- pending | partial | paid
                 CHECK (payment_status IN ('pending', 'partial', 'paid')),
  payment_method text CHECK (payment_method IN ('transfer', 'cash')), -- transferencia | efectivo
  amount_paid    integer CHECK (amount_paid IS NULL OR amount_paid >= 0), -- abonado al crear
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.orders (seller_id, created_at DESC);
CREATE INDEX ON public.orders (delivery_date);

CREATE TABLE public.order_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity   integer NOT NULL CHECK (quantity > 0),
  status     public.production_status NOT NULL DEFAULT 'pending',
  notes      text,
  unit_price integer CHECK (unit_price IS NULL OR unit_price >= 0), -- precio aplicado al crear
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.order_items (order_id);
CREATE INDEX ON public.order_items (status);

-- ---------------------------------------------------------------------
-- 2. Catálogo de roles
-- ---------------------------------------------------------------------
INSERT INTO public.roles (code, name) VALUES
  ('admin',            'Administrador'),
  ('seller',           'Vendedor'),
  ('production',       'Producción'),
  ('billing',          'Facturación'),
  ('supervisor',       'Supervisor'),
  ('sales_production', 'Ventas y Producción');

-- ---------------------------------------------------------------------
-- 3. Funciones de autorización (SECURITY DEFINER evita recursión en RLS)
-- ---------------------------------------------------------------------
CREATE FUNCTION public.is_active_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND active);
$$;

CREATE FUNCTION public.has_role(p_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.roles r    ON r.id = ur.role_id
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = (SELECT auth.uid()) AND p.active AND r.code = p_role);
$$;

CREATE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.has_role('admin');
$$;

-- Roles del usuario actual (usado por el frontend tras iniciar sesión).
CREATE FUNCTION public.my_roles() RETURNS TABLE (code text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.code, r.name
  FROM public.user_roles ur
  JOIN public.roles r    ON r.id = ur.role_id
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.user_id = (SELECT auth.uid()) AND p.active
  ORDER BY r.id;
$$;

-- ---------------------------------------------------------------------
-- 4. Alta automática de perfil: username temporal + rol seller
--    (create-user lo sobrescribe con el username y roles elegidos).
-- ---------------------------------------------------------------------
CREATE FUNCTION public.create_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role_id bigint;
BEGIN
  INSERT INTO public.profiles (id, full_name, username)
  VALUES (new.id,
          left(coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1), ''), 100),
          'u_' || substr(replace(new.id::text,'-',''), 1, 16))
  ON CONFLICT (id) DO NOTHING;
  SELECT id INTO v_role_id FROM public.roles WHERE code = 'seller';
  IF v_role_id IS NULL THEN RAISE EXCEPTION 'Falta rol seller'; END IF;
  INSERT INTO public.user_roles (user_id, role_id) VALUES (new.id, v_role_id) ON CONFLICT DO NOTHING;
  RETURN new;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.create_profile();

-- ---------------------------------------------------------------------
-- 5. Triggers de protección
-- ---------------------------------------------------------------------
-- Solo el admin modifica columnas distintas de status (segunda barrera tras la RPC).
CREATE FUNCTION public.guard_order_item_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF current_setting('thian.order_edit', true) = 'on' THEN RETURN NEW; END IF;
  IF NOT public.is_admin() AND (SELECT auth.uid()) IS NOT NULL AND (
     NEW.id IS DISTINCT FROM OLD.id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR
     NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.quantity IS DISTINCT FROM OLD.quantity OR
     NEW.notes IS DISTINCT FROM OLD.notes OR NEW.unit_price IS DISTINCT FROM OLD.unit_price OR
     NEW.created_at IS DISTINCT FROM OLD.created_at)
  THEN RAISE EXCEPTION 'Producción solo puede modificar el estado'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_order_item_update BEFORE UPDATE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.guard_order_item_update();

CREATE FUNCTION public.guard_profile_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN RAISE EXCEPTION 'Campos de perfil protegidos'; END IF;
  IF OLD.id = (SELECT auth.uid()) AND NEW.active = false
  THEN RAISE EXCEPTION 'No puedes desactivar tu propia cuenta'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_profile_update BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

-- No retirar el rol admin a uno mismo ni al último admin activo.
CREATE FUNCTION public.guard_admin_role_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin_id bigint;
BEGIN
  SELECT id INTO v_admin_id FROM public.roles WHERE code = 'admin';
  IF OLD.role_id = v_admin_id THEN
    IF OLD.user_id = (SELECT auth.uid()) THEN
      RAISE EXCEPTION 'No puedes quitarte tu propio rol administrador';
    END IF;
    IF (SELECT count(*) FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
        WHERE ur.role_id = v_admin_id AND p.active) <= 1 THEN
      RAISE EXCEPTION 'Debe permanecer al menos un administrador activo';
    END IF;
  END IF;
  RETURN OLD;
END; $$;
CREATE TRIGGER guard_admin_role_delete BEFORE DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.guard_admin_role_delete();

-- ---------------------------------------------------------------------
-- 6. RPC de negocio
-- ---------------------------------------------------------------------
-- Pedido + productos de forma atómica. SECURITY INVOKER: aplica RLS del usuario.
-- Precio mayorista si p_wholesale o si el pedido suma 12+ unidades; precios desde products.
CREATE FUNCTION public.create_order(p_customer_name text, p_customer_phone text,
  p_delivery_date date, p_notes text, p_items jsonb, p_wholesale boolean DEFAULT false,
  p_delivery_address text DEFAULT NULL, p_delivery_time time DEFAULT NULL,
  p_payment_status text DEFAULT 'pending', p_payment_method text DEFAULT NULL,
  p_amount_paid integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  c_wholesale_min_units constant integer := 12;  -- mantener igual que la app
  v_id uuid; v_item jsonb; v_qty integer; v_units integer := 0;
  v_wholesale boolean; v_price integer; v_price_wholesale integer;
  v_unit integer; v_total integer := 0; v_paid integer;
  v_status text := coalesce(p_payment_status, 'pending');
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Cuenta inactiva'; END IF;
  IF nullif(trim(p_customer_name),'') IS NULL THEN RAISE EXCEPTION 'Cliente requerido'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0
  THEN RAISE EXCEPTION 'Agrega productos'; END IF;

  -- 1) Unidades -> ¿precio mayorista?
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::integer;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
    v_units := v_units + v_qty;
  END LOOP;
  v_wholesale := coalesce(p_wholesale, false) OR v_units >= c_wholesale_min_units;

  -- 2) Total con precios de la tabla products (valida que estén activos)
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT price, price_wholesale INTO v_price, v_price_wholesale
      FROM public.products
     WHERE id = (v_item->>'product_id')::uuid AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto no disponible'; END IF;
    v_unit := CASE WHEN v_wholesale THEN coalesce(v_price_wholesale, v_price) ELSE v_price END;
    v_total := v_total + coalesce(v_unit, 0) * (v_item->>'quantity')::integer;
  END LOOP;

  -- 3) Pago: medio obligatorio si hay pago; parcial con abono > 0 y < total
  IF v_status NOT IN ('pending', 'partial', 'paid') THEN RAISE EXCEPTION 'Tipo de pago inválido'; END IF;
  IF v_status <> 'pending' AND p_payment_method IS NULL THEN RAISE EXCEPTION 'Indica el medio de pago'; END IF;
  IF v_status = 'partial' AND coalesce(p_amount_paid, 0) <= 0 THEN RAISE EXCEPTION 'Indica el valor abonado'; END IF;
  IF v_status = 'partial' AND v_total > 0 AND p_amount_paid >= v_total
  THEN RAISE EXCEPTION 'El abono debe ser menor al total; usa Pago completo'; END IF;
  v_paid := CASE v_status WHEN 'paid' THEN v_total WHEN 'partial' THEN p_amount_paid ELSE 0 END;

  -- 4) Pedido y productos (sin UPDATE posterior: RLS solo deja actualizar al admin)
  INSERT INTO public.orders (seller_id, customer_name, customer_phone, delivery_date,
                             delivery_time, delivery_address, notes, wholesale,
                             payment_status, payment_method, amount_paid)
  VALUES ((SELECT auth.uid()), trim(p_customer_name), nullif(trim(p_customer_phone),''),
          p_delivery_date, p_delivery_time, nullif(trim(p_delivery_address),''),
          nullif(trim(p_notes),''), v_wholesale,
          v_status, CASE WHEN v_status = 'pending' THEN NULL ELSE p_payment_method END, v_paid)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT price, price_wholesale INTO v_price, v_price_wholesale
      FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    INSERT INTO public.order_items (order_id, product_id, quantity, notes, unit_price)
    VALUES (v_id, (v_item->>'product_id')::uuid, (v_item->>'quantity')::integer,
            nullif(trim(v_item->>'notes'),''),
            CASE WHEN v_wholesale THEN coalesce(v_price_wholesale, v_price) ELSE v_price END);
  END LOOP;
  RETURN v_id;
END; $$;


-- Cambio de estado de producción: solo modifica status; valida el rol explícitamente.
CREATE FUNCTION public.set_order_item_status(p_item_id uuid, p_status public.production_status)
RETURNS public.production_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status public.production_status;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (
       public.is_admin() OR public.has_role('production') OR public.has_role('sales_production'))
  THEN RAISE EXCEPTION 'No tienes permiso para cambiar estados de producción' USING ERRCODE = '42501'; END IF;
  IF p_status IS NULL THEN RAISE EXCEPTION 'Estado requerido' USING ERRCODE = '22004'; END IF;
  UPDATE public.order_items SET status = p_status WHERE id = p_item_id RETURNING status INTO v_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto del pedido no encontrado' USING ERRCODE = 'P0002'; END IF;
  RETURN v_status;
END; $$;

-- Nombres de vendedor para quien puede ver pedidos sin poder leer profiles.
-- Solo expone (id, full_name) de vendedores de pedidos visibles.
-- La condición replica la política "orders read": mantenerlas sincronizadas.
CREATE FUNCTION public.order_seller_names()
RETURNS TABLE (seller_id uuid, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, p.full_name
    FROM public.profiles p
   WHERE public.is_active_user()
     AND EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.seller_id = p.id
          AND (public.is_admin()
               OR public.has_role('production') OR public.has_role('sales_production')
               OR public.has_role('billing')    OR public.has_role('supervisor')
               OR (public.has_role('seller') AND o.seller_id = (SELECT auth.uid())))
     );
$$;

-- ---------------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles read" ON public.profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR public.is_admin());
CREATE POLICY "profiles admin update" ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- roles (catálogo de solo lectura)
CREATE POLICY "roles read" ON public.roles FOR SELECT TO authenticated
  USING (public.is_active_user());

-- user_roles
CREATE POLICY "user_roles read" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());
CREATE POLICY "user_roles admin insert" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "user_roles admin delete" ON public.user_roles FOR DELETE TO authenticated
  USING (public.is_admin());

-- products
CREATE POLICY "products read" ON public.products FOR SELECT TO authenticated
  USING (public.is_active_user());
CREATE POLICY "products admin insert" ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "products admin update" ON public.products FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- orders
CREATE POLICY "orders read" ON public.orders FOR SELECT TO authenticated
  USING (public.is_admin()
      OR public.has_role('production') OR public.has_role('sales_production')
      OR public.has_role('billing')    OR public.has_role('supervisor')
      OR (public.has_role('seller') AND seller_id = (SELECT auth.uid())));
CREATE POLICY "orders insert" ON public.orders FOR INSERT TO authenticated
  WITH CHECK ((public.is_admin() OR public.has_role('seller') OR public.has_role('sales_production'))
      AND public.is_active_user() AND seller_id = (SELECT auth.uid()));
CREATE POLICY "orders admin update" ON public.orders FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- order_items (lectura heredada de orders)
CREATE POLICY "items read" ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id));
CREATE POLICY "items insert" ON public.order_items FOR INSERT TO authenticated
  WITH CHECK ((public.is_admin() OR public.has_role('seller') OR public.has_role('sales_production'))
      AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.seller_id = (SELECT auth.uid())));
CREATE POLICY "items admin update" ON public.order_items FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
-- Sin políticas DELETE: nadie borra pedidos desde el frontend todavía.

-- ---------------------------------------------------------------------
-- 8. Privilegios (RLS filtra filas; aquí se limita qué puede intentar cada rol)
-- ---------------------------------------------------------------------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM authenticated;

-- service_role (Edge Functions login-username y create-user). Necesario si el proyecto se creó
-- con "Grant API access to new tables automatically" desactivado. Ignora RLS por diseño.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, UPDATE         ON public.profiles    TO authenticated;
GRANT SELECT                 ON public.roles       TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_roles  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.products    TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.orders      TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.order_items TO authenticated;

REVOKE ALL ON FUNCTION public.is_active_user()        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin()              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_roles()              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_order(text,text,date,text,jsonb,boolean,text,time,text,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_order_item_status(uuid, public.production_status) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.order_seller_names()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_profile()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_order_item_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_profile_update()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_admin_role_delete() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_roles()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_order(text,text,date,text,jsonb,boolean,text,time,text,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_item_status(uuid, public.production_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_seller_names() TO authenticated;

-- ---------------------------------------------------------------------
-- 9. Fotos de productos (Storage): bucket público, solo admin escribe
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images', 'product-images', true, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY "product images admin insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND public.is_admin());
CREATE POLICY "product images admin update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'product-images' AND public.is_admin());
CREATE POLICY "product images admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND public.is_admin());


-- ---------------------------------------------------------------------
-- 10. Historial de pagos: abono inicial (trigger) y register_payment
--     (solo Administrador y Facturación). Ver migración 20261119d.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_payments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  amount     integer NOT NULL CONSTRAINT order_payments_amount_check CHECK (amount <> 0), -- negativo = corrección
  method     text NOT NULL CHECK (method IN ('transfer', 'cash')),
  note       text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_payments_order_idx ON public.order_payments (order_id, created_at);

ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payments read" ON public.order_payments;
CREATE POLICY "payments read" ON public.order_payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id));
-- Sin políticas de escritura: solo el trigger y register_payment (SECURITY DEFINER).

REVOKE ALL ON public.order_payments FROM anon, authenticated;
GRANT SELECT ON public.order_payments TO authenticated;
GRANT ALL ON public.order_payments TO service_role;

-- Abono inicial al crear el pedido
CREATE OR REPLACE FUNCTION public.log_initial_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(NEW.amount_paid, 0) > 0 AND NEW.payment_method IS NOT NULL THEN
    INSERT INTO public.order_payments (order_id, amount, method, note, created_by, created_at)
    VALUES (NEW.id, NEW.amount_paid, NEW.payment_method, 'Abono inicial', NEW.seller_id, NEW.created_at);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS log_initial_payment ON public.orders;
CREATE TRIGGER log_initial_payment AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.log_initial_payment();

-- Registrar un pago posterior
CREATE OR REPLACE FUNCTION public.register_payment(p_order_id uuid, p_amount integer, p_method text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_total integer; v_paid integer; v_new integer; v_status text;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (public.is_admin() OR public.has_role('billing'))
  THEN RAISE EXCEPTION 'Solo Administración o Facturación registran pagos' USING ERRCODE = '42501'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('transfer', 'cash')
  THEN RAISE EXCEPTION 'Indica el medio de pago'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'El valor debe ser mayor a cero'; END IF;

  SELECT coalesce(amount_paid, 0) INTO v_paid FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002'; END IF;

  SELECT sum(unit_price * quantity) INTO v_total FROM public.order_items WHERE order_id = p_order_id;
  IF coalesce(v_total, 0) = 0 THEN RAISE EXCEPTION 'El pedido no tiene precios guardados'; END IF;
  IF v_paid >= v_total THEN RAISE EXCEPTION 'El pedido ya está pagado'; END IF;

  v_new := v_paid + p_amount;
  IF v_new > v_total THEN
    RAISE EXCEPTION 'El pago supera el saldo pendiente (%)', v_total - v_paid;
  END IF;
  v_status := CASE WHEN v_new >= v_total THEN 'paid' ELSE 'partial' END;

  UPDATE public.orders
     SET amount_paid = v_new, payment_status = v_status, payment_method = p_method
   WHERE id = p_order_id;
  INSERT INTO public.order_payments (order_id, amount, method, created_by)
  VALUES (p_order_id, p_amount, p_method, (SELECT auth.uid()));
  RETURN v_status;
END; $$;

REVOKE ALL ON FUNCTION public.log_initial_payment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_payment(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_payment(uuid, integer, text) TO authenticated;


-- ---------------------------------------------------------------------
-- 11. Editar pedido: cliente, productos (solo pendientes) y pago (Administrador/
--     Facturación). Ver 20261119e y 20261119f.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.update_order(
  p_order_id uuid, p_customer_name text, p_customer_phone text, p_delivery_address text,
  p_payment_status text DEFAULT NULL, p_payment_method text DEFAULT NULL,
  p_amount_paid integer DEFAULT NULL, p_items jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_wholesale_min_units constant integer := 12;  -- mantener igual que la app
  v_uid uuid := (SELECT auth.uid());
  v_order public.orders%ROWTYPE;
  v_can_bill boolean; v_is_owner boolean;
  v_total integer; v_new_paid integer; v_method text; v_diff integer;
  v_item jsonb; v_old public.order_items%ROWTYPE; v_qty integer; v_units integer;
  v_keep uuid[] := '{}'; v_price integer; v_price_w integer; v_status text; v_new_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002'; END IF;

  v_can_bill := public.is_admin() OR public.has_role('billing');
  v_is_owner := v_order.seller_id = v_uid
                AND (public.has_role('seller') OR public.has_role('sales_production'));
  IF NOT (v_can_bill OR v_is_owner) THEN
    RAISE EXCEPTION 'No tienes permiso para editar este pedido' USING ERRCODE = '42501';
  END IF;
  IF nullif(trim(p_customer_name), '') IS NULL THEN RAISE EXCEPTION 'Cliente requerido'; END IF;

  UPDATE public.orders
     SET customer_name    = trim(p_customer_name),
         customer_phone   = nullif(trim(p_customer_phone), ''),
         delivery_address = nullif(trim(p_delivery_address), '')
   WHERE id = p_order_id;

  -- ---------- Productos del pedido (opcional) ----------
  IF p_items IS NOT NULL THEN
    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'El pedido debe tener al menos un producto';
    END IF;
    PERFORM set_config('thian.order_edit', 'on', true);  -- solo esta transacción

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
      v_qty := (v_item->>'quantity')::integer;
      IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;

      IF nullif(v_item->>'id', '') IS NOT NULL THEN
        SELECT * INTO v_old FROM public.order_items
         WHERE id = (v_item->>'id')::uuid AND order_id = p_order_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Producto del pedido no encontrado'; END IF;
        v_keep := v_keep || v_old.id;
        IF v_old.quantity <> v_qty
           OR coalesce(v_old.notes, '') <> coalesce(nullif(trim(v_item->>'notes'), ''), '') THEN
          IF v_old.status <> 'pending' THEN
            RAISE EXCEPTION 'No se puede cambiar un producto que ya está en producción o finalizado';
          END IF;
          UPDATE public.order_items
             SET quantity = v_qty, notes = nullif(trim(v_item->>'notes'), '')
           WHERE id = v_old.id;
        END IF;
      ELSE
        SELECT price, price_wholesale INTO v_price, v_price_w
          FROM public.products WHERE id = (v_item->>'product_id')::uuid AND active;
        IF NOT FOUND THEN RAISE EXCEPTION 'Producto no disponible'; END IF;
        INSERT INTO public.order_items (order_id, product_id, quantity, notes, unit_price)
        VALUES (p_order_id, (v_item->>'product_id')::uuid, v_qty,
                nullif(trim(v_item->>'notes'), ''),
                CASE WHEN v_order.wholesale THEN coalesce(v_price_w, v_price) ELSE v_price END)
        RETURNING id INTO v_new_id;
        v_keep := v_keep || v_new_id;
      END IF;
    END LOOP;

    -- Quitar los que ya no vienen (solo pendientes)
    IF EXISTS (SELECT 1 FROM public.order_items
                WHERE order_id = p_order_id AND NOT (id = ANY (v_keep)) AND status <> 'pending') THEN
      RAISE EXCEPTION 'No se puede quitar un producto que ya está en producción o finalizado';
    END IF;
    DELETE FROM public.order_items WHERE order_id = p_order_id AND NOT (id = ANY (v_keep));

    -- Regla mayorista: 12+ unidades -> precio mayorista para todo el pedido
    SELECT coalesce(sum(quantity), 0) INTO v_units FROM public.order_items WHERE order_id = p_order_id;
    IF NOT v_order.wholesale AND v_units >= c_wholesale_min_units THEN
      UPDATE public.orders SET wholesale = true WHERE id = p_order_id;
      UPDATE public.order_items i
         SET unit_price = coalesce(p.price_wholesale, p.price)
        FROM public.products p
       WHERE i.order_id = p_order_id AND p.id = i.product_id;
    END IF;
  END IF;

  SELECT coalesce(sum(unit_price * quantity), 0) INTO v_total
    FROM public.order_items WHERE order_id = p_order_id;

  -- ---------- Pago (opcional): solo Administrador y Facturación ----------
  IF p_payment_status IS NOT NULL THEN
    IF NOT v_can_bill THEN
      RAISE EXCEPTION 'Solo Administración o Facturación editan el pago' USING ERRCODE = '42501';
    END IF;
    IF p_payment_status NOT IN ('pending', 'partial', 'paid') THEN
      RAISE EXCEPTION 'Tipo de pago inválido';
    END IF;
    IF p_payment_method IS NOT NULL AND p_payment_method NOT IN ('transfer', 'cash') THEN
      RAISE EXCEPTION 'Medio de pago inválido';
    END IF;
    IF p_payment_status <> 'pending' AND p_payment_method IS NULL THEN
      RAISE EXCEPTION 'Indica el medio de pago';
    END IF;
    IF p_payment_status <> 'pending' AND v_total = 0 THEN
      RAISE EXCEPTION 'El pedido no tiene precios guardados';
    END IF;

    v_new_paid := CASE p_payment_status
                    WHEN 'paid' THEN v_total
                    WHEN 'pending' THEN 0
                    ELSE p_amount_paid END;
    IF p_payment_status = 'partial'
       AND (v_new_paid IS NULL OR v_new_paid <= 0 OR v_new_paid >= v_total) THEN
      RAISE EXCEPTION 'En pago parcial el abono debe ser mayor a 0 y menor al total (%)', v_total;
    END IF;

    v_method := CASE WHEN p_payment_status = 'pending' THEN NULL ELSE p_payment_method END;
    v_diff := v_new_paid - coalesce(v_order.amount_paid, 0);
    IF v_diff <> 0 THEN
      INSERT INTO public.order_payments (order_id, amount, method, note, created_by)
      VALUES (p_order_id, v_diff,
              coalesce(p_payment_method, v_order.payment_method, 'cash'),
              'Corrección', v_uid);
    END IF;

    UPDATE public.orders
       SET payment_status = p_payment_status,
           payment_method = v_method,
           amount_paid    = v_new_paid
     WHERE id = p_order_id;

  ELSIF p_items IS NOT NULL THEN
    -- Sin cambios de pago: el estado se ajusta al nuevo total
    v_new_paid := coalesce(v_order.amount_paid, 0);
    IF v_new_paid > v_total THEN
      RAISE EXCEPTION 'Lo abonado (%) supera el nuevo total (%): ajusta también el pago', v_new_paid, v_total;
    END IF;
    v_status := CASE WHEN v_new_paid = 0 THEN 'pending'
                     WHEN v_new_paid >= v_total THEN 'paid'
                     ELSE 'partial' END;
    UPDATE public.orders SET payment_status = v_status WHERE id = p_order_id;
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public.update_order(uuid,text,text,text,text,text,integer,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order(uuid,text,text,text,text,text,integer,jsonb) TO authenticated;

COMMIT;

-- =====================================================================
-- PRIMER ADMINISTRADOR (ejecutar aparte, DESPUÉS de crear el usuario en
-- Authentication → Users → Add user, con "Auto Confirm User" marcado).
-- Reemplaza el correo, el username y el nombre:
--
-- BEGIN;
-- UPDATE public.profiles
--    SET username = 'admin.thian', full_name = 'Nombre Apellido'
--  WHERE id = (SELECT id FROM auth.users WHERE email = 'CORREO@EJEMPLO.COM');
-- INSERT INTO public.user_roles (user_id, role_id)
-- SELECT u.id, r.id FROM auth.users u, public.roles r
--  WHERE u.email = 'CORREO@EJEMPLO.COM' AND r.code = 'admin'
-- ON CONFLICT DO NOTHING;
-- COMMIT;
--
-- Verificación:
-- SELECT p.username, p.full_name, p.active, array_agg(r.code ORDER BY r.id) AS roles
--   FROM public.profiles p
--   LEFT JOIN public.user_roles ur ON ur.user_id = p.id
--   LEFT JOIN public.roles r ON r.id = ur.role_id
--  GROUP BY p.id;
-- =====================================================================
