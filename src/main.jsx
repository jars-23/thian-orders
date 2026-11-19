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
const fmtMoney = (n) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      }).format(n);
const PRODUCT_BUCKET = "product-images";
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
  // Menú lateral colapsado (solo escritorio); se recuerda en este navegador.
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem("thian.navCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleNav = () =>
    setNavCollapsed((v) => {
      try {
        localStorage.setItem("thian.navCollapsed", v ? "0" : "1");
      } catch {
        /* sin almacenamiento: solo dura la sesión */
      }
      return !v;
    });
  const hasRole = (...codes) => codes.some((c) => roles.includes(c));
  const admin = hasRole("admin");
  // Deben coincidir con las políticas RLS (supabase/migrate_v1_2.sql).
  const canSell = hasRole("admin", "seller", "sales_production");
  const canProduce = hasRole("admin", "production", "sales_production");
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
          "*,order_items(id,product_id,quantity,status,notes,products(name))",
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
  async function createOrder(e, lines) {
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
    });
    message(error, "Pedido registrado correctamente");
    if (!error) {
      setTab("orders");
      await reload();
    }
    setBusy(false);
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
              width="160"
              height="30"
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
          title={`${profile.full_name} · ${roles.join(" · ")}`}
        >
          {(profile.full_name || "?")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0].toUpperCase())
            .join("")}
        </div>
        <div className="identity">
          {profile.full_name}
          <small>{roles.join(" · ") || "Sin roles"}</small>
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
            />
          </>
        )}
        {tab === "orders" && (
          <Orders
            orders={orders}
            admin={canProduce}
            busy={busy}
            changeStatus={changeStatus}
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
                    step="100"
                    inputMode="numeric"
                    placeholder="Precio general (COP)"
                    aria-label="Precio general en pesos"
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
  const nextKey = useRef(0);
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
  const total = lines.reduce(
    (s, l) => s + (byId.get(l.product_id)?.price || 0) * (Number(l.quantity) || 0),
    0,
  );
  const valid =
    lines.length > 0 &&
    lines.every((l) => Number.isInteger(Number(l.quantity)) && Number(l.quantity) > 0);
  return (
    <form onSubmit={(e) => onSubmit(e, lines)}>
      <div className="panel">
        <h2>Datos del pedido</h2>
        <div className="formgrid">
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
              placeholder="Opcional"
            />
          </label>
          <label>
            Fecha de entrega
            <input name="delivery_date" type="date" />
          </label>
          <label>
            Observaciones generales
            <input name="notes" placeholder="Indicaciones del pedido" />
          </label>
        </div>
      </div>

      <div className="orderlayout">
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
                        <strong>{fmtMoney(p.price)}</strong>
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

        <aside className="panel cart" aria-labelledby="cart-title">
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
                return (
                  <li className="cartline" key={l.key}>
                    <div className="cartline-top">
                      <div className="cartthumb" aria-hidden="true">
                        {p?.image_url ? (
                          <img src={p.image_url} alt="" width="44" height="44" />
                        ) : (
                          <Package size={18} />
                        )}
                      </div>
                      <div className="cartinfo">
                        <b>{p?.name || "Producto"}</b>
                        <small>{fmtMoney(p?.price)} c/u</small>
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
                          disabled={Number(l.quantity) <= 1}
                          onClick={() =>
                            edit(l.key, "quantity", Math.max(1, Number(l.quantity) - 1))
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
                          onChange={(e) => edit(l.key, "quantity", e.target.value)}
                          aria-label={`Cantidad de ${p?.name || "producto"}`}
                          required
                        />
                        <button
                          type="button"
                          aria-label="Sumar uno"
                          onClick={() =>
                            edit(l.key, "quantity", (Number(l.quantity) || 0) + 1)
                          }
                        >
                          <Plus size={14} aria-hidden="true" />
                        </button>
                      </div>
                      <input
                        className="cartnotes"
                        placeholder="Personalización: nombres, deseos, color"
                        aria-label={`Personalización de ${p?.name || "producto"}`}
                        value={l.notes}
                        onChange={(e) => edit(l.key, "notes", e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="linkbtn"
                      onClick={() =>
                        setLines((ls) => [...ls, newLine(l.product_id)])
                      }
                    >
                      + Otra con distinta personalización
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="carttotal">
            <span>Total estimado</span>
            <strong>{fmtMoney(total)}</strong>
          </div>
          <small className="carthint">Calculado con el precio general.</small>
          <button className="cartsubmit" disabled={busy || !valid}>
            {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
            {busy ? "Guardando…" : "Guardar pedido"}
          </button>
        </aside>
      </div>
    </form>
  );
}
function Orders({ orders, admin, busy, changeStatus }) {
  const [filter, setFilter] = useState("all");
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
              <h2>Pedido #{o.order_number}</h2>
              <p>
                <b>Cliente:</b> {o.customer_name}{" "}
                {o.customer_phone && `· ${o.customer_phone}`}
              </p>
              <p>
                <b>Vendedor:</b> {o.seller_name || "—"} ·{" "}
                <b>Entrega:</b> {fmtDate(o.delivery_date)}
              </p>
            </div>
            <small>{new Date(o.created_at).toLocaleString("es-CO")}</small>
          </div>
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
                  <th>Cantidad</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {o.order_items?.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.products?.name || "Producto"}
                      {i.notes && <small className="subnote">{i.notes}</small>}
                    </td>
                    <td>{i.quantity}</td>
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
            </table>
          </div>
        </article>
      ))}
    </>
  );
}
createRoot(document.getElementById("root")).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <App />
  </ThemeProvider>,
);
