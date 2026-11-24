import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
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
  Factory,
  CalendarDays,
  Clock,
  Settings,
  CheckCircle2,
  Eye,
  ArrowLeft,
  Receipt,
  Printer,
  Truck,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
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
const WHOLESALE_MIN_UNITS = 12;
// Deben coincidir con los CHECK de orders.payment_status / payment_method.
const PAYMENT_STATUS = {
  pending: "Pago pendiente",
  partial: "Pago parcial",
  paid: "Pago completo",
};
const PAYMENT_METHOD = { transfer: "Transferencia", cash: "Efectivo" };
// Consecutivo de factura: FAC-0001
const fmtInvoice = (n) => (n == null ? "Borrador" : `FAC-${String(n).padStart(4, "0")}`);
const itemsTotal = (o) =>
  (o.order_items || []).reduce((s, i) => s + (i.unit_price || 0) * i.quantity, 0);
// Total del pedido = productos + domicilio
const orderGrandTotal = (o) => itemsTotal(o) + (o.delivery_fee || 0);
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
    [zones, setZones] = useState([]),
    [invoices, setInvoices] = useState([]),
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
  const canSell = hasRole("admin", "seller");
  // La pestaña Producción es solo para quien tiene rol de producción
  // (es el único lugar donde se cambia el estado de cada producto).
  const seesProduction = hasRole("production");
  // Debe coincidir con register_payment (SQL): Administrador y Facturación.
  const canBill = hasRole("admin", "billing");
  // En Pedidos, quien vende (incluido el Administrador) ve solo los pedidos
  // que generó. Facturación y Supervisor siguen viendo todos; Producción y el
  // Resumen general trabajan con todos los pedidos.
  const visibleOrders = canSell
    ? orders.filter((o) => o.seller_id === session?.user?.id)
    : orders;
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
    const [p, o, sn, s, r, ur, z, inv] = await Promise.all([
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
      supabase.from("delivery_zones").select("*").eq("active", true).order("sort"),
      canBill
        ? supabase.from("invoices").select("*").order("created_at", { ascending: false })
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
      // Domicilios y facturas no bloquean el resto si fallan
      if (z.error) console.warn("delivery_zones:", z.error.message);
      if (inv.error) console.warn("invoices:", inv.error.message);
      setZones(z.data || []);
      setInvoices(inv.data || []);
    }
    setBusy(false);
  }
  useEffect(() => {
    if (profile?.active && roles.length) reload();
  }, [profile?.id, profile?.active, roles.join("|")]);
  useEffect(() => {
    if (!roles.length || admin || tab !== "dashboard") return;
    setTab(
      canSell ? "orders" : seesProduction ? "production" : canBill ? "billing" : "orders",
    );
  }, [roles.join("|")]);
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
      p_delivery_zone: f.get("delivery_zone") || null,
    });
    message(error, "Orden generada correctamente");
    if (!error) {
      setTab("orders");
      await reload();
    }
    setBusy(false);
  }
  async function createInvoice(orderId) {
    setBusy(true);
    const { data, error } = await supabase.rpc("create_invoice", { p_order_id: orderId });
    message(error, `Factura ${fmtInvoice(data)} generada`);
    if (!error) await reload();
    setBusy(false);
    return error ? null : data;
  }
  async function cancelOrder(orderId, reason) {
    const { error } = await supabase.rpc("cancel_order", {
      p_order_id: orderId,
      p_reason: reason,
    });
    message(error, "Pedido cancelado");
    if (!error) await reload();
    return !error;
  }
  async function updateProduct(id, patch) {
    const { error } = await supabase.from("products").update(patch).eq("id", id);
    message(error, "Producto actualizado");
    if (!error) await reload();
    return !error;
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
      p_delivery_zone: data.delivery_zone || null,
    });
    message(error, "Pedido actualizado");
    if (!error) await reload();
    return !error;
  }
  async function setItemStatus(itemId, status) {
    const prev = orders;
    setOrders((os) =>
      os.map((o) => ({
        ...o,
        order_items: o.order_items?.map((i) => (i.id === itemId ? { ...i, status } : i)),
      })),
    );
    const { error } = await supabase.rpc("set_order_item_status", {
      p_item_id: itemId,
      p_status: status,
    });
    if (error) {
      setOrders(prev);
      message(error);
    }
    return !error;
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
  const [editingProduct, setEditingProduct] = useState(null);
  const [productSort, setProductSort] = useState({ key: null, dir: "asc" });
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
  // Los pedidos cancelados no cuentan en Resumen, Producción ni Facturación.
  const activeOrders = orders.filter((o) => !o.cancelled_at);
  const counts = { pending: 0, in_progress: 0, finished: 0 };
  activeOrders.forEach((o) => o.order_items?.forEach((i) => counts[i.status]++));
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
            ...(admin ? [["dashboard", LayoutDashboard, "Resumen"]] : []),
            ...(seesProduction ? [["production", Factory, "Producción"]] : []),
            ["orders", ShoppingBag, "Pedidos"],
            ...(canBill ? [["billing", Receipt, "Facturación"]] : []),
            ["products", Package, "Productos"],
            ...(admin ? [["sellers", Users, "Usuarios y roles"]] : []),
          ].map(([id, Icon, title]) => {
            // Registrar pedido vive dentro de Pedidos
            const on = tab === id || (id === "orders" && tab === "new");
            return (
            <button
              key={id}
              className={on ? "selected" : ""}
              aria-current={on ? "page" : undefined}
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
            );
          })}
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
                  production: "Línea de producción",
                  new: "Registrar pedido",
                  products: "Productos",
                  sellers: "Vendedores",
                  billing: "Facturación",
                }[tab]
              }
            </h1>
            <p>Chispa de luz, fe y aroma</p>
          </div>
          <div className="headactions">
            {tab === "new" && (
              <button
                className="secondary compact"
                onClick={() => {
                  setTab("orders");
                  setError("");
                  setNotice("");
                }}
              >
                <ArrowLeft size={16} aria-hidden="true" /> Volver a pedidos
              </button>
            )}
            {tab !== "new" && (
              <button
                className="secondary compact"
                onClick={reload}
                disabled={busy}
              >
                <RefreshCw size={16} aria-hidden="true" /> Actualizar
              </button>
            )}
            {tab === "orders" && canSell && (
              <button
                className="compact"
                onClick={() => {
                  setTab("new");
                  setError("");
                  setNotice("");
                }}
              >
                <Plus size={16} aria-hidden="true" /> Registrar pedido
              </button>
            )}
          </div>
        </header>
        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}
        {tab === "dashboard" && admin && (
          <>
            <div className="stats">
              {[
                ["Pedidos", activeOrders.length],
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
              orders={activeOrders.slice(0, 5)}
              busy={busy}
              canBill={canBill}
              userId={session?.user?.id}
              canSell={canSell}
              onEdit={updateOrder}
              onCancelOrder={cancelOrder}
              products={products}
              zones={zones}
              invoices={invoices}
            />
          </>
        )}
        {tab === "production" && seesProduction && (
          <Production orders={activeOrders} onStatus={setItemStatus} />
        )}
        {tab === "orders" && (
          <Orders
            orders={visibleOrders}
            busy={busy}
            canBill={canBill}
            userId={session?.user?.id}
            canSell={canSell}
            onEdit={updateOrder}
            onCancelOrder={cancelOrder}
            products={products}
            zones={zones}
            invoices={invoices}
          />
        )}
        {tab === "billing" && canBill && (
          <Billing
            orders={activeOrders}
            invoices={invoices}
            zones={zones}
            busy={busy}
            onCreate={createInvoice}
          />
        )}
        {tab === "new" && canSell && (
          <OrderForm
            products={products.filter((p) => p.active)}
            zones={zones}
            busy={busy}
            onSubmit={createOrder}
          />
        )}
        {tab === "products" && admin && editingProduct && (
          <ProductEditModal
            product={editingProduct}
            products={products}
            onSave={updateProduct}
            onClose={() => setEditingProduct(null)}
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
                  <input
                    name="sku"
                    key={nextSku(products)}
                    defaultValue={nextSku(products)}
                    placeholder="Referencia / SKU (opcional)"
                  />
                  <CategorySelect products={products} />
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
                    {[
                      ["name", "Producto"],
                      ["category", "Categoría"],
                      ["sku", "Referencia"],
                      ["price", "Precio", "num"],
                      ["price_wholesale", "Mayorista", "num"],
                      ["active", "Estado"],
                    ].map(([key, label, cls]) => (
                      <SortTh
                        key={key}
                        sortKey={key}
                        label={label}
                        className={cls}
                        sort={productSort}
                        onSort={setProductSort}
                      />
                    ))}
                    {admin && <th>Acción</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortRows(products, productSort).map((p) => (
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
                              onClick={() => setEditingProduct(p)}
                            >
                              <Pencil size={15} aria-hidden="true" /> Editar
                            </button>
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
// Catálogo visual (categorías, búsqueda y tarjetas). Se usa al crear el
// pedido y en la ventana "Agregar productos" al editarlo.
function ProductCatalog({ products, wholesale, inCart, onAdd, titleId, title = "Catálogo" }) {
  const [cat, setCat] = useState("all");
  const [query, setQuery] = useState("");
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
  return (
    <>
        <div className="catalog-head">
          <h2 id={titleId}>{title}</h2>
          <input
            type="search"
            className="catalog-search"
            placeholder="Buscar producto"
            aria-label="Buscar producto"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
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
                        onClick={() => onAdd(p)}
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
    </>
  );
}
function OrderForm({ products, zones = [], busy, onSubmit }) {
  const [lines, setLines] = useState([]);
  const [zone, setZone] = useState("");
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
  const subtotal = lines.reduce(
    (s, l) => s + (unitPrice(byId.get(l.product_id)) || 0) * (Number(l.quantity) || 0),
    0,
  );
  const zoneRow = zones.find((z) => z.code === zone);
  const fee = zoneRow?.fee || 0;
  const total = subtotal + fee;
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
    (!zones.length || !!zone) &&
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
        <ProductCatalog
          products={products}
          wholesale={wholesale}
          inCart={inCart}
          onAdd={add}
          titleId="catalog-title"
        />
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
                placeholder="Calle, número, barrio"
              />
            </label>
            {zones.length > 0 && (
              <label>
                Municipio (domicilio)
                <select
                  name="delivery_zone"
                  required
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                >
                  <option value="" disabled>
                    Escoge el municipio
                  </option>
                  {zones.map((z) => (
                    <option key={z.code} value={z.code}>
                      {z.name} · {z.fee ? fmtMoney(z.fee) : "sin costo"}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
            {zoneRow && (
              <dl className="cartbreak">
                <div>
                  <dt>Productos</dt>
                  <dd>{fmtMoney(subtotal)}</dd>
                </div>
                <div>
                  <dt>Domicilio · {zoneRow.name}</dt>
                  <dd>{fee ? fmtMoney(fee) : "Sin costo"}</dd>
                </div>
              </dl>
            )}
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
// Ventana modal: Esc, clic fuera o botón Cerrar la cierran; el foco vuelve
// al botón que la abrió.
function Modal({ title, onClose, children, footer }) {
  const boxRef = useRef(null);
  const titleId = useRef(`modal-${Math.random().toString(36).slice(2)}`).current;
  useEffect(() => {
    const prev = document.activeElement;
    boxRef.current?.querySelector("input, button")?.focus();
    const onKey = (e) =>
      e.key === "Escape" && !document.querySelector(".lightbox") && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={boxRef}
      >
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="iconbtn"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
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
function OrderEditForm({ order, products = [], zones = [], invoiced = false, canBill, onSave, onCancel }) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const [zone, setZone] = useState(order.delivery_zone || "");
  const zoneRow = zones.find((z) => z.code === zone);
  const zoneChanged = !!zone && zone !== (order.delivery_zone || "");
  const fee = zoneChanged ? zoneRow?.fee || 0 : order.delivery_fee || 0;
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
  const [picking, setPicking] = useState(false);
  // Desde el catálogo: suma a la línea pendiente sin personalización del
  // mismo producto; si no hay, agrega una nueva.
  const addFromCatalog = (p) =>
    setItems((xs) => {
      const i = xs.findIndex(
        (x) => x.product_id === p.id && x.status === "pending" && !x.notes.trim(),
      );
      if (i >= 0)
        return xs.map((x, j) =>
          j === i ? { ...x, quantity: (Number(x.quantity) || 0) + 1 } : x,
        );
      return [
        ...xs,
        {
          key: `new-${p.id}-${Date.now()}`,
          id: null,
          product_id: p.id,
          quantity: 1,
          notes: "",
          status: "pending",
          unit_price: null,
          name: p.name,
          image_url: p.image_url || null,
        },
      ];
    });
  const countOf = (id) =>
    items
      .filter((x) => x.product_id === id)
      .reduce((s, x) => s + (Number(x.quantity) || 0), 0);
  const editItem = (key, k, v) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, [k]: v } : x)));
  const units = items.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
  // Mismo criterio que update_order: 12+ unidades pasa a mayorista.
  const willBeWholesale = !order.wholesale && units >= WHOLESALE_MIN_UNITS;
  const wholesaleNow = order.wholesale || willBeWholesale;
  const priceOf = (x) => {
    const p = byId.get(x.product_id);
    if (willBeWholesale && p) return p.price_wholesale ?? p.price;
    if (x.id && x.unit_price != null) return x.unit_price;
    if (!p) return x.unit_price ?? 0;
    return wholesaleNow ? (p.price_wholesale ?? p.price) : p.price;
  };
  const total =
    items.reduce((s, x) => s + (priceOf(x) || 0) * (Number(x.quantity) || 0), 0) + fee;
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
  const overpaid = !canBill && (itemsChanged || zoneChanged) && paidNow > total;
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
      ...(zoneChanged && { delivery_zone: zone }),
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
            placeholder="Calle, número, barrio"
          />
        </label>
        {zones.length > 0 && (
          <label className="span2">
            Municipio (domicilio)
            <select
              value={zone}
              disabled={invoiced}
              onChange={(e) => setZone(e.target.value)}
            >
              {!order.delivery_zone && (
                <option value="" disabled>
                  Sin definir: escoge el municipio
                </option>
              )}
              {zones.map((z) => (
                <option key={z.code} value={z.code}>
                  {z.name} · {z.fee ? fmtMoney(z.fee) : "sin costo"}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {invoiced && (
        <p className="fieldhelp">
          Este pedido ya está facturado: los productos y el domicilio no se
          pueden cambiar.
        </p>
      )}
      <fieldset className="edititems" disabled={invoiced}>
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
          <button
            type="button"
            className="secondary compact"
            onClick={() => setPicking(true)}
          >
            <Plus size={15} aria-hidden="true" /> Agregar productos
          </button>
        </div>
        {picking && (
          <Modal
            title="Agregar productos"
            onClose={() => setPicking(false)}
            footer={
              <>
                <span>
                  <b>{units}</b> {units === 1 ? "unidad" : "unidades"} ·{" "}
                  <b>{fmtMoney(total)}</b>
                </span>
                <button type="button" onClick={() => setPicking(false)}>
                  Listo
                </button>
              </>
            }
          >
            <ProductCatalog
              products={addable}
              wholesale={wholesaleNow}
              inCart={countOf}
              onAdd={addFromCatalog}
              titleId={`catalog-${order.id}`}
              title="Catálogo"
            />
          </Modal>
        )}
        <div className="edititem-total">
          <span>
            Nuevo total{wholesaleNow ? " (precio mayorista)" : ""}
            {fee > 0 && <small> · incluye domicilio {fmtMoney(fee)}</small>}
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
// Historial de pagos del pedido (los cambios de pago se hacen en Editar).
function PaymentHistory({ order }) {
  const payments = [...(order.order_payments || [])].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  if (!payments.length) return null;
  return (
    <div className="paybox">
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
    </div>
  );
}
function Orders({ orders, busy, canBill, userId, canSell, onEdit, onCancelOrder, products = [], zones = [], invoices = [] }) {
  const [filter, setFilter] = useState("all");
  const [cancellingId, setCancellingId] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const zoneName = new Map(zones.map((z) => [z.code, z.name]));
  const invoiceOf = new Map(invoices.map((x) => [x.order_id, x]));
  // Debe coincidir con update_order (SQL).
  const canEdit = (o) => !o.cancelled_at && (canBill || (canSell && o.seller_id === userId));
  // Debe coincidir con cancel_order (SQL): admin y Facturación siempre; el
  // vendedor dueño solo si todo sigue pendiente. Un pedido facturado no se cancela aquí.
  const canCancel = (o) =>
    !!onCancelOrder &&
    !o.cancelled_at &&
    !invoiceOf.has(o.id) &&
    (canBill ||
      (canSell &&
        o.seller_id === userId &&
        (o.order_items || []).every((i) => i.status === "pending")));
  const filtered = orders.filter((o) =>
    filter === "all"
      ? true
      : filter === "cancelled"
        ? !!o.cancelled_at
        : !o.cancelled_at && o.order_items?.some((i) => i.status === filter),
  );
  const cancelling = orders.find((o) => o.id === cancellingId);
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
            <option value="cancelled">Cancelados</option>
          </select>
        </label>
      </div>
      {!filtered.length && (
        <div className="panel">
          {canSell && !orders.length ? "Aún no has generado pedidos." : "No hay pedidos para mostrar."}
        </div>
      )}
      {filtered.map((o) => (
        <article className={"panel order" + (o.cancelled_at ? " cancelled" : "")} key={o.id}>
          <div className="orderhead">
            <div>
              <h2>
                Pedido #{o.order_number}
                {o.cancelled_at && <span className="pill cancelled-pill">Cancelado</span>}
                {o.wholesale && <span className="pill wholesale-pill">Precio mayorista</span>}
                {invoiceOf.has(o.id) && (
                  <span className="pill invoiced-pill">
                    Facturado {fmtInvoice(invoiceOf.get(o.id).invoice_number)}
                  </span>
                )}
              </h2>
              {o.cancelled_at && (
                <p className="cancelnote">
                  <b>Cancelado</b> el {new Date(o.cancelled_at).toLocaleDateString("es-CO")}
                  {o.cancel_reason && <> · Motivo: {o.cancel_reason}</>}
                </p>
              )}
              <p>
                <b>Cliente:</b> {o.customer_name}{" "}
                {o.customer_phone && `· ${o.customer_phone}`}
              </p>
              <p>
                <b>Vendedor:</b> {o.seller_name || "—"} ·{" "}
                <b>Entrega:</b> {fmtDate(o.delivery_date)}
                {o.delivery_time && ` · ${fmtTime(o.delivery_time)}`}
              </p>
              {(o.delivery_address || o.delivery_zone) && (
                <p>
                  <b>Dirección:</b> {o.delivery_address || "—"}
                  {o.delivery_zone && <> · {zoneName.get(o.delivery_zone) || o.delivery_zone}</>}
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
              {canCancel(o) && editingId !== o.id && (
                <button
                  type="button"
                  className="secondary compact dangerbtn"
                  onClick={() => setCancellingId(o.id)}
                >
                  <X size={15} aria-hidden="true" /> Cancelar pedido
                </button>
              )}
            </div>
          </div>
          {editingId === o.id && (
            <OrderEditForm
              order={o}
              products={products}
              zones={zones}
              invoiced={invoiceOf.has(o.id)}
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
                      {/* Solo informativo: el estado se cambia en la línea de producción */}
                      <span className={"pill " + i.status}>{labels[i.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {o.order_items?.some((i) => i.unit_price != null) && (
                <tfoot>
                  {o.delivery_zone && (
                    <tr className="subrow">
                      <td colSpan={3}>
                        Domicilio · {zoneName.get(o.delivery_zone) || o.delivery_zone}
                      </td>
                      <td className="num">
                        {o.delivery_fee ? fmtMoney(o.delivery_fee) : "Sin costo"}
                      </td>
                      <td />
                    </tr>
                  )}
                  <tr>
                    <td colSpan={3}>Total</td>
                    <td className="num">
                      <b>{fmtMoney(orderGrandTotal(o))}</b>
                    </td>
                    <td />
                  </tr>
                  {o.payment_status === "partial" && o.amount_paid != null && (
                    <tr>
                      <td colSpan={3}>Saldo pendiente</td>
                      <td className="num">{fmtMoney(orderGrandTotal(o) - o.amount_paid)}</td>
                      <td />
                    </tr>
                  )}
                </tfoot>
              )}
            </table>
          </div>
          <PaymentHistory order={o} />
        </article>
      ))}
      <Lightbox photo={photo} onClose={() => setPhoto(null)} />
      {cancelling && (
        <CancelOrderModal
          order={cancelling}
          onConfirm={onCancelOrder}
          onClose={() => setCancellingId(null)}
        />
      )}
    </>
  );
}
// Ventana para cancelar un pedido: pide el motivo (obligatorio).
function CancelOrderModal({ order, onConfirm, onClose }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const paid = order.amount_paid || 0;
  async function confirm() {
    if (!reason.trim() || saving) return;
    setSaving(true);
    const ok = await onConfirm(order.id, reason.trim());
    setSaving(false);
    if (ok) onClose();
  }
  return (
    <Modal
      title={`Cancelar pedido #${order.order_number}`}
      onClose={onClose}
      footer={
        <>
          <span />
          <span className="modal-actions">
            <button type="button" className="secondary" disabled={saving} onClick={onClose}>
              Volver
            </button>
            <button
              type="button"
              className="dangerbtn solid"
              disabled={!reason.trim() || saving}
              onClick={confirm}
            >
              {saving && <Loader2 size={16} className="spin" aria-hidden="true" />}
              {saving ? "Cancelando…" : "Cancelar pedido"}
            </button>
          </span>
        </>
      }
    >
      <div className="cancelform">
        <p>
          El pedido de <b>{order.customer_name}</b> quedará marcado como cancelado:
          sale de Producción y de Facturación, y ya no se podrá editar. No se borra.
        </p>
        {paid > 0 && (
          <p className="fielderror">
            Este pedido tiene {fmtMoney(paid)} abonados: recuerda gestionar la devolución.
          </p>
        )}
        <label>
          Motivo de la cancelación
          <textarea
            rows={3}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej.: el cliente desistió del pedido"
          />
        </label>
      </div>
    </Modal>
  );
}
// Siguiente SKU libre: toma el prefijo más usado (p. ej. NAV26) y el número
// más alto + 1. Si ningún SKU tiene la forma PREFIJO-número, devuelve "".
function nextSku(products) {
  const byPrefix = {};
  for (const p of products) {
    const m = /^(.+?)-(d+)$/.exec(p.sku?.trim() || "");
    if (!m) continue;
    const e = (byPrefix[m[1]] ||= { count: 0, max: 0, width: 2 });
    e.count++;
    e.max = Math.max(e.max, Number(m[2]));
    e.width = Math.max(e.width, m[2].length);
  }
  const best = Object.entries(byPrefix).sort((a, b) => b[1].count - a[1].count)[0];
  if (!best) return "";
  const [prefix, e] = best;
  return `${prefix}-${String(e.max + 1).padStart(e.width, "0")}`;
}
// Ordena filas por una columna (texto A-Z con acentos, números de menor a
// mayor). Los vacíos van siempre al final.
function sortRows(rows, { key, dir }) {
  if (!key) return rows;
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    const ex = x == null || x === "";
    const ey = y == null || y === "";
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
    // Estado: A-Z = "Activo" antes que "Inactivo".
    if (typeof x === "boolean") return (Number(y) - Number(x)) * sign;
    return (
      String(x).localeCompare(String(y), "es", { numeric: true, sensitivity: "base" }) * sign
    );
  });
}
// Encabezado de tabla con botón para ordenar: 1.er clic A-Z, 2.º Z-A.
function SortTh({ sortKey, label, className, sort, onSort }) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={className}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className={"sortbtn" + (active ? " is-active" : "")}
        onClick={() =>
          onSort({
            key: sortKey,
            dir: active && sort.dir === "asc" ? "desc" : "asc",
          })
        }
        title={active && sort.dir === "asc" ? "Ordenar Z-A" : "Ordenar A-Z"}
      >
        {label}
        <Icon size={13} aria-hidden="true" />
      </button>
    </th>
  );
}
// Lista desplegable de categorías: las que ya existen en el catálogo más
// "Nueva categoría…". El valor viaja en un campo oculto name="category".
function CategorySelect({ products, defaultValue = "" }) {
  const options = [
    ...new Set(products.map((p) => p.category?.trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "es"));
  const [choice, setChoice] = useState(defaultValue);
  const [custom, setCustom] = useState("");
  const selectRef = useRef(null);
  // Al hacer reset() del formulario (tras crear), vuelve al valor inicial.
  useEffect(() => {
    const form = selectRef.current?.form;
    if (!form) return;
    const onReset = () => {
      setChoice(defaultValue);
      setCustom("");
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [defaultValue]);
  const isNew = choice === "__new__";
  return (
    <>
      <select
        ref={selectRef}
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        aria-label="Categoría / línea"
      >
        <option value="">Sin categoría</option>
        {options.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value="__new__">+ Nueva categoría…</option>
      </select>
      {isNew && (
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Nombre de la nueva categoría"
          aria-label="Nueva categoría"
          required
          autoFocus
        />
      )}
      <input type="hidden" name="category" value={isNew ? custom : choice} />
    </>
  );
}
// Ventana para editar un producto (solo Administrador). Los pedidos ya
// creados no cambian: guardan su propio precio.
function ProductEditModal({ product, products = [], onSave, onClose }) {
  const [saving, setSaving] = useState(false);
  const formId = `product-${product.id}`;
  const num = (v) => (v === "" || v == null ? null : Number(v));
  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    const f = new FormData(e.currentTarget);
    setSaving(true);
    const ok = await onSave(product.id, {
      name: String(f.get("name") || "").trim(),
      sku: String(f.get("sku") || "").trim() || null,
      category: String(f.get("category") || "").trim() || null,
      price: num(f.get("price")),
      price_wholesale: num(f.get("price_wholesale")),
      description: String(f.get("description") || "").trim() || null,
    });
    setSaving(false);
    if (ok) onClose();
  }
  return (
    <Modal
      title={`Editar · ${product.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="fieldhelp">Los pedidos ya creados conservan su precio.</span>
          <span className="modal-actions">
            <button type="button" className="secondary" disabled={saving} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" form={formId} disabled={saving}>
              {saving && <Loader2 size={16} className="spin" aria-hidden="true" />}
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </span>
        </>
      }
    >
      <form id={formId} className="editgrid productedit" onSubmit={submit}>
        <label className="span2">
          Nombre
          <input name="name" required defaultValue={product.name} />
        </label>
        <label>
          Categoría / línea
          <CategorySelect products={products} defaultValue={product.category || ""} />
        </label>
        <label>
          Referencia / SKU
          <input name="sku" defaultValue={product.sku || ""} />
        </label>
        <label>
          Precio general (COP)
          <input name="price" type="number" min="0" step="1" inputMode="numeric" defaultValue={product.price ?? ""} />
        </label>
        <label>
          Precio mayorista (COP)
          <input name="price_wholesale" type="number" min="0" step="1" inputMode="numeric" defaultValue={product.price_wholesale ?? ""} />
        </label>
        <label className="span2">
          Descripción
          <input name="description" defaultValue={product.description || ""} />
        </label>
      </form>
    </Modal>
  );
}
// ---------------------------------------------------------------------
// Línea de producción: tablero por pedido. La columna sale del estado de
// sus productos (todos pendientes / alguno en curso / todos finalizados);
// cada producto se gestiona por separado en el detalle.
// ---------------------------------------------------------------------
const PROD_COLUMNS = [
  { id: "pending", title: "Pendientes", hint: "Por iniciar", icon: "clock" },
  { id: "in_progress", title: "En proceso", hint: "En fabricación", icon: "gear" },
  { id: "finished", title: "Finalizados", hint: "Listos para entrega", icon: "check" },
];
const orderStage = (o) => {
  const its = o.order_items || [];
  if (!its.length || its.every((i) => i.status === "pending")) return "pending";
  if (its.every((i) => i.status === "finished")) return "finished";
  return "in_progress";
};
// Días hasta la entrega (0 = hoy, negativo = vencido); null sin fecha.
const daysUntil = (d) => {
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(d + "T00:00:00") - today) / 86400000);
};
function DueChip({ order, done }) {
  const n = daysUntil(order.delivery_date);
  const time = order.delivery_time ? ` · ${fmtTime(order.delivery_time)}` : "";
  let text, tone;
  if (n === null) [text, tone] = ["Sin fecha", "neutral"];
  else if (done) [text, tone] = [`Entrega ${fmtDate(order.delivery_date)}${time}`, "ok"];
  else if (n < 0) [text, tone] = [`Vencido ${-n} ${n === -1 ? "día" : "días"}`, "late"];
  else if (n === 0) [text, tone] = [`Hoy${time}`, "late"];
  else if (n === 1) [text, tone] = [`Mañana${time}`, "soon"];
  else if (n <= 3) [text, tone] = [`En ${n} días`, "soon"];
  else [text, tone] = [`En ${n} días`, "ok"];
  return (
    <span className={`due due-${tone}`}>
      <CalendarDays size={13} aria-hidden="true" /> {text}
    </span>
  );
}
function StatusSwitch({ item, onChange, saving }) {
  return (
    <div className="statusswitch" role="radiogroup" aria-label={`Estado de ${item.products?.name || "producto"}`}>
      {Object.entries(labels).map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={item.status === v}
          className={`st-${v}` + (item.status === v ? " on" : "")}
          disabled={saving}
          onClick={() => item.status !== v && onChange(item.id, v)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
function ProductionDetail({ order, onStatus, onClose, onPhoto }) {
  const [savingId, setSavingId] = useState(null);
  const its = order.order_items || [];
  const done = its.filter((i) => i.status === "finished").length;
  async function change(id, status) {
    setSavingId(id);
    await onStatus(id, status);
    setSavingId(null);
  }
  return (
    <Modal
      title={`Pedido #${order.order_number} · ${order.customer_name}`}
      onClose={onClose}
      footer={
        <>
          <span>
            <b>{done}</b> de {its.length} productos finalizados
          </span>
          <button type="button" onClick={onClose}>
            Listo
          </button>
        </>
      }
    >
      <div className="pd-meta">
        <DueChip order={order} done={done === its.length && its.length > 0} />
        <span>Vendedor: {order.seller_name || "—"}</span>
        {order.notes && <span className="pd-notes">Observaciones: {order.notes}</span>}
      </div>
      <ul className="pd-items">
        {its.map((i) => (
          <li key={i.id} className={`pd-item st-${i.status}`}>
            {i.products?.image_url ? (
              <button
                type="button"
                className="pd-photo"
                onClick={() => onPhoto({ src: i.products.image_url, alt: i.products.name })}
                aria-label={`Ampliar foto de ${i.products.name}`}
              >
                <img src={i.products.image_url} alt="" width="72" height="72" loading="lazy" />
              </button>
            ) : (
              <span className="pd-photo" aria-hidden="true">
                <Package size={22} />
              </span>
            )}
            <div className="pd-info">
              <b>{i.products?.name || "Producto"}</b>
              <span className="pd-qty">× {i.quantity}</span>
              {i.notes && <span className="pd-note">{i.notes}</span>}
            </div>
            <div className="pd-actions">
              {savingId === i.id && <Loader2 size={16} className="spin" aria-label="Guardando" />}
              <StatusSwitch item={i} onChange={change} saving={savingId === i.id} />
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
function Production({ orders, onStatus }) {
  const [query, setQuery] = useState("");
  const [range, setRange] = useState("all");
  const [sort, setSort] = useState("due");
  const [openId, setOpenId] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [mobileCol, setMobileCol] = useState("pending");
  const q = query.trim().toLowerCase();
  const inRange = (o) => {
    if (range === "all") return true;
    const n = daysUntil(o.delivery_date);
    if (n === null) return false;
    if (range === "today") return n <= 0;
    if (range === "soon") return n >= 1 && n <= 3;
    return n <= 7;
  };
  const list = orders
    .filter(
      (o) =>
        inRange(o) &&
        (!q ||
          String(o.order_number).includes(q.replace("#", "")) ||
          o.customer_name?.toLowerCase().includes(q) ||
          o.order_items?.some((i) => i.products?.name?.toLowerCase().includes(q))),
    )
    .sort((a, b) =>
      sort === "number"
        ? b.order_number - a.order_number
        : (a.delivery_date || "9999-12-31").localeCompare(b.delivery_date || "9999-12-31") ||
          (a.delivery_time || "").localeCompare(b.delivery_time || ""),
    );
  const byCol = Object.fromEntries(PROD_COLUMNS.map((c) => [c.id, []]));
  list.forEach((o) => byCol[orderStage(o)].push(o));
  const open = orders.find((o) => o.id === openId);
  const colIcon = { clock: Clock, gear: Settings, check: CheckCircle2 };
  return (
    <div className="prod">
      <div className="prod-stats">
        <div className="pstat"><span>Pedidos</span><b>{list.length}</b></div>
        {PROD_COLUMNS.map((c) => (
          <div key={c.id} className={`pstat ps-${c.id}`}>
            <span>{c.title}</span>
            <b>{byCol[c.id].length}</b>
          </div>
        ))}
      </div>
      <div className="prod-tools">
        <input
          type="search"
          className="prod-search"
          placeholder="Buscar pedido, cliente o producto"
          aria-label="Buscar pedido, cliente o producto"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="chips prod-range" role="group" aria-label="Fecha de entrega">
          {[["all", "Todos"], ["today", "Hoy y vencidos"], ["soon", "Próximos 1–3 días"], ["week", "Esta semana"]].map(([v, l]) => (
            <button key={v} type="button" className={"chip" + (range === v ? " active" : "")} aria-pressed={range === v} onClick={() => setRange(v)}>
              {l}
            </button>
          ))}
        </div>
        <label className="prod-sort">
          Ordenar por
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="due">Fecha de entrega</option>
            <option value="number">Pedido más reciente</option>
          </select>
        </label>
      </div>
      <div className="prod-mobiletabs" role="group" aria-label="Columna">
        {PROD_COLUMNS.map((c) => (
          <button key={c.id} type="button" className={mobileCol === c.id ? "on" : ""} aria-pressed={mobileCol === c.id} onClick={() => setMobileCol(c.id)}>
            {c.title} <span>{byCol[c.id].length}</span>
          </button>
        ))}
      </div>
      <div className="board" data-col={mobileCol}>
        {PROD_COLUMNS.map((c) => {
          const Icon = colIcon[c.icon];
          return (
            <section key={c.id} className={`bcol bc-${c.id}`} aria-labelledby={`bcol-${c.id}`}>
              <header>
                <Icon size={18} aria-hidden="true" />
                <div>
                  <h2 id={`bcol-${c.id}`}>
                    {c.title} <span>{byCol[c.id].length}</span>
                  </h2>
                  <small>{c.hint}</small>
                </div>
              </header>
              {!byCol[c.id].length && <p className="empty">Sin pedidos aquí.</p>}
              {byCol[c.id].map((o) => {
                const its = o.order_items || [];
                const done = its.filter((i) => i.status === "finished").length;
                const units = its.reduce((s, i) => s + i.quantity, 0);
                const pct = its.length ? Math.round((done / its.length) * 100) : 0;
                return (
                  <article key={o.id} className="pcard2">
                    <div className="pc-top">
                      <b>#{o.order_number}</b>
                      <DueChip order={o} done={c.id === "finished"} />
                    </div>
                    <div className="pc-client">{o.customer_name}</div>
                    <div className="pc-meta">
                      {its.length} {its.length === 1 ? "producto" : "productos"} · {units}{" "}
                      {units === 1 ? "unidad" : "unidades"}
                    </div>
                    {c.id === "in_progress" && (
                      <div className="pc-progress" aria-label={`${done} de ${its.length} productos finalizados`}>
                        <span><i style={{ width: `${pct}%` }} /></span>
                        <small>{done} de {its.length}</small>
                      </div>
                    )}
                    <div className="pc-foot">
                      <div className="pc-thumbs">
                        {its.slice(0, 4).map((i) => (
                          <span key={i.id} className={`pc-thumb st-${i.status}`} title={`${i.products?.name} · ${labels[i.status]}`}>
                            {i.products?.image_url ? (
                              <img src={i.products.image_url} alt="" width="40" height="40" loading="lazy" />
                            ) : (
                              <Package size={16} aria-hidden="true" />
                            )}
                          </span>
                        ))}
                        {its.length > 4 && <span className="pc-more">+{its.length - 4}</span>}
                      </div>
                      <button type="button" className="secondary compact" onClick={() => setOpenId(o.id)}>
                        <Eye size={15} aria-hidden="true" /> Ver detalle
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
      {open && (
        <ProductionDetail
          order={open}
          onStatus={onStatus}
          onClose={() => setOpenId(null)}
          onPhoto={setPhoto}
        />
      )}
      <Lightbox photo={photo} onClose={() => setPhoto(null)} />
    </div>
  );
}
// ---------------------------------------------------------------------
// Facturación: una factura interna por entrega (pedido). Se genera con una
// vista previa; la factura guarda una copia fija de los datos y se imprime
// o se guarda como PDF desde el navegador.
// ---------------------------------------------------------------------
// Borrador de factura a partir del pedido (misma forma que la tabla invoices)
function invoiceDraft(order, zones) {
  const sub = itemsTotal(order);
  const fee = order.delivery_fee || 0;
  const total = sub + fee;
  const paid = Math.min(order.amount_paid || 0, total);
  return {
    invoice_number: null,
    created_at: new Date().toISOString(),
    order_number: order.order_number,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    delivery_address: order.delivery_address,
    delivery_zone_name: zones.find((z) => z.code === order.delivery_zone)?.name || null,
    delivery_date: order.delivery_date,
    delivery_time: order.delivery_time,
    wholesale: order.wholesale,
    items: (order.order_items || []).map((i) => ({
      name: i.products?.name || "Producto",
      quantity: i.quantity,
      unit_price: i.unit_price || 0,
      notes: i.notes,
    })),
    subtotal: sub,
    delivery_fee: fee,
    total,
    amount_paid: paid,
    balance: total - paid,
    payment_method: order.payment_method,
  };
}
function InvoiceDoc({ inv }) {
  const draft = inv.invoice_number == null;
  return (
    <article className={"invoice-doc" + (draft ? " draft" : "")}>
      <header className="inv-head">
        <div>
          <div className="inv-brand">Thian Candle</div>
          <small>Chispa de luz, fe y aroma</small>
        </div>
        <div className="inv-no">
          <span>Factura</span>
          <b>{fmtInvoice(inv.invoice_number)}</b>
          <small>Fecha: {new Date(inv.created_at).toLocaleDateString("es-CO")}</small>
          <small>Pedido #{inv.order_number}</small>
        </div>
      </header>
      <section className="inv-parties">
        <div>
          <h3>Cliente</h3>
          <p>
            <b>{inv.customer_name}</b>
          </p>
          {inv.customer_phone && <p>Tel. {inv.customer_phone}</p>}
        </div>
        <div>
          <h3>Entrega</h3>
          <p>{inv.delivery_address || "—"}</p>
          {inv.delivery_zone_name && <p>{inv.delivery_zone_name}</p>}
          <p>
            {fmtDate(inv.delivery_date)}
            {inv.delivery_time && ` · ${fmtTime(inv.delivery_time)}`}
          </p>
        </div>
      </section>
      <table className="inv-table">
        <thead>
          <tr>
            <th>Producto</th>
            <th className="num">Cant.</th>
            <th className="num">Precio</th>
            <th className="num">Valor</th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((i, k) => (
            <tr key={k}>
              <td>
                {i.name}
                {i.notes && <small>{i.notes}</small>}
              </td>
              <td className="num">{i.quantity}</td>
              <td className="num">{fmtMoney(i.unit_price)}</td>
              <td className="num">{fmtMoney(i.unit_price * i.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="inv-totals">
        <div>
          <dt>Productos{inv.wholesale ? " (precio mayorista)" : ""}</dt>
          <dd>{fmtMoney(inv.subtotal)}</dd>
        </div>
        <div>
          <dt>Domicilio{inv.delivery_zone_name ? ` · ${inv.delivery_zone_name}` : ""}</dt>
          <dd>{inv.delivery_fee ? fmtMoney(inv.delivery_fee) : "Sin costo"}</dd>
        </div>
        <div className="inv-total">
          <dt>Total</dt>
          <dd>{fmtMoney(inv.total)}</dd>
        </div>
        <div>
          <dt>
            Abonado
            {inv.amount_paid > 0 && inv.payment_method && ` (${PAYMENT_METHOD[inv.payment_method]})`}
          </dt>
          <dd>{fmtMoney(inv.amount_paid)}</dd>
        </div>
        <div className="inv-balance">
          <dt>Saldo a pagar</dt>
          <dd>{fmtMoney(inv.balance)}</dd>
        </div>
      </dl>
      <footer className="inv-foot">Gracias por tu compra.</footer>
    </article>
  );
}
function InvoiceModal({ inv, title, onClose, actions }) {
  return (
    <Modal title={title} onClose={onClose} footer={actions}>
      <InvoiceDoc inv={inv} />
      {/* Copia que solo aparece al imprimir */}
      {inv.invoice_number != null &&
        createPortal(
          <div className="print-root">
            <InvoiceDoc inv={inv} />
          </div>,
          document.body,
        )}
    </Modal>
  );
}
function Billing({ orders, invoices, zones, busy, onCreate }) {
  const [view, setView] = useState("todo");
  const [query, setQuery] = useState("");
  const [previewId, setPreviewId] = useState(null);
  const [openInvoiceId, setOpenInvoiceId] = useState(null);
  const invoiced = new Set(invoices.map((x) => x.order_id));
  const q = query.trim().toLowerCase().replace("#", "");
  const ready = (o) => (o.order_items || []).length > 0 && orderStage(o) === "finished";
  const pending = orders
    .filter((o) => !invoiced.has(o.id))
    .sort(
      (a, b) =>
        Number(ready(b)) - Number(ready(a)) ||
        (a.delivery_date || "9999-12-31").localeCompare(b.delivery_date || "9999-12-31"),
    );
  const match = (num, name) => !q || String(num).includes(q) || name?.toLowerCase().includes(q);
  const pendingList = pending.filter((o) => match(o.order_number, o.customer_name));
  const doneList = invoices.filter(
    (x) => match(x.order_number, x.customer_name) || fmtInvoice(x.invoice_number).toLowerCase().includes(q),
  );
  const readyCount = pending.filter(ready).length;
  const balance = invoices.reduce((s, x) => s + (x.balance || 0), 0);
  const preview = orders.find((o) => o.id === previewId);
  const openInv = invoices.find((x) => x.id === openInvoiceId);
  async function generate() {
    const n = await onCreate(preview.id);
    if (n == null) {
      lastCreated.current = null;
      return;
    }
    setPreviewId(null);
    setView("done");
  }
  // Al terminar de recargar, abre la factura recién generada
  const lastCreated = useRef(null);
  useEffect(() => {
    if (!lastCreated.current) return;
    const inv = invoices.find((x) => x.order_id === lastCreated.current);
    if (inv) {
      setOpenInvoiceId(inv.id);
      lastCreated.current = null;
    }
  }, [invoices]);
  return (
    <div className="billing">
      <div className="prod-stats">
        <div className="pstat ps-finished"><span>Listos para facturar</span><b>{readyCount}</b></div>
        <div className="pstat ps-in_progress"><span>En producción</span><b>{pending.length - readyCount}</b></div>
        <div className="pstat"><span>Facturas</span><b>{invoices.length}</b></div>
        <div className="pstat ps-pending"><span>Saldo por cobrar</span><b className="money">{fmtMoney(balance)}</b></div>
      </div>
      <div className="prod-tools">
        <input
          type="search"
          className="prod-search"
          placeholder="Buscar pedido, cliente o factura"
          aria-label="Buscar pedido, cliente o factura"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="chips" role="group" aria-label="Vista">
          {[["todo", `Por facturar (${pending.length})`], ["done", `Facturadas (${invoices.length})`]].map(([v, l]) => (
            <button key={v} type="button" className={"chip" + (view === v ? " active" : "")} aria-pressed={view === v} onClick={() => setView(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {view === "todo" && (
        <div className="billlist">
          {!pendingList.length && <div className="panel empty">No hay pedidos por facturar.</div>}
          {pendingList.map((o) => {
            const its = o.order_items || [];
            const done = its.filter((i) => i.status === "finished").length;
            const isReady = ready(o);
            const zone = zones.find((z) => z.code === o.delivery_zone);
            return (
              <article key={o.id} className={"billrow" + (isReady ? " ready" : "")}>
                <div className="br-main">
                  <b>#{o.order_number} · {o.customer_name}</b>
                  <small>
                    <Truck size={13} aria-hidden="true" />{" "}
                    {zone ? `${zone.name} · ${o.delivery_fee ? fmtMoney(o.delivery_fee) : "sin costo"}` : "Sin municipio"}
                    {o.seller_name && ` · Vendedor: ${o.seller_name}`}
                  </small>
                </div>
                <DueChip order={o} done={false} />
                <span className={"pill " + (isReady ? "finished" : "in_progress")}>
                  {isReady ? "Listo para entregar" : `Producción ${done} de ${its.length}`}
                </span>
                <div className="br-money">
                  <b>{fmtMoney(orderGrandTotal(o))}</b>
                  <small>Saldo {fmtMoney(Math.max(orderGrandTotal(o) - (o.amount_paid || 0), 0))}</small>
                </div>
                <button
                  type="button"
                  className={isReady ? "compact" : "secondary compact"}
                  onClick={() => setPreviewId(o.id)}
                >
                  <Receipt size={15} aria-hidden="true" /> Generar factura
                </button>
              </article>
            );
          })}
        </div>
      )}

      {view === "done" && (
        <div className="billlist">
          {!doneList.length && <div className="panel empty">Aún no hay facturas.</div>}
          {doneList.map((x) => (
            <article key={x.id} className="billrow">
              <div className="br-main">
                <b>{fmtInvoice(x.invoice_number)} · {x.customer_name}</b>
                <small>
                  Pedido #{x.order_number} · {new Date(x.created_at).toLocaleDateString("es-CO")}
                  {x.delivery_zone_name && ` · ${x.delivery_zone_name}`}
                </small>
              </div>
              <span className={"pill " + (x.balance > 0 ? "pay-partial" : "pay-paid")}>
                {x.balance > 0 ? `Saldo ${fmtMoney(x.balance)}` : "Pagada"}
              </span>
              <div className="br-money">
                <b>{fmtMoney(x.total)}</b>
              </div>
              <button type="button" className="secondary compact" onClick={() => setOpenInvoiceId(x.id)}>
                <Eye size={15} aria-hidden="true" /> Ver factura
              </button>
            </article>
          ))}
        </div>
      )}

      {preview && (
        <InvoiceModal
          inv={invoiceDraft(preview, zones)}
          title={`Vista previa · Pedido #${preview.order_number}`}
          onClose={() => setPreviewId(null)}
          actions={
            <>
              <span className="fieldhelp">
                {ready(preview)
                  ? "Al generarla se asigna el consecutivo y ya no se pueden cambiar productos ni domicilio."
                  : "Ojo: este pedido aún tiene productos sin finalizar."}
              </span>
              <span className="modal-actions">
                <button type="button" className="secondary" onClick={() => setPreviewId(null)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    lastCreated.current = preview.id;
                    generate();
                  }}
                >
                  {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
                  Generar factura
                </button>
              </span>
            </>
          }
        />
      )}
      {openInv && (
        <InvoiceModal
          inv={openInv}
          title={`Factura ${fmtInvoice(openInv.invoice_number)}`}
          onClose={() => setOpenInvoiceId(null)}
          actions={
            <>
              <span>Pedido #{openInv.order_number}</span>
              <span className="modal-actions">
                <button type="button" className="secondary" onClick={() => setOpenInvoiceId(null)}>
                  Cerrar
                </button>
                <button type="button" onClick={() => window.print()}>
                  <Printer size={16} aria-hidden="true" /> Imprimir o guardar PDF
                </button>
              </span>
            </>
          }
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <App />
  </ThemeProvider>,
);
