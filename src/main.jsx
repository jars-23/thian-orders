import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  Users,
  LogOut,
  Plus,
  Minus,
  RefreshCw,
  ShoppingCart,
  Trash2,
  ImagePlus,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  Pencil,
  X,
} from "lucide-react";
import "./style.css";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { theme } from "./theme/theme";
import LoginForm from "./components/auth/LoginForm";
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = url && key ? createClient(url, key) : null;
const labels = {
  pending: "Pendiente",
  in_progress: "En proceso",
  finished: "Finalizado",
};
const fmtDate = (d) =>
  d ? new Date(d + "T12:00:00").toLocaleDateString("es-CO") : "Sin fecha";
// "14:30:00" -> "2:30 p. m."
const fmtTime = (t) =>
  t
    ? new Date(`1970-01-01T${t}`).toLocaleTimeString("es-CO", {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
const fmtMoney = (n) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      }).format(n);
const PRODUCT_BUCKET = "product-images";
// Regla de negocio: desde estas unidades por pedido aplica precio mayorista.
// Debe coincidir con c_wholesale_min_units en create_order (SQL).
const WHOLESALE_MIN_UNITS = 10;
// Deben coincidir con los CHECK de orders.payment_status / payment_method.
const PAYMENT_STATUS = {
  pending: "Pago pendiente",
  partial: "Pago parcial",
  paid: "Pago completo",
};
const PAYMENT_METHOD = { transfer: "Transferencia", cash: "Efectivo" };
// Reduce la foto a máx. 1000 px y la pasa a WebP (JPEG si el navegador no
// codifica WebP) para que el catálogo cargue rápido en el celular.
async function resizeImage(file, max = 1000) {
  if (!file?.type?.startsWith("image/"))
    throw new Error("El archivo debe ser una imagen (JPG, PNG o WebP).");
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const toBlob = (type) =>
    new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
  let blob = await toBlob("image/webp");
  if (!blob || blob.type !== "image/webp") blob = await toBlob("image/jpeg");
  if (!blob) throw new Error("No se pudo procesar la imagen.");
  return blob;
}
function App() {
  const [session, setSession] = useState(null),
    [profile, setProfile] = useState(null),
    [roles, setRoles] = useState([]),
    [roleCatalog, setRoleCatalog] = useState([]),
    [assignments, setAssignments] = useState([]),
    [tab, setTab] = useState("dashboard"),
    [products, setProducts] = useState([]),
    [orders, setOrders] = useState([]),
    [sellers, setSellers] = useState([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  // Menú lateral (escritorio): se abre y se recoge con el botón, y se recoge
  // solo al entrar a una sección. El estado se recuerda en este navegador.
  const [roleNames, setRoleNames] = useState([]);
  const [navCollapsed, setNavCollapsedState] = useState(() => {
    try {
      return localStorage.getItem("thian.navCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const setNavCollapsed = (v) => {
    setNavCollapsedState(v);
    try {
      localStorage.setItem("thian.navCollapsed", v ? "1" : "0");
    } catch {
      /* sin almacenamiento: solo dura la sesión */
    }
  };
  const toggleNav = () => setNavCollapsed(!navCollapsed);
  const hasRole = (...codes) => codes.some((c) => roles.includes(c));
  const admin = hasRole("admin");
  // Deben coincidir con las políticas RLS (supabase/migrate_v1_2.sql).
  const canSell = hasRole("admin", "seller", "sales_production");
  const canProduce = hasRole("admin", "production", "sales_production");
  // Debe coincidir con register_payment (SQL): Administrador y Facturación.
  const canBill = hasRole("admin", "billing");
  const message = (err, ok) => {
    setError(err?.message || "");
    setNotice(err ? "" : ok || "Guardado correctamente");
  };
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) {
      setProfile(null);
      setRoles([]);
      setOrders([]);
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()
      .then(({ data, error }) => {
        if (active) {
          setProfile(error ? null : data);
          if (error) setError(error.message);
          else
            supabase.rpc("my_roles").then(({ data: rs, error: re }) => {
              if (active) {
                setRoles((rs || []).map((x) => x.code));
                setRoleNames((rs || []).map((x) => x.name));
                if (re) setError(re.message);
              }
            });
        }
      });
    return () => {
      active = false;
    };
  }, [session]);
  async function reload() {
    if (!profile?.active) return;
    setBusy(true);
    const [p, o, sn, s, r, ur] = await Promise.all([
      supabase
        .from("products")
        .select("*")
        .order("category", { nullsFirst: false })
        .order("name"),
      supabase
        .from("orders")
        .select(
          "*,order_items(id,product_id,quantity,status,notes,unit_price,products(name,image_url)),order_payments(id,amount,method,note,created_at)",
        )
        .order("created_at", { ascending: false }),
      // profiles solo es legible por el propio usuario o admin; esta RPC
      // expone solo el nombre de los vendedores de pedidos visibles.
      supabase.rpc("order_seller_names"),
      admin
        ? supabase.from("profiles").select("*").order("full_name")
        : Promise.resolve({ data: [], error: null }),
      admin
        ? supabase.from("roles").select("*").order("id")
        : Promise.resolve({ data: [], error: null }),
      admin
        ? supabase.from("user_roles").select("user_id,role_id")
        : Promise.resolve({ data: [], error: null }),
    ]);
    const err = p.error || o.error || s.error || r.error || ur.error;
    if (err) message(err);
    else {
      setProducts(p.data || []);
      // Si la RPC falla (p. ej. migración sin aplicar) los pedidos se
      // muestran igual, con "—" como vendedor.
      if (sn.error) console.warn("order_seller_names:", sn.error.message);
      const sellerNames = new Map(
        (sn.data || []).map((x) => [x.seller_id, x.full_name]),
      );
      setOrders(
        (o.data || []).map((x) => ({
          ...x,
          seller_name: sellerNames.get(x.seller_id) || null,
        })),
      );
      setSellers(s.data || []);
      setRoleCatalog(r.data || []);
      setAssignments(ur.data || []);
    }
    setBusy(false);
  }
  useEffect(() => {
    if (profile?.active && roles.length) reload();
  }, [profile?.id, profile?.active, roles.join("|")]);
  async function signin(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const username = String(fd.get("username") || "").trim();
    if (!/^[a-zA-Z0-9._]{4,20}$/.test(username)) {
      setError("Ingresa un nombre de usuario válido.");
      setBusy(false);
      return;
    }
    const { data, error } = await supabase.functions.invoke("login-username", {
      body: { username, password: String(fd.get("password") || "") },
    });
    if (error || !data?.access_token || !data?.refresh_token) {
      setError("Usuario o contraseña incorrectos.");
      setBusy(false);
      return;
    }
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (sessionError)
      setError("No se pudo iniciar sesión. Intenta nuevamente.");
    setBusy(false);
  }
  async function saveUsername(userId, username) {
    const value = username.trim();
    if (!/^[a-zA-Z0-9._]{4,20}$/.test(value)) {
      setError(
        "El username debe tener entre 4 y 20 caracteres: letras, números, punto o guion bajo.",
      );
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ username: value })
      .eq("id", userId);
    message(error, "Username actualizado");
    if (!error) await reload();
    setBusy(false);
  }
  async function setUserRole(userId, roleId, enabled) {
    setBusy(true);
    setError("");
    const query = enabled
      ? supabase.from("user_roles").insert({ user_id: userId, role_id: roleId })
      : supabase
          .from("user_roles")
          .delete()
          .eq("user_id", userId)
          .eq("role_id", roleId);
    const { error } = await query;
    message(error, "Roles actualizados");
    if (!error) await reload();
    setBusy(false);
  }
  async function createUser(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const form = e.currentTarget,
      fd = new FormData(form);
    const payload = {
      full_name: String(fd.get("full_name") || "").trim(),
      username: String(fd.get("username") || "").trim(),
      email: String(fd.get("email") || "").trim(),
      password: String(fd.get("password") || ""),
      roles: fd.getAll("roles"),
    };
    if (!/^[a-zA-Z0-9._]{4,20}$/.test(payload.username)) {
      setError(
        "Username inválido: entre 4 y 20 caracteres, letras, números, punto o guion bajo.",
      );
      setBusy(false);
      return;
    }
    if (!payload.roles.length) {
      setError("Selecciona al menos un rol.");
      setBusy(false);
      return;
    }
    const { data, error } = await supabase.functions.invoke("create-user", {
      body: payload,
    });
    if (error || data?.error) {
      let detail = data?.error || "No fue posible crear la cuenta.";
      if (error?.context) {
        try {
          const body = await error.context.json();
          detail = body.error || detail;
        } catch {}
      }
      setError(detail);
    } else {
      setNotice("Usuario creado correctamente.");
      form.reset();
      await reload();
    }
    setBusy(false);
  }
  async function createProduct(e) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const { error } = await supabase
      .from("products")
      .insert({
        name: f.get("name").trim(),
        sku: f.get("sku")?.trim() || null,
        category: f.get("category")?.trim() || null,
        price: f.get("price") === "" ? null : Number(f.get("price")),
        price_wholesale:
          f.get("price_wholesale") === "" ? null : Number(f.get("price_wholesale")),
        description: f.get("description") || null,
        image_url: f.get("image_url") || null,
      });
    message(error, "Producto registrado");
    if (!error) {
      e.currentTarget.reset();
      await reload();
    }
    setBusy(false);
  }
  async function createOrder(e, lines, wholesale, payment) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.rpc("create_order", {
      p_customer_name: f.get("customer_name"),
      p_customer_phone: f.get("customer_phone"),
      p_delivery_date: f.get("delivery_date") || null,
      p_notes: f.get("notes"),
      p_items: lines.map((x) => ({
        product_id: x.product_id,
        quantity: Number(x.quantity),
        notes: x.notes || "",
      })),
      p_wholesale: !!wholesale,
      p_delivery_address: f.get("delivery_address") || null,
      p_delivery_time: f.get("delivery_time") || null,
      p_payment_status: payment?.status || "pending",
      p_payment_method: payment?.method || null,
      p_amount_paid: payment?.amount ?? null,
    });
    message(error, "Orden generada correctamente");
    if (!error) {
      setTab("orders");
      await reload();
    }
    setBusy(false);
  }
  async function updateOrder(orderId, data) {
    const { error } = await supabase.rpc("update_order", {
      p_order_id: orderId,
      p_customer_name: data.customer_name,
      p_customer_phone: data.customer_phone,
      p_delivery_address: data.delivery_address,
      p_payment_status: data.payment_status ?? null,
      p_payment_method: data.payment_method ?? null,
      p_amount_paid: data.amount_paid ?? null,
      p_items: data.items ?? null,
    });
    message(error, "Pedido actualizado");
    if (!error) await reload();
    return !error;
  }
  async function registerPayment(orderId, amount, method) {
    const { error } = await supabase.rpc("register_payment", {
      p_order_id: orderId,
      p_amount: amount,
      p_method: method,
    });
    message(error, "Pago registrado");
    if (!error) await reload();
    return !error;
  }
  async function changeStatus(id, status) {
    setBusy(true);
    const { error } = await supabase.rpc("set_order_item_status", {
      p_item_id: id,
      p_status: status,
    });
    message(error, "Estado actualizado");
    if (!error) await reload();
    setBusy(false);
  }
  async function changeSeller(id, patch) {
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", id);
    message(error, "Vendedor actualizado");
    if (!error) await reload();
    setBusy(false);
  }
  const [uploadingId, setUploadingId] = useState(null);
  async function uploadProductPhoto(product, file) {
    if (!file || uploadingId) return;
    setUploadingId(product.id);
    try {
      const blob = await resizeImage(file);
      const ext = blob.type === "image/webp" ? "webp" : "jpg";
      const path = `${product.id}/${Date.now()}.${ext}`;
      const up = await supabase.storage
        .from(PRODUCT_BUCKET)
        .upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
      if (up.error) throw up.error;
      const { data } = supabase.storage.from(PRODUCT_BUCKET).getPublicUrl(path);
      const { error } = await supabase
        .from("products")
        .update({ image_url: data.publicUrl })
        .eq("id", product.id);
      if (error) throw error;
      message(null, `Foto de "${product.name}" actualizada`);
      await reload();
    } catch (err) {
      message({ message: err?.message || "No se pudo subir la foto." });
    }
    setUploadingId(null);
  }
  async function changeProduct(id, active) {
    setBusy(true);
    const { error } = await supabase
      .from("products")
      .update({ active })
      .eq("id", id);
    message(error, "Producto actualizado");
    if (!error) await reload();
    setBusy(false);
  }
  if (!supabase)
    return (
      <div className="center">
        <div className="panel">
          <h1>Thian Candle</h1>
          <p>
            Configura <code>VITE_SUPABASE_URL</code> y{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> para conectar la aplicación.
          </p>
        </div>
      </div>
    );
  if (loading) return <div className="center">Cargando…</div>;
  if (!session)
    return <LoginForm onSubmit={signin} busy={busy} error={error} />;
  if (!profile)
    return (
      <div className="center">
        <div className="panel">
          <h2>Preparando perfil…</h2>
          <p>{error || "Actualiza la página si el perfil no aparece."}</p>
          <button onClick={() => supabase.auth.signOut()}>Salir</button>
        </div>
      </div>
    );
  if (!profile.active)
    return (
      <div className="center">
        <div className="panel">
          <h2>Cuenta desactivada</h2>
          <p>Contacta al administrador.</p>
          <button onClick={() => supabase.auth.signOut()}>Salir</button>
        </div>
      </div>
    );
  const counts = { pending: 0, in_progress: 0, finished: 0 };
  orders.forEach((o) => o.order_items?.forEach((i) => counts[i.status]++));
  const initials =
    (profile.full_name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("") || "?";
  return (
    <div className="shell">
      <aside className={navCollapsed ? "collapsed" : ""}>
        <div className="brand">
          {/* Menú abierto: firma. Menú colapsado y móvil: ícono. */}
          <img
            className="logo-icono"
            src={`${import.meta.env.BASE_URL}logo-icono.webp`}
            alt="Thian Candle"
            width="36"
            height="35"
          />
          <div className="brandtext">
            <img
              className="logo-firma"
              src={`${import.meta.env.BASE_URL}logo-firma.webp`}
              alt="Thian Candle"
              width="200"
              height="38"
            />
          </div>
          <button
            type="button"
            className="navtoggle"
            onClick={toggleNav}
            aria-expanded={!navCollapsed}
            aria-label={navCollapsed ? "Mostrar menú" : "Ocultar menú"}
            title={navCollapsed ? "Mostrar menú" : "Ocultar menú"}
          >
            {navCollapsed ? (
              <PanelLeftOpen size={18} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={18} aria-hidden="true" />
            )}
          </button>
        </div>
        <div
          className="avatar"
          aria-hidden="true"
          title={`${profile.full_name} · ${roleNames.join(" · ")}`}
        >
          {initials}
        </div>
        <div className="identity">
          <span className="idavatar" aria-hidden="true">
            {initials}
          </span>
          <div className="idtext">
            <b>{profile.full_name}</b>
            <small>
              <UserRound size={13} aria-hidden="true" />
              {roleNames.join(" · ") || "Sin roles"}
            </small>
          </div>
        </div>
        <nav aria-label="Navegación principal">
          {[
            ["dashboard", LayoutDashboard, "Resumen"],
            ["orders", ShoppingBag, "Pedidos"],
            ...(canSell ? [["new", Plus, "Nuevo pedido"]] : []),
            ["products", Package, "Productos"],
            ...(admin ? [["sellers", Users, "Usuarios y roles"]] : []),
          ].map(([id, Icon, title]) => (
            <button
              key={id}
              className={tab === id ? "selected" : ""}
              aria-current={tab === id ? "page" : undefined}
              title={navCollapsed ? title : undefined}
              onClick={() => {
                setTab(id);
                setError("");
                setNotice("");
                setNavCollapsed(true); // se recoge solo al cambiar de sección
              }}
            >
              <Icon size={18} aria-hidden="true" />
              <span className="navlabel">{title}</span>
            </button>
          ))}
        </nav>
        <button
          className="logout"
          aria-label="Cerrar sesión"
          title={navCollapsed ? "Cerrar sesión" : undefined}
          onClick={() => supabase.auth.signOut()}
        >
          <LogOut size={17} aria-hidden="true" />
          <span className="navlabel">Salir</span>
        </button>
      </aside>
      <main>
        <header>
          <div>
            <h1>
              {
                {
                  dashboard: "Resumen general",
                  orders: "Pedidos",
                  new: "Registrar pedido",
                  products: "Productos",
                  sellers: "Vendedores",
                }[tab]
              }
            </h1>
            <p>Chispa de luz, fe y aroma</p>
          </div>
          <button
            className="secondary compact"
            onClick={reload}
            disabled={busy}
          >
            <RefreshCw size={16} /> Actualizar
          </button>
        </header>
        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}
        {tab === "dashboard" && (
          <>
            <div className="stats">
              {[
                ["Pedidos", orders.length],
                ["Pendientes", counts.pending],
                ["En proceso", counts.in_progress],
                ["Finalizados", counts.finished],
              ].map(([n, v]) => (
                <div className="stat" key={n}>
                  <strong>{v}</strong>
                  <span>{n}</span>
                </div>
              ))}
            </div>
            <h2>Pedidos recientes</h2>
            <Orders
              orders={orders.slice(0, 5)}
              admin={canProduce}
              busy={busy}
              changeStatus={changeStatus}
              canBill={canBill}
              onPay={registerPayment}
              userId={session?.user?.id}
              canSell={canSell}
              onEdit={updateOrder}
              products={products}
            />
          </>
        )}
        {tab === "orders" && (
          <Orders
            orders={orders}
            admin={canProduce}
            busy={busy}
            changeStatus={changeStatus}
            canBill={canBill}
            onPay={registerPayment}
            userId={session?.user?.id}
            canSell={canSell}
            onEdit={updateOrder}
            products={products}
          />
        )}
        {tab === "new" && canSell && (
          <OrderForm
            products={products.filter((p) => p.active)}
            busy={busy}
            onSubmit={createOrder}
          />
        )}
        {tab === "products" && (
          <>
            <div className="panel">
              <h2>Catálogo de productos</h2>
              {admin && (
                <form className="formgrid" onSubmit={createProduct}>
                  <input
                    name="name"
                    placeholder="Nombre del producto"
                    required
                  />
                  <input name="sku" placeholder="Referencia / SKU (opcional)" />
                  <input
                    name="category"
                    placeholder="Categoría / línea (opcional)"
                  />
                  <input
                    name="price"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    placeholder="Precio general (COP)"
                    aria-label="Precio general en pesos"
                  />
                  <input
                    name="price_wholesale"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    placeholder="Precio mayorista (COP)"
                    aria-label="Precio mayorista en pesos"
                  />
                  <input
                    name="image_url"
                    type="url"
                    placeholder="URL de fotografía (opcional)"
                  />
                  <input name="description" placeholder="Descripción" />
                  <button disabled={busy}>Agregar producto</button>
                </form>
              )}
            </div>
            <div className="panel tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Categoría</th>
                    <th>Referencia</th>
                    <th className="num">Precio</th>
                    <th className="num">Mayorista</th>
                    <th>Estado</th>
                    {admin && <th>Acción</th>}
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="prodcell">
                          <span className="cartthumb" aria-hidden="true">
                            {p.image_url ? (
                              <img
                                src={p.image_url}
                                alt=""
                                width="40"
                                height="40"
                                loading="lazy"
                              />
                            ) : (
                              <Package size={16} />
                            )}
                          </span>
                          {p.name}
                        </div>
                      </td>
                      <td>{p.category || "—"}</td>
                      <td>{p.sku || "—"}</td>
                      <td className="num">{fmtMoney(p.price)}</td>
                      <td className="num">{fmtMoney(p.price_wholesale)}</td>
                      <td>{p.active ? "Activo" : "Inactivo"}</td>
                      {admin && (
                        <td>
                          <div className="rowactions">
                            <label
                              className={
                                "filebtn" +
                                (uploadingId ? " is-disabled" : "")
                              }
                            >
                              <input
                                type="file"
                                className="sr-only"
                                accept="image/jpeg,image/png,image/webp"
                                disabled={!!uploadingId}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  e.target.value = "";
                                  uploadProductPhoto(p, file);
                                }}
                              />
                              {uploadingId === p.id ? (
                                <Loader2
                                  size={15}
                                  className="spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <ImagePlus size={15} aria-hidden="true" />
                              )}
                              {uploadingId === p.id
                                ? "Subiendo…"
                                : p.image_url
                                  ? "Cambiar foto"
                                  : "Subir foto"}
                            </label>
                            <button
                              className="secondary compact"
                              disabled={busy}
                              onClick={() => changeProduct(p.id, !p.active)}
                            >
                              {p.active ? "Desactivar" : "Activar"}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {tab === "sellers" && admin && (
          <div className="panel tablewrap">
            <h2>Usuarios y permisos</h2>
            <p>
              Crea cuentas desde aquí y asigna uno o varios roles. El correo se
              utiliza solo para recuperación de acceso; el inicio de sesión es
              con username.
            </p>
            <form className="user-create" onSubmit={createUser}>
              <h3>Registrar nuevo usuario</h3>
              <div className="formgrid">
                <label>
                  Nombre completo
                  <input
                    name="full_name"
                    placeholder="Nombre y apellido"
                    maxLength="100"
                    required
                  />
                </label>
                <label>
                  Username
                  <input
                    name="username"
                    placeholder="Ej. maria.ventas"
                    minLength="4"
                    maxLength="20"
                    pattern="[a-zA-Z0-9._]{4,20}"
                    required
                  />
                </label>
                <label>
                  Correo para recuperación
                  <input
                    name="email"
                    type="email"
                    autoComplete="off"
                    required
                  />
                </label>
                <label>
                  Contraseña inicial
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength="10"
                    required
                  />
                </label>
              </div>
              <div className="rolechecks" aria-label="Roles del nuevo usuario">
                {roleCatalog.map((r) => (
                  <label key={r.id}>
                    <input
                      type="checkbox"
                      name="roles"
                      value={r.code}
                      defaultChecked={r.code === "seller"}
                    />
                    {r.name}
                  </label>
                ))}
              </div>
              <button disabled={busy}>Crear usuario</button>
            </form>
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Username</th>
                  <th>Roles (marcar para asignar)</th>
                  <th>Estado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((s) => (
                  <tr key={s.id}>
                    <td>{s.full_name}</td>
                    <td>
                      <UsernameEditor
                        user={s}
                        busy={busy}
                        onSave={saveUsername}
                      />
                    </td>
                    <td>
                      <div className="rolechecks">
                        {roleCatalog.map((r) => (
                          <label key={r.id}>
                            <input
                              type="checkbox"
                              disabled={
                                busy ||
                                (s.id === profile.id && r.code === "admin")
                              }
                              checked={assignments.some(
                                (a) => a.user_id === s.id && a.role_id === r.id,
                              )}
                              onChange={(e) =>
                                setUserRole(s.id, r.id, e.target.checked)
                              }
                            />
                            {r.name}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>{s.active ? "Activo" : "Inactivo"}</td>
                    <td>
                      {s.id !== profile.id && (
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() =>
                            changeSeller(s.id, { active: !s.active })
                          }
                        >
                          {s.active ? "Desactivar" : "Activar"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
function UsernameEditor({ user, busy, onSave }) {
  const [value, setValue] = useState(user.username || "");
  useEffect(() => setValue(user.username || ""), [user.username]);
  return (
    <div className="username-edit">
      <input
        aria-label={"Username de " + user.full_name}
        value={value}
        maxLength={20}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        className="secondary compact"
        disabled={busy || value === user.username}
        onClick={() => onSave(user.id, value)}
      >
        Guardar
      </button>
    </div>
  );
}
function OrderForm({ products, busy, onSubmit }) {
  const [cat, setCat] = useState("all");
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState([]);
  const [wholesaleChoice, setWholesaleChoice] = useState(false);
  const [payStatus, setPayStatus] = useState("pending");
  const [payMethod, setPayMethod] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const nextKey = useRef(0);
  // La barra inferior solo aparece mientras el total del pedido no se ve.
  const footRef = useRef(null);
  const [footVisible, setFootVisible] = useState(false);
  useEffect(() => {
    const el = footRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setFootVisible(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const byId = new Map(products.map((p) => [p.id, p]));
  const catOf = (p) => p.category || "Otros";
  const categories = [...new Set(products.map(catOf))];
  const q = query.trim().toLowerCase();
  const visible = products.filter(
    (p) =>
      (cat === "all" || catOf(p) === cat) &&
      (!q ||
        p.name.toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q)),
  );
  const newLine = (product_id) => ({
    key: nextKey.current++,
    product_id,
    quantity: 1,
    notes: "",
  });
  // Suma a la línea sin personalización del mismo producto; si no hay, crea una.
  const add = (p) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product_id === p.id && !l.notes.trim());
      return i >= 0
        ? ls.map((l, j) =>
            j === i ? { ...l, quantity: Number(l.quantity) + 1 } : l,
          )
        : [...ls, newLine(p.id)];
    });
  const edit = (key, k, v) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [k]: v } : l)));
  const remove = (key) => setLines((ls) => ls.filter((l) => l.key !== key));
  const inCart = (id) =>
    lines
      .filter((l) => l.product_id === id)
      .reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const units = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const wholesaleAuto = units >= WHOLESALE_MIN_UNITS;
  const wholesale = wholesaleAuto || wholesaleChoice;
  const unitPrice = (p) =>
    p ? (wholesale ? (p.price_wholesale ?? p.price) : p.price) : null;
  const total = lines.reduce(
    (s, l) => s + (unitPrice(byId.get(l.product_id)) || 0) * (Number(l.quantity) || 0),
    0,
  );
  const paid = Number(amountPaid);
  const payError =
    payStatus === "partial" && amountPaid !== "" && total > 0 && paid >= total
      ? "El abono debe ser menor al total. Si paga todo, usa Pago completo."
      : "";
  const payValid =
    payStatus === "pending" ||
    (payMethod &&
      (payStatus === "paid" ||
        (Number.isInteger(paid) && paid > 0 && !payError)));
  const valid =
    payValid &&
    lines.length > 0 &&
    lines.every((l) => Number.isInteger(Number(l.quantity)) && Number(l.quantity) > 0);
  const scrollToCart = () =>
    footRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  return (
    <form className="orderlayout" onSubmit={(e) =>
        onSubmit(e, lines, wholesale, {
          status: payStatus,
          method: payStatus === "pending" ? null : payMethod || null,
          amount: payStatus === "partial" ? paid : null,
        })
      }
    >
      <section className="panel catalog" aria-labelledby="catalog-title">
        <div className="catalog-head">
          <h2 id="catalog-title">Catálogo</h2>
          <input
            type="search"
            className="catalog-search"
            placeholder="Buscar producto"
            aria-label="Buscar producto"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="chips" role="group" aria-label="Categorías">
          {[["all", "Todas"], ...categories.map((c) => [c, c])].map(
            ([id, label]) => (
              <button
                type="button"
                key={id}
                className={"chip" + (cat === id ? " active" : "")}
                aria-pressed={cat === id}
                onClick={() => setCat(id)}
              >
                {label}
              </button>
            ),
          )}
        </div>
        {!products.length ? (
          <p className="empty">
            El administrador debe crear productos activos antes de registrar
            pedidos.
          </p>
        ) : !visible.length ? (
          <p className="empty">No hay productos que coincidan.</p>
        ) : (
          <div className="pgrid">
            {visible.map((p) => {
              const n = inCart(p.id);
              return (
                <article
                  className={"pcard" + (n ? " selected" : "")}
                  key={p.id}
                >
                  <div className="pcard-img">
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt={p.name}
                        loading="lazy"
                        width="300"
                        height="300"
                      />
                    ) : (
                      <Package size={36} aria-hidden="true" />
                    )}
                    {n > 0 && (
                      <span className="pcard-badge">{n} en el pedido</span>
                    )}
                  </div>
                  <div className="pcard-body">
                    <small>{catOf(p)}</small>
                    <h3>{p.name}</h3>
                    {p.description && <p>{p.description}</p>}
                    <div className="pcard-foot">
                      <div className="pcard-prices">
                        <strong>{fmtMoney(wholesale ? (p.price_wholesale ?? p.price) : p.price)}</strong>
                        {p.price_wholesale != null && (
                          <small>
                            {wholesale ? "General " + fmtMoney(p.price) : "Mayorista " + fmtMoney(p.price_wholesale)}
                          </small>
                        )}
                      </div>
                      <button
                        type="button"
                        className="compact"
                        onClick={() => add(p)}
                        aria-label={`Agregar ${p.name}`}
                      >
                        <Plus size={16} aria-hidden="true" /> Agregar
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="orderside" id="order-side">
        <section className="panel" aria-labelledby="customer-title">
          <h2 id="customer-title">Datos del cliente</h2>
          <div className="stackfields">
            <label>
              Cliente
              <input
                name="customer_name"
                required
                placeholder="Nombre del cliente"
                autoComplete="off"
              />
            </label>
            <label>
              Teléfono
              <input
                name="customer_phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="Opcional"
              />
            </label>
            <label>
              Dirección de entrega
              <input
                name="delivery_address"
                autoComplete="street-address"
                placeholder="Calle, número, barrio, ciudad"
              />
            </label>
            <div className="fieldpair">
              <label>
                Fecha de entrega
                <input name="delivery_date" type="date" />
              </label>
              <label>
                Hora de entrega
                <input name="delivery_time" type="time" step="900" />
              </label>
            </div>
            <label>
              Observaciones generales
              <input name="notes" placeholder="Indicaciones del pedido" />
            </label>
            <fieldset className="choicegroup">
              <legend>Tipo de pago</legend>
              <div className="choices">
                {Object.entries(PAYMENT_STATUS).map(([v, l]) => (
                  <label key={v} className={payStatus === v ? "on" : ""}>
                    <input
                      type="radio"
                      name="payment_status"
                      value={v}
                      checked={payStatus === v}
                      onChange={() => setPayStatus(v)}
                    />
                    {l}
                  </label>
                ))}
              </div>
            </fieldset>
            {payStatus !== "pending" && (
              <fieldset className="choicegroup">
                <legend>Medio de pago</legend>
                <div className="choices">
                  {Object.entries(PAYMENT_METHOD).map(([v, l]) => (
                    <label key={v} className={payMethod === v ? "on" : ""}>
                      <input
                        type="radio"
                        name="payment_method"
                        value={v}
                        required
                        checked={payMethod === v}
                        onChange={() => setPayMethod(v)}
                      />
                      {l}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {payStatus === "partial" && (
              <label>
                Valor abonado
                <input
                  name="amount_paid"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  required
                  placeholder="$ 0"
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                  aria-invalid={!!payError}
                  aria-describedby="amount-help"
                />
                <small id="amount-help" className={payError ? "fielderror" : "fieldhelp"}>
                  {payError ||
                    (total > 0 && paid > 0
                      ? `Saldo pendiente: ${fmtMoney(total - paid)}`
                      : "Lo que el cliente ya pagó.")}
                </small>
              </label>
            )}
          </div>
        </section>

        <section className="panel cart" aria-labelledby="cart-title">
          <h2 id="cart-title">
            <ShoppingCart size={18} aria-hidden="true" /> Pedido
            {units > 0 && <span className="cart-count">{units}</span>}
          </h2>
          {!lines.length ? (
            <p className="empty">
              Toca <b>Agregar</b> en un producto del catálogo.
            </p>
          ) : (
            <ul className="cartlist">
              {lines.map((l) => {
                const p = byId.get(l.product_id);
                const qty = Number(l.quantity) || 0;
                return (
                  <li className="cartline" key={l.key}>
                    <div className="cartline-top">
                      <div className="cartthumb" aria-hidden="true">
                        {p?.image_url ? (
                          <img src={p.image_url} alt="" width="48" height="48" />
                        ) : (
                          <Package size={18} />
                        )}
                      </div>
                      <div className="cartinfo">
                        <b>{p?.name || "Producto"}</b>
                        <small>
                          {fmtMoney(unitPrice(p))} c/u
                          {qty > 1 && unitPrice(p) != null && (
                            <> · {fmtMoney(unitPrice(p) * qty)}</>
                          )}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="iconbtn"
                        aria-label={`Quitar ${p?.name || "producto"}`}
                        onClick={() => remove(l.key)}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                    <div className="cartline-bottom">
                      <div className="stepper">
                        <button
                          type="button"
                          aria-label="Restar uno"
                          disabled={qty <= 1}
                          onClick={() =>
                            edit(l.key, "quantity", Math.max(1, qty - 1))
                          }
                        >
                          <Minus size={14} aria-hidden="true" />
                        </button>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          value={l.quantity}
                          onChange={(e) =>
                            edit(l.key, "quantity", e.target.value)
                          }
                          aria-label={`Cantidad de ${p?.name || "producto"}`}
                          required
                        />
                        <button
                          type="button"
                          aria-label="Sumar uno"
                          onClick={() => edit(l.key, "quantity", qty + 1)}
                        >
                          <Plus size={14} aria-hidden="true" />
                        </button>
                      </div>
                      <button
                        type="button"
                        className="linkbtn"
                        onClick={() =>
                          setLines((ls) => [...ls, newLine(l.product_id)])
                        }
                      >
                        + Otra personalización
                      </button>
                    </div>
                    <input
                      className="cartnotes"
                      placeholder="Personalización: nombres, deseos, color"
                      aria-label={`Personalización de ${p?.name || "producto"}`}
                      value={l.notes}
                      onChange={(e) => edit(l.key, "notes", e.target.value)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          <div className="cartfoot" ref={footRef}>
            <label className={"wholesale" + (wholesale ? " on" : "")}>
              <input
                type="checkbox"
                checked={wholesale}
                disabled={wholesaleAuto}
                onChange={(e) => setWholesaleChoice(e.target.checked)}
              />
              <span>
                <b>Aplicar precio mayorista</b>
                <small>
                  {wholesaleAuto
                    ? `Automático: el pedido tiene ${WHOLESALE_MIN_UNITS} unidades o más.`
                    : `Se aplica automáticamente desde ${WHOLESALE_MIN_UNITS} unidades.`}
                </small>
              </span>
            </label>
            <div className="carttotal">
              <span>Total estimado</span>
              <strong>{fmtMoney(total)}</strong>
            </div>
            <small className="carthint">
              Calculado con el precio {wholesale ? "mayorista" : "general"}.
            </small>
            <button className="cartsubmit" disabled={busy || !valid}>
              {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
              {busy ? "Generando…" : "Generar orden"}
            </button>
          </div>
        </section>
      </div>

      {/* Resumen fijo abajo mientras el total del pedido está fuera de vista */}
      {units > 0 && !footVisible && (
        <div className="cartbar">
          <span>
            <b>{units}</b> {units === 1 ? "producto" : "productos"} ·{" "}
            <b>{fmtMoney(total)}</b>
          </span>
          <button type="button" className="compact" onClick={scrollToCart}>
            Ver pedido
          </button>
        </div>
      )}
    </form>
  );
}
// Foto ampliada: Esc, clic fuera o botón Cerrar la cierran.
function Lightbox({ photo, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    if (!photo) return;
    const prev = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [photo]);
  if (!photo) return null;
  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={photo.alt}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <figure>
        <img src={photo.src} alt={photo.alt} />
        <figcaption>{photo.alt}</figcaption>
      </figure>
      <button
        ref={closeRef}
        type="button"
        className="lightbox-close"
        onClick={onClose}
        aria-label="Cerrar foto"
      >
        <X size={22} aria-hidden="true" />
      </button>
    </div>
  );
}
// Editar datos del pedido. El pago solo lo ven Administrador y Facturación.
function OrderEditForm({ order, products = [], canBill, onSave, onCancel }) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const original = (order.order_items || []).map((i) => ({
    key: i.id,
    id: i.id,
    product_id: i.product_id,
    quantity: i.quantity,
    notes: i.notes || "",
    status: i.status,
    unit_price: i.unit_price,
    name: i.products?.name || byId.get(i.product_id)?.name || "Producto",
    image_url: i.products?.image_url || byId.get(i.product_id)?.image_url || null,
  }));
  const [items, setItems] = useState(original);
  const [addId, setAddId] = useState("");
  const editItem = (key, k, v) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, [k]: v } : x)));
  const units = items.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
  // Mismo criterio que update_order: 10+ unidades pasa a mayorista.
  const willBeWholesale = !order.wholesale && units >= WHOLESALE_MIN_UNITS;
  const wholesaleNow = order.wholesale || willBeWholesale;
  const priceOf = (x) => {
    const p = byId.get(x.product_id);
    if (willBeWholesale && p) return p.price_wholesale ?? p.price;
    if (x.id && x.unit_price != null) return x.unit_price;
    if (!p) return x.unit_price ?? 0;
    return wholesaleNow ? (p.price_wholesale ?? p.price) : p.price;
  };
  const total = items.reduce((s, x) => s + (priceOf(x) || 0) * (Number(x.quantity) || 0), 0);
  const itemsChanged =
    items.length !== original.length ||
    items.some((x) => {
      const o = original.find((y) => y.id && y.id === x.id);
      return !o || Number(o.quantity) !== Number(x.quantity) || o.notes.trim() !== x.notes.trim();
    });
  const itemsValid =
    items.length > 0 &&
    items.every((x) => Number.isInteger(Number(x.quantity)) && Number(x.quantity) > 0);
  const addable = products.filter((p) => p.active);
  const [status, setStatus] = useState(order.payment_status || "pending");
  const [method, setMethod] = useState(order.payment_method || "");
  const [amount, setAmount] = useState(
    order.payment_status === "partial" ? String(order.amount_paid || "") : "",
  );
  const [saving, setSaving] = useState(false);
  const value = Number(amount);
  const payErr =
    canBill && status === "partial" && amount !== "" && total > 0 && value >= total
      ? `El abono debe ser menor al total (${fmtMoney(total)}).`
      : "";
  const payOk =
    !canBill ||
    status === "pending" ||
    (method &&
      (status === "paid" || (Number.isInteger(value) && value > 0 && !payErr)));
  const paidNow = order.amount_paid || 0;
  const overpaid = !canBill && itemsChanged && paidNow > total;
  const formOk = payOk && itemsValid && !overpaid;
  async function submit(e) {
    e.preventDefault();
    if (!formOk || saving) return;
    const f = new FormData(e.currentTarget);
    setSaving(true);
    const done = await onSave(order.id, {
      customer_name: String(f.get("customer_name") || ""),
      customer_phone: String(f.get("customer_phone") || ""),
      delivery_address: String(f.get("delivery_address") || ""),
      ...(itemsChanged && {
        items: items.map((x) => ({
          id: x.id || null,
          product_id: x.product_id,
          quantity: Number(x.quantity),
          notes: x.notes || "",
        })),
      }),
      ...(canBill && {
        payment_status: status,
        payment_method: status === "pending" ? null : method || null,
        amount_paid: status === "partial" ? value : null,
      }),
    });
    setSaving(false);
    if (done) onCancel();
  }
  const idp = `edit-${order.id}`;
  return (
    <form
      className="editorder"
      onSubmit={submit}
      aria-label={`Editar pedido ${order.order_number}`}
    >
      <div className="editgrid">
        <label>
          Cliente
          <input name="customer_name" required defaultValue={order.customer_name} />
        </label>
        <label>
          Teléfono
          <input
            name="customer_phone"
            type="tel"
            inputMode="tel"
            defaultValue={order.customer_phone || ""}
            placeholder="Opcional"
          />
        </label>
        <label className="span2">
          Dirección de entrega
          <input
            name="delivery_address"
            defaultValue={order.delivery_address || ""}
            placeholder="Calle, número, barrio, ciudad"
          />
        </label>
      </div>
      <fieldset className="edititems">
        <legend>Productos del pedido</legend>
        <ul>
          {items.map((x) => {
            const locked = x.id && x.status !== "pending";
            const qty = Number(x.quantity) || 0;
            return (
              <li key={x.key} className={locked ? "locked" : ""}>
                <span className="cartthumb" aria-hidden="true">
                  {x.image_url ? (
                    <img src={x.image_url} alt="" width="44" height="44" />
                  ) : (
                    <Package size={16} />
                  )}
                </span>
                <div className="edititem-info">
                  <b>{x.name}</b>
                  <small>
                    {fmtMoney(priceOf(x))} c/u
                    {qty > 1 && <> · {fmtMoney(priceOf(x) * qty)}</>}
                    {!x.id && <> · nuevo</>}
                  </small>
                  {locked && (
                    <span className={"pill " + x.status}>
                      {labels[x.status]} · no se puede modificar
                    </span>
                  )}
                </div>
                <div className="stepper">
                  <button
                    type="button"
                    aria-label={`Restar uno a ${x.name}`}
                    disabled={locked || qty <= 1}
                    onClick={() => editItem(x.key, "quantity", Math.max(1, qty - 1))}
                  >
                    <Minus size={14} aria-hidden="true" />
                  </button>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    disabled={locked}
                    value={x.quantity}
                    onChange={(e) => editItem(x.key, "quantity", e.target.value)}
                    aria-label={`Cantidad de ${x.name}`}
                  />
                  <button
                    type="button"
                    aria-label={`Sumar uno a ${x.name}`}
                    disabled={locked}
                    onClick={() => editItem(x.key, "quantity", qty + 1)}
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                </div>
                <input
                  className="edititem-notes"
                  placeholder="Personalización"
                  aria-label={`Personalización de ${x.name}`}
                  disabled={locked}
                  value={x.notes}
                  onChange={(e) => editItem(x.key, "notes", e.target.value)}
                />
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={`Quitar ${x.name}`}
                  disabled={locked || items.length === 1}
                  title={items.length === 1 ? "El pedido debe tener al menos un producto" : undefined}
                  onClick={() => setItems((xs) => xs.filter((y) => y.key !== x.key))}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="edititem-add">
          <select
            value={addId}
            onChange={(e) => setAddId(e.target.value)}
            aria-label="Producto para agregar"
          >
            <option value="">Agregar otro producto…</option>
            {addable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {fmtMoney(wholesaleNow ? (p.price_wholesale ?? p.price) : p.price)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="secondary compact"
            disabled={!addId}
            onClick={() => {
              const p = byId.get(addId);
              if (!p) return;
              setItems((xs) => [
                ...xs,
                {
                  key: `new-${Date.now()}`,
                  id: null,
                  product_id: p.id,
                  quantity: 1,
                  notes: "",
                  status: "pending",
                  unit_price: null,
                  name: p.name,
                  image_url: p.image_url || null,
                },
              ]);
              setAddId("");
            }}
          >
            <Plus size={15} aria-hidden="true" /> Agregar
          </button>
        </div>
        <div className="edititem-total">
          <span>
            Nuevo total{wholesaleNow ? " (precio mayorista)" : ""}
          </span>
          <b>{fmtMoney(total)}</b>
        </div>
        {willBeWholesale && (
          <p className="fieldhelp">
            Con {units} unidades el pedido pasa a precio mayorista y se
            recalculan todos los precios.
          </p>
        )}
        {overpaid && (
          <p className="fielderror">
            Lo abonado ({fmtMoney(paidNow)}) supera el nuevo total. Pide a
            Administración o Facturación que ajuste el pago.
          </p>
        )}
      </fieldset>
      {canBill && (
        <div className="editgrid">
          <fieldset className="choicegroup span2">
            <legend>Tipo de pago</legend>
            <div className="choices">
              {Object.entries(PAYMENT_STATUS).map(([v, l]) => (
                <label key={v} className={status === v ? "on" : ""}>
                  <input
                    type="radio"
                    name={`${idp}-status`}
                    checked={status === v}
                    onChange={() => setStatus(v)}
                  />
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
          {status !== "pending" && (
            <fieldset className="choicegroup">
              <legend>Medio de pago</legend>
              <div className="choices">
                {Object.entries(PAYMENT_METHOD).map(([v, l]) => (
                  <label key={v} className={method === v ? "on" : ""}>
                    <input
                      type="radio"
                      name={`${idp}-method`}
                      required
                      checked={method === v}
                      onChange={() => setMethod(v)}
                    />
                    {l}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {status === "partial" && (
            <label>
              Valor abonado
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={!!payErr}
                aria-describedby={`${idp}-help`}
              />
              <small id={`${idp}-help`} className={payErr ? "fielderror" : "fieldhelp"}>
                {payErr ||
                  (value > 0 && total > 0
                    ? `Saldo: ${fmtMoney(total - value)}`
                    : `Total del pedido: ${fmtMoney(total)}`)}
              </small>
            </label>
          )}
          <p className="fieldhelp span2">
            Si cambia lo abonado, la diferencia queda en el historial como
            “Corrección”.
          </p>
        </div>
      )}
      <div className="payactions">
        <button
          type="button"
          className="secondary compact"
          disabled={saving}
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button className="compact" disabled={!formOk || saving}>
          {saving && <Loader2 size={15} className="spin" aria-hidden="true" />}
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </form>
  );
}
function PaymentPanel({ order, total, canBill, onPay }) {
  const paid = order.amount_paid || 0;
  const balance = Math.max(0, total - paid);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState(order.payment_method || "");
  const [saving, setSaving] = useState(false);
  const value = Number(amount);
  const err =
    amount !== "" && value > balance
      ? `No puede superar el saldo (${fmtMoney(balance)}).`
      : "";
  const ok = method && Number.isInteger(value) && value > 0 && !err;
  const payments = [...(order.order_payments || [])].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  async function submit(e) {
    e.preventDefault();
    if (!ok || saving) return;
    setSaving(true);
    const done = await onPay(order.id, value, method);
    setSaving(false);
    if (done) {
      setOpen(false);
      setAmount("");
    }
  }
  if (!payments.length && !(canBill && total > 0 && balance > 0)) return null;
  return (
    <div className="paybox">
      {payments.length > 0 && (
        <ul className="payhistory" aria-label="Pagos registrados">
          {payments.map((p) => (
            <li key={p.id}>
              <span>
                {new Date(p.created_at).toLocaleDateString("es-CO")} ·{" "}
                {PAYMENT_METHOD[p.method]}
                {p.note && <small> · {p.note}</small>}
              </span>
              <b>{fmtMoney(p.amount)}</b>
            </li>
          ))}
        </ul>
      )}
      {canBill && total > 0 && balance > 0 && !open && (
        <button
          type="button"
          className="secondary compact"
          onClick={() => {
            setOpen(true);
            setAmount(String(balance));
          }}
        >
          <Plus size={15} aria-hidden="true" /> Registrar pago · saldo{" "}
          {fmtMoney(balance)}
        </button>
      )}
      {open && (
        <form className="payform" onSubmit={submit}>
          <label>
            Valor del pago
            <input
              type="number"
              min="1"
              max={balance}
              step="1"
              inputMode="numeric"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={!!err}
              aria-describedby={`payhelp-${order.id}`}
            />
            <small
              id={`payhelp-${order.id}`}
              className={err ? "fielderror" : "fieldhelp"}
            >
              {err ||
                (value > 0 && value < balance
                  ? `Quedará un saldo de ${fmtMoney(balance - value)}.`
                  : value === balance
                    ? "Con este pago el pedido queda en Pago completo."
                    : `Saldo actual: ${fmtMoney(balance)}.`)}
            </small>
          </label>
          <fieldset className="choicegroup">
            <legend>Medio de pago</legend>
            <div className="choices">
              {Object.entries(PAYMENT_METHOD).map(([v, l]) => (
                <label key={v} className={method === v ? "on" : ""}>
                  <input
                    type="radio"
                    name={`method-${order.id}`}
                    value={v}
                    required
                    checked={method === v}
                    onChange={() => setMethod(v)}
                  />
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="payactions">
            <button
              type="button"
              className="secondary compact"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </button>
            <button className="compact" disabled={!ok || saving}>
              {saving && <Loader2 size={15} className="spin" aria-hidden="true" />}
              {saving ? "Guardando…" : "Guardar pago"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
function Orders({ orders, admin, busy, changeStatus, canBill, onPay, userId, canSell, onEdit, products = [] }) {
  const [filter, setFilter] = useState("all");
  const [photo, setPhoto] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const orderTotal = (o) =>
    (o.order_items || []).reduce((s, i) => s + (i.unit_price || 0) * i.quantity, 0);
  // Debe coincidir con update_order (SQL).
  const canEdit = (o) => canBill || (canSell && o.seller_id === userId);
  const filtered = orders.filter(
    (o) => filter === "all" || o.order_items?.some((i) => i.status === filter),
  );
  return (
    <>
      <div className="filter">
        <label>
          Filtrar por estado{" "}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Todos</option>
            {Object.entries(labels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!filtered.length && (
        <div className="panel">No hay pedidos para mostrar.</div>
      )}
      {filtered.map((o) => (
        <article className="panel order" key={o.id}>
          <div className="orderhead">
            <div>
              <h2>
                Pedido #{o.order_number}
                {o.wholesale && <span className="pill wholesale-pill">Precio mayorista</span>}
              </h2>
              <p>
                <b>Cliente:</b> {o.customer_name}{" "}
                {o.customer_phone && `· ${o.customer_phone}`}
              </p>
              <p>
                <b>Vendedor:</b> {o.seller_name || "—"} ·{" "}
                <b>Entrega:</b> {fmtDate(o.delivery_date)}
                {o.delivery_time && ` · ${fmtTime(o.delivery_time)}`}
              </p>
              {o.delivery_address && (
                <p>
                  <b>Dirección:</b> {o.delivery_address}
                </p>
              )}
              <p>
                <span className={"pill pay-" + (o.payment_status || "pending")}>
                  {PAYMENT_STATUS[o.payment_status] || PAYMENT_STATUS.pending}
                </span>
                {o.payment_method && <> · {PAYMENT_METHOD[o.payment_method]}</>}
                {o.payment_status === "partial" && o.amount_paid != null && (
                  <> · Abonó {fmtMoney(o.amount_paid)}</>
                )}
              </p>
            </div>
            <div className="orderhead-side">
              <small>{new Date(o.created_at).toLocaleString("es-CO")}</small>
              {canEdit(o) && editingId !== o.id && (
                <button
                  type="button"
                  className="secondary compact"
                  onClick={() => setEditingId(o.id)}
                >
                  <Pencil size={15} aria-hidden="true" /> Editar
                </button>
              )}
            </div>
          </div>
          {editingId === o.id && (
            <OrderEditForm
              order={o}
              products={products}
              canBill={canBill}
              onSave={onEdit}
              onCancel={() => setEditingId(null)}
            />
          )}
          {o.notes && (
            <p>
              <b>Observaciones:</b> {o.notes}
            </p>
          )}
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Precio</th>
                  <th className="num">Subtotal</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {o.order_items?.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <div className="prodcell">
                        {i.products?.image_url ? (
                          <button
                            type="button"
                            className="thumbbtn"
                            onClick={() =>
                              setPhoto({
                                src: i.products.image_url,
                                alt: i.products?.name || "Producto",
                              })
                            }
                            aria-label={`Ampliar foto de ${i.products?.name || "producto"}`}
                          >
                            <img
                              src={i.products.image_url}
                              alt=""
                              width="48"
                              height="48"
                              loading="lazy"
                            />
                          </button>
                        ) : (
                          <span className="cartthumb" aria-hidden="true">
                            <Package size={16} />
                          </span>
                        )}
                        <div>
                          {i.products?.name || "Producto"}
                          {i.notes && <small className="subnote">{i.notes}</small>}
                        </div>
                      </div>
                    </td>
                    <td className="num">{i.quantity}</td>
                    <td className="num">{fmtMoney(i.unit_price)}</td>
                    <td className="num">
                      {i.unit_price == null ? "—" : fmtMoney(i.unit_price * i.quantity)}
                    </td>
                    <td>
                      {admin ? (
                        <select
                          aria-label="Estado de producción"
                          disabled={busy}
                          value={i.status}
                          onChange={(e) => changeStatus(i.id, e.target.value)}
                        >
                          {Object.entries(labels).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={"pill " + i.status}>
                          {labels[i.status]}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {o.order_items?.some((i) => i.unit_price != null) && (
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total</td>
                    <td className="num">
                      <b>
                        {fmtMoney(
                          o.order_items.reduce(
                            (s, i) => s + (i.unit_price || 0) * i.quantity,
                            0,
                          ),
                        )}
                      </b>
                    </td>
                    <td />
                  </tr>
                  {o.payment_status === "partial" && o.amount_paid != null && (
                    <tr>
                      <td colSpan={3}>Saldo pendiente</td>
                      <td className="num">
                        {fmtMoney(
                          o.order_items.reduce(
                            (s, i) => s + (i.unit_price || 0) * i.quantity,
                            0,
                          ) - o.amount_paid,
                        )}
                      </td>
                      <td />
                    </tr>
                  )}
                </tfoot>
              )}
            </table>
          </div>
          <PaymentPanel
            order={o}
            total={orderTotal(o)}
            canBill={canBill}
            onPay={onPay}
          />
        </article>
      ))}
      <Lightbox photo={photo} onClose={() => setPhoto(null)} />
    </>
  );
}
createRoot(document.getElementById("root")).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <App />
  </ThemeProvider>,
);
