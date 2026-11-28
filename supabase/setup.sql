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
  ('billing',          'Facturación');

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

-- ---------------------------------------------------------------------
-- 12. Cancelar pedidos (migración 20261123_cancel_order).
-- ---------------------------------------------------------------------

-- ---------- 1. Columnas ----------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by  uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- ---------- 2. RPC cancel_order ----------
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order public.orders%ROWTYPE;
  v_can_bill boolean; v_is_owner boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = '42501';
  END IF;
  IF nullif(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Indica el motivo de la cancelación'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_order.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'El pedido ya está cancelado'; END IF;

  v_can_bill := public.is_admin() OR public.has_role('billing');
  v_is_owner := v_order.seller_id = v_uid AND public.has_role('seller');
  IF NOT v_can_bill THEN
    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'No tienes permiso para cancelar este pedido' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.order_items WHERE order_id = p_order_id AND status <> 'pending') THEN
      RAISE EXCEPTION 'El pedido ya está en producción: pide a Administración que lo cancele';
    END IF;
  END IF;

  UPDATE public.orders
     SET cancelled_at = now(), cancelled_by = v_uid, cancel_reason = trim(p_reason)
   WHERE id = p_order_id;
END; $$;

REVOKE ALL ON FUNCTION public.cancel_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated;

