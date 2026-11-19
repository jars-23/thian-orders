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
  notes          text,
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
  IF NOT public.is_admin() AND (SELECT auth.uid()) IS NOT NULL AND (
     NEW.id IS DISTINCT FROM OLD.id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR
     NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.quantity IS DISTINCT FROM OLD.quantity OR
     NEW.notes IS DISTINCT FROM OLD.notes OR NEW.created_at IS DISTINCT FROM OLD.created_at)
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
CREATE FUNCTION public.create_order(p_customer_name text, p_customer_phone text,
  p_delivery_date date, p_notes text, p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id uuid; v_item jsonb;
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Cuenta inactiva'; END IF;
  IF nullif(trim(p_customer_name),'') IS NULL THEN RAISE EXCEPTION 'Cliente requerido'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0
  THEN RAISE EXCEPTION 'Agrega productos'; END IF;
  INSERT INTO public.orders (seller_id, customer_name, customer_phone, delivery_date, notes)
  VALUES ((SELECT auth.uid()), trim(p_customer_name), nullif(trim(p_customer_phone),''),
          p_delivery_date, nullif(trim(p_notes),''))
  RETURNING id INTO v_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = (v_item->>'product_id')::uuid AND active)
    THEN RAISE EXCEPTION 'Producto no disponible'; END IF;
    INSERT INTO public.order_items (order_id, product_id, quantity, notes)
    VALUES (v_id, (v_item->>'product_id')::uuid, (v_item->>'quantity')::integer,
            nullif(trim(v_item->>'notes'),''));
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
REVOKE ALL ON FUNCTION public.create_order(text,text,date,text,jsonb) FROM PUBLIC, anon;
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
GRANT EXECUTE ON FUNCTION public.create_order(text,text,date,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_item_status(uuid, public.production_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_seller_names() TO authenticated;

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