-- ---------- 3. set_order_item_status: rechaza pedidos cancelados ----------
-- Misma firma y permisos (se retira sales_production, rol que deja de existir).
CREATE OR REPLACE FUNCTION public.set_order_item_status(p_item_id uuid, p_status public.production_status)
RETURNS public.production_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status public.production_status;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (public.is_admin() OR public.has_role('production'))
  THEN RAISE EXCEPTION 'No tienes permiso para cambiar estados de producción' USING ERRCODE = '42501'; END IF;
  IF p_status IS NULL THEN RAISE EXCEPTION 'Estado requerido' USING ERRCODE = '22004'; END IF;
  IF EXISTS (SELECT 1 FROM public.order_items i JOIN public.orders o ON o.id = i.order_id
              WHERE i.id = p_item_id AND o.cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'El pedido está cancelado';
  END IF;
  UPDATE public.order_items SET status = p_status WHERE id = p_item_id RETURNING status INTO v_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto del pedido no encontrado' USING ERRCODE = 'P0002'; END IF;
  RETURN v_status;
END; $$;


-- ---------------------------------------------------------------------
-- 13. Facturación por entrega y domicilio por municipio (migración 20261121).
--     Reemplaza create_order y update_order de las secciones anteriores.
-- ---------------------------------------------------------------------

-- ---------- 1. Roles retirados ----------
-- user_roles se borra en cascada (ON DELETE CASCADE).
DELETE FROM public.roles WHERE code IN ('supervisor', 'sales_production');

-- ---------- 2. Zonas de domicilio ----------
CREATE TABLE IF NOT EXISTS public.delivery_zones (
  code   text PRIMARY KEY,
  name   text NOT NULL,
  fee    integer NOT NULL CHECK (fee >= 0),   -- COP
  sort   smallint NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
INSERT INTO public.delivery_zones (code, name, fee, sort) VALUES
  ('piedecuesta',   'Piedecuesta',       6000, 1),
  ('floridablanca', 'Floridablanca',     8000, 2),
  ('bucaramanga',   'Bucaramanga',      10000, 3),
  ('giron',         'Girón',            10000, 4),
  ('pickup',        'Recoge en tienda',     0, 5)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, fee = EXCLUDED.fee, sort = EXCLUDED.sort;

ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "zones read" ON public.delivery_zones;
CREATE POLICY "zones read" ON public.delivery_zones FOR SELECT TO authenticated
  USING (public.is_active_user());
REVOKE ALL ON public.delivery_zones FROM anon, authenticated;
GRANT SELECT ON public.delivery_zones TO authenticated;
GRANT ALL ON public.delivery_zones TO service_role;

-- ---------- 3. Domicilio en el pedido ----------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_zone text REFERENCES public.delivery_zones(code),
  ADD COLUMN IF NOT EXISTS delivery_fee  integer NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0);

-- ---------- 4. Facturas ----------
CREATE TABLE IF NOT EXISTS public.invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number     bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  order_id           uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  order_number       bigint NOT NULL,
  created_by         uuid NOT NULL REFERENCES public.profiles(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  customer_name      text NOT NULL,
  customer_phone     text,
  delivery_address   text,
  delivery_zone_name text,
  delivery_date      date,
  delivery_time      time,
  wholesale          boolean NOT NULL DEFAULT false,
  items              jsonb NOT NULL,   -- [{name, quantity, unit_price, notes}]
  subtotal           integer NOT NULL,
  delivery_fee       integer NOT NULL DEFAULT 0,
  total              integer NOT NULL,
  amount_paid        integer NOT NULL DEFAULT 0,
  balance            integer NOT NULL,
  payment_method     text
);
CREATE INDEX IF NOT EXISTS invoices_created_idx ON public.invoices (created_at DESC);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoices read" ON public.invoices;
CREATE POLICY "invoices read" ON public.invoices FOR SELECT TO authenticated
  USING (public.is_admin() OR public.has_role('billing'));
-- Sin políticas de escritura: solo create_invoice (SECURITY DEFINER).
REVOKE ALL ON public.invoices FROM anon, authenticated;
GRANT SELECT ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;

CREATE OR REPLACE FUNCTION public.create_invoice(p_order_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_o public.orders%ROWTYPE;
  v_items jsonb; v_sub integer; v_zone text; v_total integer; v_paid integer; v_no bigint;
BEGIN
  IF v_uid IS NULL OR NOT public.is_active_user()
     OR NOT (public.is_admin() OR public.has_role('billing')) THEN
    RAISE EXCEPTION 'Solo Administración o Facturación generan facturas' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_o.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'El pedido está cancelado'; END IF;
  IF EXISTS (SELECT 1 FROM public.invoices WHERE order_id = p_order_id AND voided_at IS NULL) THEN
    RAISE EXCEPTION 'Este pedido ya tiene factura';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'name', p.name, 'quantity', i.quantity,
           'unit_price', coalesce(i.unit_price, 0), 'notes', i.notes)
           ORDER BY i.created_at, p.name), '[]'::jsonb),
         coalesce(sum(coalesce(i.unit_price, 0) * i.quantity), 0)
    INTO v_items, v_sub
    FROM public.order_items i JOIN public.products p ON p.id = i.product_id
   WHERE i.order_id = p_order_id;
  IF jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION 'El pedido no tiene productos'; END IF;

  SELECT name INTO v_zone FROM public.delivery_zones WHERE code = v_o.delivery_zone;
  v_total := v_sub + coalesce(v_o.delivery_fee, 0);
  v_paid  := least(coalesce(v_o.amount_paid, 0), v_total);

  INSERT INTO public.invoices (order_id, order_number, created_by, customer_name, customer_phone,
    delivery_address, delivery_zone_name, delivery_date, delivery_time, wholesale, items,
    subtotal, delivery_fee, total, amount_paid, balance, payment_method)
  VALUES (p_order_id, v_o.order_number, v_uid, v_o.customer_name, v_o.customer_phone,
    v_o.delivery_address, v_zone, v_o.delivery_date, v_o.delivery_time, v_o.wholesale, v_items,
    v_sub, coalesce(v_o.delivery_fee, 0), v_total, v_paid, v_total - v_paid, v_o.payment_method)
  RETURNING invoice_number INTO v_no;
  RETURN v_no;
END; $$;

REVOKE ALL ON FUNCTION public.create_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice(uuid) TO authenticated;

-- ---------- 5a. create_order con municipio ----------
DROP FUNCTION IF EXISTS public.create_order(text,text,date,text,jsonb,boolean,text,time,text,text,integer);
CREATE FUNCTION public.create_order(p_customer_name text, p_customer_phone text,
  p_delivery_date date, p_notes text, p_items jsonb, p_wholesale boolean DEFAULT false,
  p_delivery_address text DEFAULT NULL, p_delivery_time time DEFAULT NULL,
  p_payment_status text DEFAULT 'pending', p_payment_method text DEFAULT NULL,
  p_amount_paid integer DEFAULT NULL, p_delivery_zone text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  c_wholesale_min_units constant integer := 12;  -- mantener igual que la app
  v_id uuid; v_item jsonb; v_qty integer; v_units integer := 0;
  v_wholesale boolean; v_price integer; v_price_wholesale integer;
  v_qty_by_product jsonb;  -- unidades por producto (regla mayorista por referencia)
  v_unit integer; v_total integer := 0; v_paid integer; v_fee integer := 0;
  v_status text := coalesce(p_payment_status, 'pending');
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Cuenta inactiva'; END IF;
  IF nullif(trim(p_customer_name),'') IS NULL THEN RAISE EXCEPTION 'Cliente requerido'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0
  THEN RAISE EXCEPTION 'Agrega productos'; END IF;

  -- 0) Domicilio: el valor sale de delivery_zones
  IF p_delivery_zone IS NOT NULL THEN
    SELECT fee INTO v_fee FROM public.delivery_zones WHERE code = p_delivery_zone AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Municipio de entrega no válido'; END IF;
  END IF;

  -- 1) Cantidades válidas y unidades por referencia (mismo product_id suma).
  --    Mayorista POR REFERENCIA: un producto va a precio mayorista si ese
  --    producto suma 12+ unidades. p_wholesale se ignora (se mantiene la firma).
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::integer;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
    v_units := v_units + v_qty;
  END LOOP;
  SELECT coalesce(jsonb_object_agg(pid, q), '{}'::jsonb) INTO v_qty_by_product
    FROM (SELECT x->>'product_id' AS pid, sum((x->>'quantity')::integer) AS q
            FROM jsonb_array_elements(p_items) AS x GROUP BY 1) AS t;
  v_wholesale := EXISTS (SELECT 1 FROM jsonb_each_text(v_qty_by_product) AS e
                          WHERE e.value::integer >= c_wholesale_min_units);

  -- 2) Total con precios de la tabla products (valida que estén activos) + domicilio
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT price, price_wholesale INTO v_price, v_price_wholesale
      FROM public.products
     WHERE id = (v_item->>'product_id')::uuid AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto no disponible'; END IF;
    v_unit := CASE WHEN (v_qty_by_product->>(v_item->>'product_id'))::integer >= c_wholesale_min_units
                   THEN coalesce(v_price_wholesale, v_price) ELSE v_price END;
    v_total := v_total + coalesce(v_unit, 0) * (v_item->>'quantity')::integer;
  END LOOP;
  v_total := v_total + v_fee;

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
                             payment_status, payment_method, amount_paid,
                             delivery_zone, delivery_fee)
  VALUES ((SELECT auth.uid()), trim(p_customer_name), nullif(trim(p_customer_phone),''),
          p_delivery_date, p_delivery_time, nullif(trim(p_delivery_address),''),
          nullif(trim(p_notes),''), v_wholesale,
          v_status, CASE WHEN v_status = 'pending' THEN NULL ELSE p_payment_method END, v_paid,
          p_delivery_zone, v_fee)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT price, price_wholesale INTO v_price, v_price_wholesale
      FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    INSERT INTO public.order_items (order_id, product_id, quantity, notes, unit_price)
    VALUES (v_id, (v_item->>'product_id')::uuid, (v_item->>'quantity')::integer,
            nullif(trim(v_item->>'notes'),''),
            CASE WHEN (v_qty_by_product->>(v_item->>'product_id'))::integer >= c_wholesale_min_units
                 THEN coalesce(v_price_wholesale, v_price) ELSE v_price END);
  END LOOP;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.create_order(text,text,date,text,jsonb,boolean,text,time,text,text,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(text,text,date,text,jsonb,boolean,text,time,text,text,integer,text) TO authenticated;

-- ---------- 5b. update_order con municipio y bloqueo si está facturado ----------
DROP FUNCTION IF EXISTS public.update_order(uuid,text,text,text,text,text,integer,jsonb);
CREATE FUNCTION public.update_order(
  p_order_id uuid, p_customer_name text, p_customer_phone text, p_delivery_address text,
  p_payment_status text DEFAULT NULL, p_payment_method text DEFAULT NULL,
  p_amount_paid integer DEFAULT NULL, p_items jsonb DEFAULT NULL,
  p_delivery_zone text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_wholesale_min_units constant integer := 12;  -- mantener igual que la app
  v_uid uuid := (SELECT auth.uid());
  v_order public.orders%ROWTYPE;
  v_can_bill boolean; v_is_owner boolean; v_invoiced boolean; v_zone_changed boolean;
  v_total integer; v_new_paid integer; v_method text; v_diff integer; v_fee integer;
  v_item jsonb; v_old public.order_items%ROWTYPE; v_qty integer; v_units integer;
  v_keep uuid[] := '{}'; v_price integer; v_price_w integer; v_status text; v_new_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_order.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'El pedido está cancelado'; END IF;

  v_can_bill := public.is_admin() OR public.has_role('billing');
  v_is_owner := v_order.seller_id = v_uid AND public.has_role('seller');
  IF NOT (v_can_bill OR v_is_owner) THEN
    RAISE EXCEPTION 'No tienes permiso para editar este pedido' USING ERRCODE = '42501';
  END IF;
  IF nullif(trim(p_customer_name), '') IS NULL THEN RAISE EXCEPTION 'Cliente requerido'; END IF;

  v_invoiced := EXISTS (SELECT 1 FROM public.invoices WHERE order_id = p_order_id AND voided_at IS NULL);
  v_zone_changed := p_delivery_zone IS NOT NULL
                    AND p_delivery_zone IS DISTINCT FROM v_order.delivery_zone;
  IF v_invoiced AND (p_items IS NOT NULL OR v_zone_changed) THEN
    RAISE EXCEPTION 'El pedido ya está facturado: no se pueden cambiar productos ni domicilio';
  END IF;

  UPDATE public.orders
     SET customer_name    = trim(p_customer_name),
         customer_phone   = nullif(trim(p_customer_phone), ''),
         delivery_address = nullif(trim(p_delivery_address), '')
   WHERE id = p_order_id;

  -- ---------- Domicilio (opcional) ----------
  IF v_zone_changed THEN
    SELECT fee INTO v_fee FROM public.delivery_zones WHERE code = p_delivery_zone AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Municipio de entrega no válido'; END IF;
    UPDATE public.orders SET delivery_zone = p_delivery_zone, delivery_fee = v_fee
     WHERE id = p_order_id;
  END IF;
  SELECT delivery_fee INTO v_fee FROM public.orders WHERE id = p_order_id;

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
                v_price)  -- el precio definitivo se fija abajo, por referencia
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

    -- Regla mayorista POR REFERENCIA: cada producto con 12+ unidades en el
    -- pedido va a precio mayorista; el resto a precio general. Solo se
    -- recalculan las líneas pendientes (las de producción conservan su precio).
    UPDATE public.order_items i
       SET unit_price = CASE WHEN q.units >= c_wholesale_min_units
                             THEN coalesce(p.price_wholesale, p.price) ELSE p.price END
      FROM public.products p,
           (SELECT product_id, sum(quantity) AS units FROM public.order_items
             WHERE order_id = p_order_id GROUP BY product_id) AS q
     WHERE i.order_id = p_order_id AND i.status = 'pending'
       AND p.id = i.product_id AND q.product_id = i.product_id;
    UPDATE public.orders
       SET wholesale = EXISTS (SELECT 1 FROM public.order_items
                                WHERE order_id = p_order_id
                                GROUP BY product_id
                               HAVING sum(quantity) >= c_wholesale_min_units)
     WHERE id = p_order_id;
  END IF;

  -- Total = productos + domicilio
  SELECT coalesce(sum(unit_price * quantity), 0) + coalesce(v_fee, 0) INTO v_total
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

  ELSIF p_items IS NOT NULL OR v_zone_changed THEN
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

REVOKE ALL ON FUNCTION public.update_order(uuid,text,text,text,text,text,integer,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order(uuid,text,text,text,text,text,integer,jsonb,text) TO authenticated;


-- =====================================================================
-- 14. Precio mayorista por referencia (migración 20261124): ya aplicado
--     dentro de create_order / update_order de la sección 13.
-- =====================================================================

-- =====================================================================
-- 15. Anular factura y volver a facturar (migración 20261125).
--     create_invoice / update_order de la sección 13 ya ignoran las anuladas.
-- =====================================================================
-- Columnas de anulación (la factura no se borra nunca)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS voided_at   timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by   uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS void_reason text;

-- Una sola factura ACTIVA por pedido (antes: una por pedido para siempre)
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_order_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_active_per_order
  ON public.invoices (order_id) WHERE voided_at IS NULL;

CREATE OR REPLACE FUNCTION public.void_invoice(p_invoice_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_inv public.invoices%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo el Administrador anula facturas' USING ERRCODE = '42501';
  END IF;
  IF nullif(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Indica el motivo de la anulación';
  END IF;
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factura no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_inv.voided_at IS NOT NULL THEN RAISE EXCEPTION 'La factura ya está anulada'; END IF;
  UPDATE public.invoices
     SET voided_at = now(), voided_by = v_uid, void_reason = trim(p_reason)
   WHERE id = p_invoice_id;
END; $$;

REVOKE ALL ON FUNCTION public.void_invoice(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_invoice(uuid, text) TO authenticated;

-- =====================================================================
-- 16. Proveedor del producto (migración 20261126).
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suppliers read" ON public.suppliers FOR SELECT TO authenticated
  USING (public.is_active_user());
CREATE POLICY "suppliers admin insert" ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "suppliers admin update" ON public.suppliers FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT, INSERT, UPDATE ON public.suppliers TO authenticated;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS products_supplier_idx ON public.products (supplier_id);

-- =====================================================================
-- 17. Costo de los productos (migración 20261126_product_costs).
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.product_costs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  cost       integer NOT NULL CHECK (cost >= 0),          -- COP por unidad
  valid_from timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_costs_product_idx
  ON public.product_costs (product_id, valid_from DESC);
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_costs admin read" ON public.product_costs FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY "product_costs admin insert" ON public.product_costs FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND created_by = (SELECT auth.uid()));
GRANT SELECT, INSERT ON public.product_costs TO authenticated;

-- Proveedor propio (producción de Thian): no se le paga a terceros.
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS own boolean NOT NULL DEFAULT false;
UPDATE public.suppliers SET own = true WHERE name ILIKE 'thian%';

-- =====================================================================
-- 18. Clasificación de clientes mayoristas (migración 20261127).
-- =====================================================================
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

-- =====================================================================
-- 19. Listas de precios mayoristas, fase 1: vendedor -> lista (migración 20261127b).
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.price_lists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 60),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.seller_price_lists (
  seller_id     uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  price_list_id uuid NOT NULL REFERENCES public.price_lists(id) ON DELETE RESTRICT,
  assigned_by   uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  assigned_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seller_price_lists_list_idx ON public.seller_price_lists (price_list_id);

ALTER TABLE public.price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_price_lists ENABLE ROW LEVEL SECURITY;

-- price_lists: admin todo; el vendedor solo lee la lista que tiene asignada
CREATE POLICY "price_lists read" ON public.price_lists FOR SELECT TO authenticated
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.seller_price_lists s
     WHERE s.price_list_id = price_lists.id AND s.seller_id = (SELECT auth.uid())));
CREATE POLICY "price_lists admin insert" ON public.price_lists FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "price_lists admin update" ON public.price_lists FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT, INSERT, UPDATE ON public.price_lists TO authenticated;

-- seller_price_lists: admin todo; el vendedor solo lee su fila
CREATE POLICY "seller_price_lists read" ON public.seller_price_lists FOR SELECT TO authenticated
  USING (public.is_admin() OR seller_id = (SELECT auth.uid()));
CREATE POLICY "seller_price_lists admin insert" ON public.seller_price_lists FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "seller_price_lists admin update" ON public.seller_price_lists FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "seller_price_lists admin delete" ON public.seller_price_lists FOR DELETE TO authenticated
  USING (public.is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_price_lists TO authenticated;
