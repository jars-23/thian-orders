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
  ChevronLeft,
  ChevronRight,
  List,
  Search,
  Power,
  Calculator,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Download,
  MapPin,
  FileText,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Ban,
  Coins,
  MessageCircle,
  PanelRightOpen,
  Filter,
  Store,
  Repeat2,
  Building2,
  Tag,
  CircleHelp,
  KeyRound,
} from "lucide-react";
import "./style.css";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { theme } from "./theme/theme";
import LoginForm from "./components/auth/LoginForm";
import { readSheet, writeXlsx, downloadBlob } from "./sheet";
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
// Regla de negocio: precio mayorista POR REFERENCIA. Un producto va a precio
// mayorista si ese producto suma estas unidades en el pedido.
// Debe coincidir con c_wholesale_min_units en create_order / update_order (SQL).
const WHOLESALE_MIN_UNITS = 12;
// Precio de catálogo según las unidades de ESE producto en el pedido.
const tierPrice = (p, units) =>
  p ? (units >= WHOLESALE_MIN_UNITS ? (p.price_wholesale ?? p.price) : p.price) : null;
// Precio de una línea con la lista del vendedor (fase 2, 20261128).
// Debe coincidir con public.line_price (SQL): si el producto está en la
// lista activa del vendedor, precio de lista desde 1 unidad y el general
// como precio real (tachado); si no, la regla mayorista por referencia.
// special = { name, prices: Map(product_id -> precio) } | null
const linePrice = (p, units, special) => {
  if (!p) return { unit: null, list: null };
  const sp = special?.prices.get(p.id);
  return sp != null ? { unit: sp, list: p.price } : { unit: tierPrice(p, units), list: null };
};
// Precio con el real tachado cuando hay precio de lista.
function PriceTag({ unit, list }) {
  return (
    <>
      {list != null && list !== unit && (
        <s className="price-was" aria-label={"Precio real " + fmtMoney(list)}>
          {fmtMoney(list)}
        </s>
      )}{" "}
      {fmtMoney(unit)}
    </>
  );
}
// Listas de precios visibles para este usuario (admin: todas; vendedor: la suya).
const PriceListCtx = React.createContext({ specialFor: () => null });
// Deben coincidir con los CHECK de orders.payment_status / payment_method.
const PAYMENT_STATUS = {
  pending: "Pago pendiente",
  partial: "Pago parcial",
  paid: "Pago completo",
};
const PAYMENT_METHOD = { transfer: "Transferencia", cash: "Efectivo" };
// Consecutivo de factura: FAC-0001
// Costo vigente de un producto en una fecha (historial product_costs,
// ordenado de más reciente a más antiguo). null = sin costo registrado.
const costAt = (costs, productId, date = new Date()) => {
  const t = new Date(date).getTime();
  const row = costs.find(
    (c) => c.product_id === productId && new Date(c.valid_from).getTime() <= t,
  );
  return row ? row.cost : null;
};
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
    [suppliers, setSuppliers] = useState([]),
    [costs, setCosts] = useState([]),
    [orders, setOrders] = useState([]),
    [sellers, setSellers] = useState([]),
    [zones, setZones] = useState([]),
    [invoices, setInvoices] = useState([]),
    [wholesaleTags, setWholesaleTags] = useState([]),
    [wholesaleError, setWholesaleError] = useState(""),
    [priceLists, setPriceLists] = useState([]),
    [sellerLists, setSellerLists] = useState([]),
    [listsError, setListsError] = useState(""),
    [priceItems, setPriceItems] = useState([]),
    [pwTarget, setPwTarget] = useState(null), // "self" | perfil de otro usuario
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
  // Decisión 2026-11-26: el Administrador ve todos los pedidos en Pedidos.
  const visibleOrders = canSell && !admin
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
    const [p, o, sn, s, r, ur, z, inv, sup, pc, wc, pl, spl, pli] = await Promise.all([
      supabase
        .from("products")
        .select("*")
        .order("category", { nullsFirst: false })
        .order("name"),
      supabase
        .from("orders")
        .select(
          "*,order_items(id,product_id,quantity,status,notes,unit_price,list_price,products(name,image_url)),order_payments(id,amount,method,note,created_at)",
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
      admin
        ? supabase.from("suppliers").select("*").order("name")
        : Promise.resolve({ data: [], error: null }),
      admin
        ? supabase
            .from("product_costs")
            .select("product_id,cost,valid_from")
            .order("valid_from", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      admin
        ? supabase.from("wholesale_customers").select("*")
        : Promise.resolve({ data: [], error: null }),
      // Listas: el admin ve todas; cada vendedor solo la suya (RLS).
      supabase.from("price_lists").select("*").order("name"),
      supabase.from("seller_price_lists").select("*"),
      supabase.from("price_list_items").select("price_list_id,product_id,price"),
    ]);
    const err = p.error || o.error || s.error || r.error || ur.error;
    if (err) message(err);
    else {
      setProducts(p.data || []);
      // Si la migración de proveedores no está aplicada, el catálogo sigue igual.
      if (sup.error) console.warn("suppliers:", sup.error.message);
      setSuppliers(sup.data || []);
      if (pc.error) console.warn("product_costs:", pc.error.message);
      setCosts(pc.data || []);
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
      // Mayoristas: si la migración 20261127 no está aplicada, solo ese menú avisa.
      if (wc.error) console.warn("wholesale_customers:", wc.error.message);
      setWholesaleError(wc.error ? wc.error.message : "");
      setWholesaleTags(wc.data || []);
      // Listas de precios (migración 20261127b): si faltan, solo esa pestaña avisa.
      const plErr = pl.error || spl.error;
      if (plErr) console.warn("price_lists:", plErr.message);
      setListsError(plErr ? plErr.message : "");
      setPriceLists(pl.data || []);
      setSellerLists(spl.data || []);
      // Precios por lista (migración 20261128): sin ella, todo sigue con la regla normal.
      if (pli.error) console.warn("price_list_items:", pli.error.message);
      setPriceItems(pli.data || []);
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
    const listId = String(fd.get("price_list_id") || "");
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
      // Mayorista: se asigna la lista al usuario recién creado (RLS: solo admin).
      let listError = null;
      if (listId && data?.id) {
        ({ error: listError } = await supabase.from("seller_price_lists").upsert({
          seller_id: data.id,
          price_list_id: listId,
          assigned_by: session.user.id,
          assigned_at: new Date().toISOString(),
        }));
      }
      if (listError)
        setError(
          "Usuario creado, pero no se pudo marcar como mayorista: " +
            listError.message +
            ". Asígnale la lista desde la tabla.",
        );
      else setNotice(listId ? "Usuario mayorista creado correctamente." : "Usuario creado correctamente.");
      form.reset();
      await reload();
    }
    setBusy(false);
  }
  // Contraseñas: la propia con la sesión; la de otro usuario vía Edge Function.
  async function changeOwnPassword(password) {
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return error.message;
    message(null, "Contraseña actualizada");
    return "";
  }
  async function adminSetPassword(user, password) {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-set-password", {
      body: { user_id: user.id, password },
    });
    setBusy(false);
    if (error || data?.error) {
      let detail = data?.error || "No se pudo cambiar la contraseña (¿está desplegada admin-set-password?).";
      if (error?.context) {
        try {
          const body = await error.context.json();
          detail = body.error || detail;
        } catch {}
      }
      return detail;
    }
    message(null, "Contraseña de " + (user.full_name || user.username) + " actualizada");
    return "";
  }
  // Mayoristas: guarda o quita la categoría de un cliente (solo admin, RLS).
  async function saveWholesaleTag(row, category, notes) {
    setBusy(true);
    const { data, error } = await supabase
      .from("wholesale_customers")
      .upsert({
        customer_key: row.key,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone || null,
        category,
        notes: notes.trim() || null,
        updated_by: session.user.id,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    setBusy(false);
    message(error, "Clasificación guardada");
    if (!error)
      setWholesaleTags((all) => [...all.filter((t) => t.customer_key !== data.customer_key), data]);
    return !error;
  }
  async function removeWholesaleTag(row) {
    setBusy(true);
    const { error } = await supabase.from("wholesale_customers").delete().eq("customer_key", row.key);
    setBusy(false);
    message(error, "Clasificación quitada");
    if (!error) setWholesaleTags((all) => all.filter((t) => t.customer_key !== row.key));
    return !error;
  }
  // Listas de precios mayoristas (fase 1): crear, renombrar/activar y asignar.
  async function createPriceList(name) {
    setBusy(true);
    const { data, error } = await supabase.from("price_lists").insert({ name }).select().single();
    setBusy(false);
    message(error?.code === "23505" ? { message: "Ya existe una lista con ese nombre" } : error, "Lista creada");
    if (!error) setPriceLists((all) => [...all, data].sort((a, b) => a.name.localeCompare(b.name, "es")));
    return !error;
  }
  async function updatePriceList(id, patch) {
    setBusy(true);
    const { data, error } = await supabase.from("price_lists").update(patch).eq("id", id).select().single();
    setBusy(false);
    message(error?.code === "23505" ? { message: "Ya existe una lista con ese nombre" } : error, "Lista actualizada");
    if (!error) setPriceLists((all) => all.map((l) => (l.id === id ? data : l)));
    return !error;
  }
  // Guarda precios de listas: upserts [{price_list_id, product_id, price}]
  // y borrados [{price_list_id, product_id}]. Solo admin (RLS).
  async function savePriceItems(upserts, deletes) {
    setBusy(true);
    let error = null;
    const stamp = { updated_by: session.user.id, updated_at: new Date().toISOString() };
    for (let i = 0; !error && i < upserts.length; i += 500) {
      ({ error } = await supabase
        .from("price_list_items")
        .upsert(upserts.slice(i, i + 500).map((x) => ({ ...x, ...stamp }))));
    }
    const byList = new Map();
    deletes.forEach((d) => byList.set(d.price_list_id, [...(byList.get(d.price_list_id) || []), d.product_id]));
    for (const [listId, ids] of byList) {
      if (error) break;
      ({ error } = await supabase.from("price_list_items").delete().eq("price_list_id", listId).in("product_id", ids));
    }
    const { data, error: e2 } = await supabase.from("price_list_items").select("price_list_id,product_id,price");
    if (!e2) setPriceItems(data || []);
    setBusy(false);
    message(
      error,
      `Precios guardados: ${upserts.length} actualizado${upserts.length === 1 ? "" : "s"}, ${deletes.length} quitado${deletes.length === 1 ? "" : "s"}`,
    );
    return !error;
  }
  async function assignPriceList(sellerId, listId) {
    setBusy(true);
    const q = listId
      ? supabase
          .from("seller_price_lists")
          .upsert({
            seller_id: sellerId,
            price_list_id: listId,
            assigned_by: session.user.id,
            assigned_at: new Date().toISOString(),
          })
          .select()
          .single()
      : supabase.from("seller_price_lists").delete().eq("seller_id", sellerId);
    const { data, error } = await q;
    setBusy(false);
    message(error, listId ? "Vendedor marcado como mayorista" : "El vendedor ya no es mayorista");
    if (!error)
      setSellerLists((all) => [...all.filter((x) => x.seller_id !== sellerId), ...(listId ? [data] : [])]);
    return !error;
  }
  // Devuelve el id del proveedor elegido; si se escribió uno nuevo, lo crea.
  // undefined = no se pudo crear (el error ya se mostró).
  async function resolveSupplier(id, newName) {
    const name = String(newName || "").trim();
    if (!name) return id || null;
    const { data, error } = await supabase
      .from("suppliers")
      .insert({ name })
      .select("id")
      .single();
    if (error) {
      message(error);
      return undefined;
    }
    return data.id;
  }
  async function createProduct(e) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    const f = new FormData(form);
    const supplierId = await resolveSupplier(f.get("supplier_id"), f.get("supplier_new"));
    if (supplierId === undefined) {
      setBusy(false);
      return false;
    }
    const { data: created, error } = await supabase
      .from("products")
      .insert({
        supplier_id: supplierId,
        name: f.get("name").trim(),
        sku: f.get("sku")?.trim() || null,
        category: f.get("category")?.trim() || null,
        price: f.get("price") === "" ? null : Number(f.get("price")),
        price_wholesale:
          f.get("price_wholesale") === "" ? null : Number(f.get("price_wholesale")),
        description: f.get("description") || null,
        image_url: f.get("image_url") || null,
      })
      .select("id,name")
      .single();
    const costIn = f.get("cost");
    if (!error) await saveCost(created.id, costIn == null || costIn === "" ? null : Number(costIn));
    message(error, "Producto registrado");
    if (!error) {
      form.reset();
      await reload();
    }
    setBusy(false);
    return error ? false : created;
  }
  async function createOrder(e, lines, wholesale, payment) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const sellerId = admin ? String(f.get("seller_id") || "") : "";
    const { data: newId, error } = await supabase.rpc("create_order", {
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
    // Admin: create_order siempre deja como vendedor a quien lo crea; si se
    // eligió otro vendedor, se reasigna (RLS "orders admin update").
    let assignError = null;
    if (!error && sellerId && sellerId !== session?.user?.id) {
      const { data: upd, error: e2 } = await supabase
        .from("orders")
        .update({ seller_id: sellerId })
        .eq("id", newId)
        .select("id");
      assignError = e2 || (!upd?.length && { message: "sin permiso para reasignar" });
      // Vendedor mayorista: se aplican los precios de su lista (reprice_order).
      if (!assignError && specialFor(sellerId)) {
        const { error: e3 } = await supabase.rpc("reprice_order", { p_order_id: newId });
        if (e3)
          assignError = {
            message: "asignado, pero no se aplicaron los precios de su lista (" + e3.message + "). Edita el pedido y usa «Recalcular precios»",
          };
      }
    }
    if (assignError)
      message({
        message: `Pedido creado a tu nombre, pero no se pudo asignar al vendedor: ${assignError.message}`,
      });
    else message(error, "Orden generada correctamente");
    if (!error) {
      setTab("orders");
      await reload();
    }
    setBusy(false);
  }
  // Admin: asigna varios pedidos a un vendedor. Devuelve true si todos cambiaron.
  async function assignSeller(orderIds, sellerId) {
    if (!orderIds.length || !sellerId) return false;
    setBusy(true);
    const { data, error } = await supabase
      .from("orders")
      .update({ seller_id: sellerId })
      .in("id", orderIds)
      .select("id");
    const done = data?.length || 0;
    if (error) message(error);
    else if (done < orderIds.length)
      message({ message: `Solo se reasignaron ${done} de ${orderIds.length} pedidos.` });
    else
      message(null, done === 1 ? "Pedido reasignado" : `${done} pedidos reasignados`);
    await reload();
    setBusy(false);
    return !error && done === orderIds.length;
  }
  async function createInvoice(orderId) {
    setBusy(true);
    const { data, error } = await supabase.rpc("create_invoice", { p_order_id: orderId });
    message(error, `Factura ${fmtInvoice(data)} generada`);
    if (!error) await reload();
    setBusy(false);
    return error ? null : data;
  }
  async function voidInvoice(invoiceId, reason) {
    const { error } = await supabase.rpc("void_invoice", {
      p_invoice_id: invoiceId,
      p_reason: reason,
    });
    message(error, "Factura anulada: el pedido vuelve a Por facturar");
    if (!error) await reload();
    return !error;
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
  // Registra un costo nuevo (fila de historial) si cambió. true = ok.
  async function saveCost(productId, cost) {
    if (cost == null || cost === costAt(costs, productId)) return true;
    const { error } = await supabase
      .from("product_costs")
      .insert({ product_id: productId, cost });
    if (error) message(error);
    return !error;
  }
  async function updateProduct(id, { supplier_new, cost, ...patch }) {
    if (!(await saveCost(id, cost))) return false;
    if ("supplier_id" in patch) {
      const supplierId = await resolveSupplier(patch.supplier_id, supplier_new);
      if (supplierId === undefined) return false;
      patch.supplier_id = supplierId;
    }
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
      setUploadingId(null);
      return true;
    } catch (err) {
      message({ message: err?.message || "No se pudo subir la foto." });
    }
    setUploadingId(null);
    return false;
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
  // Admin: usuarios activos que pueden figurar como vendedor de un pedido.
  const sellerRoleIds = new Set(
    roleCatalog
      .filter((r) => ["seller", "admin", "sales_production"].includes(r.code))
      .map((r) => r.id),
  );
  const sellerOptions = admin
    ? sellers.filter(
        (u) =>
          u.active &&
          assignments.some((a) => a.user_id === u.id && sellerRoleIds.has(a.role_id)),
      )
    : [];
  // Precio de lista de un vendedor: { name, prices } o null si no es mayorista.
  const specialFor = (sellerId) => {
    const a = sellerLists.find((x) => x.seller_id === sellerId);
    const l = a && priceLists.find((x) => x.id === a.price_list_id && x.active);
    if (!l) return null;
    return {
      name: l.name,
      prices: new Map(priceItems.filter((i) => i.price_list_id === l.id).map((i) => [i.product_id, i.price])),
    };
  };
  const priceCtx = { specialFor };
  const isWholesaleMe = !!specialFor(session?.user?.id);
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
    <PriceListCtx.Provider value={priceCtx}>
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
            // Vendedor mayorista: su estado de cuenta (lo que debe por sus pedidos).
            ...(!admin && isWholesaleMe ? [["account", Receipt, "Mi cuenta"]] : []),
            ...(canBill ? [["billing", Receipt, "Facturación"]] : []),
            ...(admin ? [["wholesalers", Store, "Mayoristas"]] : []),
            ["products", Package, "Productos"],
            ...(admin ? [["settlement", Calculator, "Liquidación"]] : []),
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
          type="button"
          className="logout pwbtn"
          aria-label="Cambiar mi contraseña"
          title={navCollapsed ? "Cambiar mi contraseña" : undefined}
          onClick={() => setPwTarget("self")}
        >
          <KeyRound size={17} aria-hidden="true" />
          <span className="navlabel">Mi contraseña</span>
        </button>
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
                  wholesalers: "Mayoristas",
                  settlement: "Liquidación de proveedores",
                  account: "Mi cuenta",
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
            <AdminDashboard orders={orders} zones={zones} counts={counts} />
          </>
        )}
        {tab === "production" && seesProduction && (
          <Production orders={activeOrders} onStatus={setItemStatus} />
        )}
        {tab === "orders" && (
          <OrdersBoard
            onNew={() => setTab("new")}
            orders={visibleOrders}
            busy={busy}
            sellerOptions={sellerOptions}
            onAssignSeller={assignSeller}
            canBill={canBill}
            admin={admin}
            userId={session?.user?.id}
            canSell={canSell}
            onEdit={updateOrder}
            onCancelOrder={cancelOrder}
            products={products}
            zones={zones}
            invoices={invoices}
          />
        )}
        {tab === "account" && !admin && isWholesaleMe && (
          <section className="panel wst-panel">
            <WholesaleStatement
              seller={profile}
              orders={orders}
              listName={specialFor(profile.id)?.name || ""}
              viewer="seller"
              showInvoices={false}
            />
          </section>
        )}
        {tab === "wholesalers" && admin && (
          <Wholesalers
            orders={activeOrders}
            tags={wholesaleTags}
            tagsError={wholesaleError}
            busy={busy}
            onSave={saveWholesaleTag}
            onRemove={removeWholesaleTag}
            sellers={sellerOptions}
            priceLists={priceLists}
            sellerLists={sellerLists}
            listsError={listsError}
            onCreateList={createPriceList}
            onUpdateList={updatePriceList}
            onAssign={assignPriceList}
            products={products}
            priceItems={priceItems}
            onSavePrices={savePriceItems}
            invoices={invoices}
          />
        )}
        {tab === "settlement" && admin && (
          <SupplierSettlement
            orders={orders}
            invoices={invoices}
            products={products}
            suppliers={suppliers}
            costs={costs}
          />
        )}
        {tab === "billing" && canBill && (
          <Billing
            orders={activeOrders}
            invoices={invoices}
            zones={zones}
            busy={busy}
            admin={admin}
            onCreate={createInvoice}
            onVoid={voidInvoice}
            canBill={canBill}
            canSell={canSell}
            userId={session?.user?.id}
            onEdit={updateOrder}
            onCancelOrder={cancelOrder}
            products={products}
          />
        )}
        {tab === "new" && canSell && (
          <OrderForm
            products={products.filter((p) => p.active)}
            zones={zones}
            busy={busy}
            sellerOptions={sellerOptions}
            meId={session?.user?.id}
            onSubmit={createOrder}
          />
        )}
        {tab === "products" && admin && editingProduct && (
          <ProductEditModal
            product={editingProduct}
            products={products}
            suppliers={suppliers}
            cost={costAt(costs, editingProduct.id)}
            onSave={updateProduct}
            onUpload={uploadProductPhoto}
            onClose={() => setEditingProduct(null)}
          />
        )}
        {tab === "products" && (
          <ProductsView
            products={products}
            suppliers={suppliers}
            costs={costs}
            admin={admin}
            busy={busy}
            uploadingId={uploadingId}
            sort={productSort}
            onSort={setProductSort}
            onCreate={createProduct}
            onEdit={setEditingProduct}
            onUpload={uploadProductPhoto}
            onToggle={changeProduct}
          />
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
              <label className="user-list">
                Lista mayorista
                <select name="price_list_id" defaultValue="" disabled={!!listsError}>
                  <option value="">No es mayorista</option>
                  {priceLists
                    .filter((l) => l.active)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
                <small className="omuted">
                  {listsError
                    ? "Las listas de precios no están disponibles (migración 20261127b)."
                    : priceLists.some((l) => l.active)
                      ? "Sus pedidos usarán esta lista cuando se carguen los precios (fase 2)."
                      : "Crea una lista en Mayoristas → Vendedores mayoristas."}
                </small>
              </label>
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
                  <th>Mayorista</th>
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
                    <td>
                      <select
                        className="user-list-pick"
                        aria-label={"Lista mayorista de " + s.full_name}
                        disabled={busy || !!listsError}
                        value={sellerLists.find((x) => x.seller_id === s.id)?.price_list_id || ""}
                        onChange={(e) => assignPriceList(s.id, e.target.value || null)}
                      >
                        <option value="">No es mayorista</option>
                        {priceLists
                          .filter(
                            (l) =>
                              l.active || sellerLists.some((x) => x.seller_id === s.id && x.price_list_id === l.id),
                          )
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                              {!l.active ? " (inactiva)" : ""}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td>{s.active ? "Activo" : "Inactivo"}</td>
                    <td className="user-actions">
                      {s.id !== profile.id && (
                        <button
                          type="button"
                          className="iconbtn"
                          disabled={busy}
                          aria-label={"Cambiar contraseña de " + s.full_name}
                          title="Cambiar contraseña"
                          onClick={() => setPwTarget(s)}
                        >
                          <KeyRound size={17} aria-hidden="true" />
                        </button>
                      )}
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
      {pwTarget && (
        <PasswordModal
          key={pwTarget === "self" ? "self" : pwTarget.id}
          title={
            pwTarget === "self"
              ? "Cambiar mi contraseña"
              : "Cambiar contraseña · " + (pwTarget.full_name || pwTarget.username)
          }
          intro={
            pwTarget === "self"
              ? "La nueva contraseña se usa desde el próximo inicio de sesión."
              : "El usuario entrará con esta contraseña la próxima vez que inicie sesión. Compártela por un medio seguro."
          }
          busy={busy}
          onClose={() => setPwTarget(null)}
          onSubmit={async (pw) => {
            const err = pwTarget === "self" ? await changeOwnPassword(pw) : await adminSetPassword(pwTarget, pw);
            if (!err) setPwTarget(null);
            return err;
          }}
        />
      )}
    </div>
    </PriceListCtx.Provider>
  );
}
// Ventana para fijar una contraseña nueva (propia o de otro usuario).
// onSubmit devuelve "" si salió bien o el texto del error.
function PasswordModal({ title, intro, busy, onClose, onSubmit }) {
  const [pw, setPw] = useState(""),
    [pw2, setPw2] = useState(""),
    [show, setShow] = useState(false),
    [err, setErr] = useState("");
  const tooShort = pw.length > 0 && pw.length < 10;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const ok = pw.length >= 10 && pw.length <= 128 && pw === pw2;
  const submit = async (e) => {
    e.preventDefault();
    if (!ok) return;
    setErr("");
    setErr(await onSubmit(pw));
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="pwform" disabled={busy || !ok}>
            {busy && <Loader2 size={16} className="spin" aria-hidden="true" />} Guardar contraseña
          </button>
        </>
      }
    >
      <form id="pwform" className="pwform" onSubmit={submit}>
        <p className="omuted">{intro}</p>
        <label>
          Contraseña nueva
          <input
            type={show ? "text" : "password"}
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            aria-invalid={tooShort}
            aria-describedby="pw-help"
            required
          />
        </label>
        <small id="pw-help" className={tooShort ? "pw-bad" : "omuted"}>
          Mínimo 10 caracteres.
        </small>
        <label>
          Repite la contraseña
          <input
            type={show ? "text" : "password"}
            autoComplete="new-password"
            maxLength={128}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            aria-invalid={mismatch}
            aria-describedby={mismatch ? "pw-mismatch" : undefined}
            required
          />
        </label>
        {mismatch && (
          <small id="pw-mismatch" className="pw-bad">
            Las contraseñas no coinciden.
          </small>
        )}
        <label className="pw-show">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Mostrar contraseña
        </label>
        {err && (
          <div className="alert error" role="alert">
            {err}
          </div>
        )}
      </form>
    </Modal>
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
function ProductCatalog({ products, inCart, onAdd, titleId, title = "Catálogo", special = null, readOnly = false }) {
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
                        {special?.prices.has(p.id) ? (
                          <>
                            <strong>{fmtMoney(special.prices.get(p.id))}</strong>
                            <small>
                              <s className="price-was">{fmtMoney(p.price)}</s> · {special.name}
                            </small>
                          </>
                        ) : (
                          <>
                        <strong>{fmtMoney(tierPrice(p, n))}</strong>
                        {p.price_wholesale != null && (
                          <small>
                            {n >= WHOLESALE_MIN_UNITS
                              ? "Mayorista · general " + fmtMoney(p.price)
                              : "Mayorista " + fmtMoney(p.price_wholesale) + " desde " + WHOLESALE_MIN_UNITS + " u."}
                          </small>
                        )}
                          </>
                        )}
                      </div>
                      {!readOnly && (
                      <button
                        type="button"
                        className="compact"
                        onClick={() => onAdd(p)}
                        aria-label={`Agregar ${p.name}`}
                      >
                        <Plus size={16} aria-hidden="true" /> Agregar
                      </button>
                      )}
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
function OrderForm({ products, zones = [], busy, sellerOptions = [], meId, onSubmit }) {
  const [lines, setLines] = useState([]);
  // Vendedor del pedido (admin puede elegir otro): define la lista de precios.
  const [sellerId, setSellerId] = useState(meId || "");
  const special = React.useContext(PriceListCtx).specialFor(sellerOptions.length ? sellerId : meId);
  const [zone, setZone] = useState("");
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
  // Mayorista por referencia: cuenta las unidades de cada producto.
  // Lista del vendedor: precio especial desde 1 unidad (linePrice).
  const unitPrice = (p) => (p ? linePrice(p, inCart(p.id), special).unit : null);
  const listOf = (p) => (p ? linePrice(p, inCart(p.id), special).list : null);
  const onList = (p) => !!p && !!special?.prices.has(p.id);
  const isWholesale = (p) => !!p && !onList(p) && p.price_wholesale != null && inCart(p.id) >= WHOLESALE_MIN_UNITS;
  const wholesale = lines.some((l) => isWholesale(byId.get(l.product_id)) || onList(byId.get(l.product_id)));
  const listCount = lines.filter((l) => onList(byId.get(l.product_id))).length;
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
          special={special}
          products={products}
          inCart={inCart}
          onAdd={add}
          titleId="catalog-title"
        />
      </section>

      <div className="orderside" id="order-side">
        <section className="panel" aria-labelledby="customer-title">
          <h2 id="customer-title">Datos del cliente</h2>
          <div className="stackfields">
            {sellerOptions.length > 0 && (
              <label>
                Vendedor
                <select name="seller_id" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
                  {sellerOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name || u.username || "Sin nombre"}
                      {u.id === meId ? " (yo)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
                          <PriceTag unit={unitPrice(p)} list={listOf(p)} /> c/u
                          {qty > 1 && unitPrice(p) != null && (
                            <> · {fmtMoney(unitPrice(p) * qty)}</>
                          )}
                          {onList(p) && <> · <span className="tag-wholesale">{special.name}</span></>}
                          {isWholesale(p) && <> · <span className="tag-wholesale">Mayorista</span></>}
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
            {special ? (
              <p className={"wholesale-note" + (listCount ? " on" : "")}>
                <b>Lista de precios · {special.name}</b>
                <small>
                  Precio especial desde 1 unidad en los productos de la lista; el resto sigue la regla
                  mayorista desde {WHOLESALE_MIN_UNITS} unidades.
                </small>
              </p>
            ) : (
              <p className={"wholesale-note" + (wholesale ? " on" : "")}>
                <b>Precio mayorista por referencia</b>
                <small>
                  Se aplica a cada producto desde {WHOLESALE_MIN_UNITS} unidades del mismo producto.
                </small>
              </p>
            )}
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
              {listCount
                ? "Incluye precios de la lista " + special.name + "."
                : wholesale
                  ? "Incluye precio mayorista en las referencias con " + WHOLESALE_MIN_UNITS + "+ unidades."
                  : "Calculado con el precio general."}
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
function OrderEditForm({ order, products = [], zones = [], invoiced = false, canBill, admin = false, onSave, onCancel }) {
  const byId = new Map(products.map((p) => [p.id, p]));
  // Lista de precios del vendedor del pedido (la misma que usa update_order).
  const special = React.useContext(PriceListCtx).specialFor(order.seller_id);
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
    list_price: i.list_price ?? null,
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
          list_price: null,
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
  const itemsChanged =
    items.length !== original.length ||
    items.some((x) => {
      const o = original.find((y) => y.id && y.id === x.id);
      return !o || Number(o.quantity) !== Number(x.quantity) || o.notes.trim() !== x.notes.trim();
    });
  // "Recalcular precios" (solo Administrador): fuerza a enviar los productos
  // para que update_order recalcule las líneas pendientes con el precio actual
  // del catálogo. No guarda nada hasta pulsar "Guardar cambios".
  const [repricing, setRepricing] = useState(false);
  const itemsDirty = itemsChanged || repricing;
  // Mismo criterio que update_order: al enviar productos, cada línea pendiente
  // toma el precio de su referencia (12+ unidades del producto = mayorista).
  // Las líneas en producción o finalizadas conservan su precio guardado.
  const priceOf = (x) => {
    const p = byId.get(x.product_id);
    const pending = !x.id || x.status === "pending";
    if (!itemsDirty || !pending || !p) return x.unit_price ?? (p ? p.price : 0);
    return linePrice(p, countOf(x.product_id), special).unit;
  };
  const listOf = (x) => {
    const p = byId.get(x.product_id);
    const pending = !x.id || x.status === "pending";
    if (!itemsDirty || !pending || !p) return x.list_price ?? null;
    return linePrice(p, countOf(x.product_id), special).list;
  };
  // Líneas pendientes guardadas cuyo precio ya no coincide con el catálogo.
  const staleItems = items.filter((x) => {
    const p = byId.get(x.product_id);
    return x.id && x.status === "pending" && p && x.unit_price !== linePrice(p, countOf(x.product_id), special).unit;
  });
  const canReprice = admin && !invoiced && !order.cancelled_at;
  const wholesaleOf = (x) => {
    const p = byId.get(x.product_id);
    return !!p && listOf(x) == null && p.price_wholesale != null && priceOf(x) === p.price_wholesale && countOf(x.product_id) >= WHOLESALE_MIN_UNITS;
  };
  const wholesaleNow = items.some((x) => wholesaleOf(x) || listOf(x) != null);
  const total =
    items.reduce((s, x) => s + (priceOf(x) || 0) * (Number(x.quantity) || 0), 0) + fee;
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
  const overpaid = !canBill && (itemsDirty || zoneChanged) && paidNow > total;
  // Al recalcular, si el pedido estaba pagado completo y el total sube, el pago
  // pasa a parcial con lo ya abonado (no se inventa un pago nuevo).
  useEffect(() => {
    if (!repricing || order.payment_status !== "paid") return;
    if (total > paidNow) {
      setStatus("partial");
      setAmount(String(paidNow));
    } else {
      setStatus("paid");
      setAmount("");
    }
  }, [repricing, total]);
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
      ...(itemsDirty && {
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
                    <PriceTag unit={priceOf(x)} list={listOf(x)} /> c/u
                    {qty > 1 && <> · {fmtMoney(priceOf(x) * qty)}</>}
                    {!x.id && <> · nuevo</>}
                    {listOf(x) != null && <> · <span className="tag-wholesale">{special?.name || "Lista"}</span></>}
                    {wholesaleOf(x) && <> · <span className="tag-wholesale">Mayorista</span></>}
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
              special={special}
              products={addable}
              inCart={countOf}
              onAdd={addFromCatalog}
              titleId={`catalog-${order.id}`}
              title="Catálogo"
            />
          </Modal>
        )}
        {canReprice && (
          <div className={"reprice" + (repricing ? " on" : "")}>
            <span>
              {repricing ? (
                <>
                  <b>Precios recalculados</b>
                  <small>
                    Los productos pendientes usan el precio actual del catálogo. Se guarda al pulsar
                    «Guardar cambios».
                  </small>
                </>
              ) : staleItems.length ? (
                <>
                  <b>
                    {staleItems.length === 1
                      ? "1 producto pendiente tiene un precio distinto al del catálogo"
                      : staleItems.length + " productos pendientes tienen un precio distinto al del catálogo"}
                  </b>
                  <small>Los productos en producción o finalizados conservan su precio.</small>
                </>
              ) : (
                <>
                  <b>Precios al día</b>
                  <small>Los productos pendientes ya tienen el precio del catálogo.</small>
                </>
              )}
            </span>
            {repricing ? (
              <button type="button" className="secondary compact" onClick={() => setRepricing(false)}>
                <X size={15} aria-hidden="true" /> Deshacer
              </button>
            ) : (
              <button
                type="button"
                className="secondary compact"
                disabled={!staleItems.length}
                onClick={() => setRepricing(true)}
              >
                <RefreshCw size={15} aria-hidden="true" /> Recalcular precios
              </button>
            )}
          </div>
        )}
        <div className="edititem-total">
          <span>
            Nuevo total{wholesaleNow ? " (precio mayorista)" : ""}
            {fee > 0 && <small> · incluye domicilio {fmtMoney(fee)}</small>}
          </span>
          <b>{fmtMoney(total)}</b>
        </div>
        <p className="fieldhelp">
          Precio mayorista por referencia: desde {WHOLESALE_MIN_UNITS} unidades del
          mismo producto. Al guardar se recalculan solo los productos pendientes.
        </p>
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
// Controles de página: Anterior · Página x de y · Siguiente.
function Pager({ page, pages, total, pageSize, onPage }) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav className="pager" aria-label="Paginación de pedidos">
      <span className="pager-info">
        {from}–{to} de {total} pedidos
      </span>
      <span className="pager-ctrl">
        <button
          type="button"
          className="secondary compact"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={15} aria-hidden="true" /> Anterior
        </button>
        <span className="pager-page" aria-live="polite">
          Página {page} de {pages}
        </span>
        <button
          type="button"
          className="secondary compact"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Siguiente <ChevronRight size={15} aria-hidden="true" />
        </button>
      </span>
    </nav>
  );
}
// ---------------------------------------------------------------------
// Dashboard del Resumen (solo admin). Todo se calcula en el navegador con
// los pedidos ya cargados; no hay consultas nuevas.
// ---------------------------------------------------------------------
// Fecha local AAAA-MM-DD (en-CA da ese formato).
const dayKey = (d) => new Date(d).toLocaleDateString("en-CA");
// Lo cobrado de un pedido: completo = total; parcial = lo abonado; pendiente = 0.
const orderPaid = (o) => {
  const total = orderGrandTotal(o);
  if (o.payment_status === "paid") return total;
  if (o.payment_status === "partial") return Math.min(o.amount_paid || 0, total);
  return 0;
};
const PERIODS = [
  ["month", "Este mes"],
  ["30d", "Últimos 30 días"],
  ["all", "Todo"],
];
function AdminDashboard({ orders, zones = [], counts }) {
  const [period, setPeriod] = useState("month");
  const now = new Date();
  const start =
    period === "month"
      ? new Date(now.getFullYear(), now.getMonth(), 1)
      : period === "30d"
        ? new Date(now.getTime() - 30 * 86400000)
        : null;
  const inPeriod = orders.filter((o) => !start || new Date(o.created_at) >= start);
  const active = inPeriod.filter((o) => !o.cancelled_at);
  const cancelled = inPeriod.length - active.length;
  const sales = active.reduce((s, o) => s + orderGrandTotal(o), 0);
  const collected = active.reduce((s, o) => s + orderPaid(o), 0);
  const avg = active.length ? Math.round(sales / active.length) : 0;

  // Ventas de los últimos 14 días (pedidos no cancelados, sin importar el periodo).
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({ key: dayKey(d), date: d, total: 0, count: 0 });
  }
  const byDay = new Map(days.map((d) => [d.key, d]));
  orders.forEach((o) => {
    if (o.cancelled_at) return;
    const d = byDay.get(dayKey(o.created_at));
    if (d) {
      d.total += orderGrandTotal(o);
      d.count++;
    }
  });
  const maxDay = Math.max(1, ...days.map((d) => d.total));

  // Top productos, vendedores y municipios (periodo elegido).
  const prod = new Map();
  const sellers = new Map();
  const zonesAgg = new Map();
  const zoneName = new Map(zones.map((z) => [z.code, z.name]));
  active.forEach((o) => {
    (o.order_items || []).forEach((i) => {
      const name = i.products?.name || "Producto";
      const e = prod.get(name) || { name, units: 0 };
      e.units += i.quantity;
      prod.set(name, e);
    });
    const sName = o.seller_name || "Sin vendedor";
    const se = sellers.get(sName) || { name: sName, amount: 0, count: 0 };
    se.amount += orderGrandTotal(o);
    se.count++;
    sellers.set(sName, se);
    const zName = o.delivery_zone ? zoneName.get(o.delivery_zone) || o.delivery_zone : "Sin municipio";
    const ze = zonesAgg.get(zName) || { name: zName, count: 0, fees: 0 };
    ze.count++;
    ze.fees += o.delivery_fee || 0;
    zonesAgg.set(zName, ze);
  });
  const topProducts = [...prod.values()].sort((a, b) => b.units - a.units).slice(0, 5);
  const maxUnits = Math.max(1, ...topProducts.map((p) => p.units));
  const sellerList = [...sellers.values()].sort((a, b) => b.amount - a.amount);
  const maxSeller = Math.max(1, ...sellerList.map((x) => x.amount));
  const zoneList = [...zonesAgg.values()].sort((a, b) => b.count - a.count);

  // Producción actual (todos los pedidos activos).
  const prodTotal = counts.pending + counts.in_progress + counts.finished;
  const pct = (n) => (prodTotal ? (n / prodTotal) * 100 : 0);

  // Entregas de hoy a 7 días.
  const today = dayKey(now);
  const limit = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const upcoming = orders
    .filter((o) => !o.cancelled_at && o.delivery_date && o.delivery_date >= today && o.delivery_date <= limit)
    .sort((a, b) =>
      (a.delivery_date + (a.delivery_time || "")).localeCompare(b.delivery_date + (b.delivery_time || "")),
    )
    .slice(0, 8);

  const kpis = [
    ["Ventas", fmtMoney(sales), "brand"],
    ["Cobrado", fmtMoney(collected), "success"],
    ["Por cobrar", fmtMoney(Math.max(sales - collected, 0)), "warning"],
    ["Ticket promedio", fmtMoney(avg), "info"],
    ["Pedidos", active.length, "brand"],
    ["Cancelados", cancelled, "danger"],
  ];

  return (
    <section className="dash" aria-label="Dashboard">
      <div className="dash-head">
        <h2>Indicadores</h2>
        <div className="seg" role="group" aria-label="Periodo">
          {PERIODS.map(([v, l]) => (
            <button
              key={v}
              type="button"
              className={period === v ? "is-active" : ""}
              aria-pressed={period === v}
              onClick={() => setPeriod(v)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="kpis">
        {kpis.map(([label, value, tone]) => (
          <div className={"kpi tone-" + tone} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        <div className="panel dash-card span2">
          <h3>Ventas por día · últimos 14 días</h3>
          <div className="daybars" role="img" aria-label="Ventas por día de los últimos 14 días">
            {days.map((d) => (
              <div
                className="daybar"
                key={d.key}
                title={d.date.toLocaleDateString("es-CO") + ": " + fmtMoney(d.total) + " · " + d.count + " pedido(s)"}
              >
                <div className="daybar-track">
                  <div className="daybar-fill" style={{ height: (d.total / maxDay) * 100 + "%" }} />
                </div>
                <small>{d.date.getDate()}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="panel dash-card">
          <h3>Producción actual</h3>
          <div
            className="stackbar"
            role="img"
            aria-label={"Pendiente " + counts.pending + ", en proceso " + counts.in_progress + ", finalizado " + counts.finished}
          >
            <span className="st-pending" style={{ width: pct(counts.pending) + "%" }} />
            <span className="st-progress" style={{ width: pct(counts.in_progress) + "%" }} />
            <span className="st-finished" style={{ width: pct(counts.finished) + "%" }} />
          </div>
          <ul className="legend">
            <li><i className="st-pending" /> Pendiente <b>{counts.pending}</b></li>
            <li><i className="st-progress" /> En proceso <b>{counts.in_progress}</b></li>
            <li><i className="st-finished" /> Finalizado <b>{counts.finished}</b></li>
          </ul>
          <p className="fieldhelp">Productos de todos los pedidos activos.</p>
        </div>

        <div className="panel dash-card">
          <h3>Top 5 productos</h3>
          {!topProducts.length && <p className="fieldhelp">Sin ventas en el periodo.</p>}
          <ul className="hbars">
            {topProducts.map((p) => (
              <li key={p.name}>
                <div className="hb-label">
                  <span>{p.name}</span>
                  <b>{p.units} u.</b>
                </div>
                <div className="hb-track"><div className="hb-fill" style={{ width: (p.units / maxUnits) * 100 + "%" }} /></div>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel dash-card">
          <h3>Ventas por vendedor</h3>
          {!sellerList.length && <p className="fieldhelp">Sin ventas en el periodo.</p>}
          <ul className="hbars">
            {sellerList.map((x) => (
              <li key={x.name}>
                <div className="hb-label">
                  <span>{x.name} · {x.count} ped.</span>
                  <b>{fmtMoney(x.amount)}</b>
                </div>
                <div className="hb-track"><div className="hb-fill alt" style={{ width: (x.amount / maxSeller) * 100 + "%" }} /></div>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel dash-card">
          <h3>Entregas próximas · 7 días</h3>
          {!upcoming.length && <p className="fieldhelp">No hay entregas programadas.</p>}
          <ul className="upcoming">
            {upcoming.map((o) => {
              const items = o.order_items || [];
              const done = items.filter((i) => i.status === "finished").length;
              return (
                <li key={o.id}>
                  <span className="up-date">
                    {o.delivery_date === today ? "Hoy" : fmtDate(o.delivery_date)}
                    {o.delivery_time && <small>{fmtTime(o.delivery_time)}</small>}
                  </span>
                  <span className="up-main">
                    <b>#{o.order_number}</b> {o.customer_name}
                  </span>
                  <span className={"up-pill" + (items.length && done === items.length ? " ok" : "")}>
                    {done}/{items.length} listos
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="panel dash-card">
          <h3>Pedidos por municipio</h3>
          {!zoneList.length && <p className="fieldhelp">Sin pedidos en el periodo.</p>}
          {!!zoneList.length && (
            <table className="mini">
              <thead>
                <tr><th>Municipio</th><th className="num">Pedidos</th><th className="num">Domicilios</th></tr>
              </thead>
              <tbody>
                {zoneList.map((z) => (
                  <tr key={z.name}><td>{z.name}</td><td className="num">{z.count}</td><td className="num">{fmtMoney(z.fees)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
// Debe coincidir con update_order (SQL).
const orderCanEdit = (o, { canBill, canSell, userId }) =>
  !o.cancelled_at && (canBill || (canSell && o.seller_id === userId));
// Debe coincidir con cancel_order (SQL): admin y Facturación siempre; el
// vendedor dueño solo si todo sigue pendiente. Un pedido facturado no se cancela aquí.
const orderCanCancel = (o, { canBill, canSell, userId, invoiced }) =>
  !o.cancelled_at &&
  !invoiced &&
  (canBill ||
    (canSell &&
      o.seller_id === userId &&
      (o.order_items || []).every((i) => i.status === "pending")));
function Orders({ orders, busy, canBill, admin = false, userId, canSell, onEdit, onCancelOrder, products = [], zones = [], invoices = [], pageSize = 0, sellerOptions = [], onAssignSeller, bare = false }) {
  const [filter, setFilterState] = useState("all");
  // Admin: selección para asignar vendedor en bloque.
  const bulk = admin && !!onAssignSeller && sellerOptions.length > 0;
  const [picked, setPicked] = useState(() => new Set());
  const [bulkSeller, setBulkSeller] = useState("");
  const togglePick = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  async function applyBulk() {
    const ok = await onAssignSeller([...picked], bulkSeller);
    if (ok) setPicked(new Set());
  }
  const [page, setPage] = useState(1);
  // Al cambiar el filtro se vuelve a la primera página.
  const setFilter = (v) => {
    setFilterState(v);
    setPage(1);
  };
  const [cancellingId, setCancellingId] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const zoneName = new Map(zones.map((z) => [z.code, z.name]));
  // Solo cuenta la factura activa (las anuladas no bloquean el pedido).
  const invoiceOf = new Map(invoices.filter((x) => !x.voided_at).map((x) => [x.order_id, x]));
  const canEdit = (o) => orderCanEdit(o, { canBill, canSell, userId });
  const canCancel = (o) =>
    !!onCancelOrder &&
    orderCanCancel(o, { canBill, canSell, userId, invoiced: invoiceOf.has(o.id) });
  const filtered = orders.filter((o) =>
    filter === "all"
      ? true
      : filter === "cancelled"
        ? !!o.cancelled_at
        : !o.cancelled_at && o.order_items?.some((i) => i.status === filter),
  );
  const cancelling = orders.find((o) => o.id === cancellingId);
  // Paginación opcional (pageSize = 0 muestra todo).
  const pages = pageSize ? Math.max(1, Math.ceil(filtered.length / pageSize)) : 1;
  const current = Math.min(page, pages);
  const shown = pageSize
    ? filtered.slice((current - 1) * pageSize, current * pageSize)
    : filtered;
  const pager =
    pageSize && filtered.length > pageSize ? (
      <Pager
        page={current}
        pages={pages}
        total={filtered.length}
        pageSize={pageSize}
        onPage={setPage}
      />
    ) : null;
  return (
    <>
      {!bare && (
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
      )}
      {!bare && !filtered.length && (
        <div className="panel">
          {canSell && !orders.length ? "Aún no has generado pedidos." : "No hay pedidos para mostrar."}
        </div>
      )}
      {!bare && bulk && filtered.length > 0 && (
        <div className="panel bulkbar" role="group" aria-label="Asignar vendedor a varios pedidos">
          <label className="bulk-all">
            <input
              type="checkbox"
              checked={shown.length > 0 && shown.every((o) => picked.has(o.id))}
              onChange={(e) =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  shown.forEach((o) => (e.target.checked ? next.add(o.id) : next.delete(o.id)));
                  return next;
                })
              }
            />
            Seleccionar los de esta página
          </label>
          <span className="bulk-count" aria-live="polite">
            {picked.size} {picked.size === 1 ? "seleccionado" : "seleccionados"}
          </span>
          <select
            value={bulkSeller}
            onChange={(e) => setBulkSeller(e.target.value)}
            aria-label="Vendedor al que se asignan los pedidos"
          >
            <option value="">Asignar a…</option>
            {sellerOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.username || "Sin nombre"}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="compact"
            disabled={busy || !picked.size || !bulkSeller}
            onClick={applyBulk}
          >
            <UserRound size={15} aria-hidden="true" /> Asignar vendedor
          </button>
          {picked.size > 0 && (
            <button type="button" className="linkbtn" disabled={busy} onClick={() => setPicked(new Set())}>
              Quitar selección
            </button>
          )}
        </div>
      )}
      {pager}
      {shown.map((o) => (
        <article
          className={"panel order" + (o.cancelled_at ? " cancelled" : "") + (picked.has(o.id) ? " picked" : "")}
          key={o.id}
        >
          <div className="orderhead">
            <div>
              <h2>
                {!bare && bulk && (
                  <input
                    type="checkbox"
                    className="orderpick"
                    checked={picked.has(o.id)}
                    onChange={() => togglePick(o.id)}
                    aria-label={`Seleccionar pedido #${o.order_number}`}
                  />
                )}
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
              admin={admin}
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
                    <td className="num">
                      <PriceTag unit={i.unit_price} list={i.list_price} />
                    </td>
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
      {pager}
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
// Paginación numerada (1 … 4 5 6 … 15).
function PageNav({ page, pages, onPage, label = "Paginación" }) {
  return (
    <nav className="plist-pages" aria-label={label}>
      <button type="button" className="pagebtn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      {Array.from({ length: pages }, (_, i) => i + 1)
        .filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1)
        .map((n, i, arr) => (
          <React.Fragment key={n}>
            {i > 0 && n - arr[i - 1] > 1 && <span className="pagegap">…</span>}
            <button
              type="button"
              className={"pagebtn" + (n === page ? " on" : "")}
              aria-current={n === page ? "page" : undefined}
              onClick={() => onPage(n)}
            >
              {n}
            </button>
          </React.Fragment>
        ))}
      <button type="button" className="pagebtn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Página siguiente">
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </nav>
  );
}
const STAGE_LABEL = {
  pending: "Pendiente",
  in_progress: "En producción",
  finished: "Finalizado",
  cancelled: "Cancelado",
};
const csvCell = (v) => {
  const t = v == null ? "" : String(v);
  return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
// ---------------------------------------------------------------------
// Pedidos: tarjetas (clic = filtro), accesos rápidos, buscador, filtros,
// tabla paginada, panel de detalle rápido y ventana con el pedido completo
// (reutiliza Orders en modo "bare": editar, cancelar, pagos, fotos).
// ---------------------------------------------------------------------
function OrdersBoard({
  orders,
  busy,
  canBill,
  admin = false,
  userId,
  canSell,
  onEdit,
  onCancelOrder,
  onNew,
  products = [],
  zones = [],
  invoices = [],
  sellerOptions = [],
  onAssignSeller,
}) {
  const today = new Date().toLocaleDateString("en-CA");
  const plusDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString("en-CA");
  };
  const empty = { stage: "", seller: "", created: "", delivery: "", zone: "", method: "" };
  const [quick, setQuick] = useState("all");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(empty);
  const [sort, setSort] = useState({ key: null, dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [full, setFull] = useState(null); // { id, action }
  const [picked, setPicked] = useState(() => new Set());
  const [bulkSeller, setBulkSeller] = useState("");
  const bulk = admin && !!onAssignSeller && sellerOptions.length > 0;
  const zoneName = new Map(zones.map((z) => [z.code, z.name]));
  const invoiceOf = new Map(invoices.filter((x) => !x.voided_at).map((x) => [x.order_id, x]));
  const perms = { canBill, canSell, userId };
  const rows = orders.map((o) => ({
    ...o,
    stage: o.cancelled_at ? "cancelled" : orderStage(o),
    total: orderGrandTotal(o),
    invoice: invoiceOf.get(o.id) || null,
    city: o.delivery_zone ? zoneName.get(o.delivery_zone) || o.delivery_zone : "",
    createdDay: new Date(o.created_at).toLocaleDateString("en-CA"),
  }));
  const live = rows.filter((r) => r.stage !== "cancelled");
  // Tarjetas
  const monthKey = today.slice(0, 7);
  const prev = new Date();
  prev.setDate(1);
  prev.setMonth(prev.getMonth() - 1);
  const prevKey = prev.toLocaleDateString("en-CA").slice(0, 7);
  const thisMonth = live.filter((r) => r.createdDay.startsWith(monthKey)).length;
  const lastMonth = live.filter((r) => r.createdDay.startsWith(prevKey)).length;
  const trend = lastMonth ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;
  const QUICK = {
    all: () => true,
    today: (r) => r.createdDay === today,
    pending: (r) => r.stage === "pending",
    in_progress: (r) => r.stage === "in_progress",
    finished: (r) => r.stage === "finished",
    unpaid: (r) => r.stage !== "cancelled" && r.payment_status !== "paid",
    invoiced: (r) => !!r.invoice,
    upcoming: (r) =>
      r.stage !== "cancelled" &&
      r.stage !== "finished" &&
      !!r.delivery_date &&
      r.delivery_date >= today &&
      r.delivery_date <= plusDays(7),
  };
  const count = (k) => rows.filter(QUICK[k]).length;
  const kpis = [
    ["all", "Total pedidos", Package, "tone-brand", live.length],
    ["pending", "Pendientes", Clock, "tone-warning", count("pending")],
    ["in_progress", "En producción", Settings, "tone-info", count("in_progress")],
    ["finished", "Finalizados", CheckCircle2, "tone-success", count("finished")],
    ["unpaid", "Pago pendiente", CreditCard, "tone-danger", count("unpaid")],
  ];
  const chips = [
    ["all", "Todos", null, rows.length],
    ["today", "Hoy", CalendarDays, count("today")],
    ["pending", "Pendientes", null, count("pending")],
    ["invoiced", "Facturados", Receipt, count("invoiced")],
    ["upcoming", "Entregas próximas", Truck, count("upcoming")],
  ];
  // Filtros
  const q = query.trim().toLowerCase();
  const fx = filters;
  const sellersInList = [...new Map(rows.map((r) => [r.seller_id, r.seller_name || "—"])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1], "es"),
  );
  const filtered = rows.filter(
    (r) =>
      QUICK[quick](r) &&
      (!q ||
        String(r.order_number).includes(q.replace("#", "")) ||
        (r.customer_name || "").toLowerCase().includes(q) ||
        (r.customer_phone || "").includes(q) ||
        (r.delivery_address || "").toLowerCase().includes(q) ||
        (r.invoice && fmtInvoice(r.invoice.invoice_number).toLowerCase().includes(q))) &&
      (!fx.stage || r.stage === fx.stage) &&
      (!fx.seller || r.seller_id === fx.seller) &&
      (!fx.created ||
        (fx.created === "today" && r.createdDay === today) ||
        (fx.created === "7d" && r.createdDay >= plusDays(-6)) ||
        (fx.created === "month" && r.createdDay.startsWith(monthKey))) &&
      (!fx.delivery ||
        (fx.delivery === "next7" && !!r.delivery_date && r.delivery_date >= today && r.delivery_date <= plusDays(7)) ||
        (fx.delivery === "overdue" && !!r.delivery_date && r.delivery_date < today && r.stage !== "finished" && r.stage !== "cancelled") ||
        (fx.delivery === "none" && !r.delivery_date)) &&
      (!fx.zone || (fx.zone === "__none" ? !r.delivery_zone : r.delivery_zone === fx.zone)) &&
      (!fx.method || (fx.method === "__none" ? !r.payment_method : r.payment_method === fx.method)),
  );
  const sorted = sort.key ? sortRows(filtered, sort) : [...filtered].sort((a, b) => b.order_number - a.order_number);
  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const from = total ? (current - 1) * pageSize + 1 : 0;
  const to = Math.min(current * pageSize, total);
  const visible = sorted.slice(from ? from - 1 : 0, to);
  useEffect(() => setPage(1), [quick, query, filters, pageSize]);
  const setF = (k, v) => setFilters((p) => ({ ...p, [k]: v }));
  const dirty = quick !== "all" || q || Object.values(fx).some(Boolean) || sort.key;
  function clearAll() {
    setQuick("all");
    setQuery("");
    setFilters(empty);
    setSort({ key: null, dir: "asc" });
  }
  function exportCsv() {
    const head = ["Pedido", "Factura", "Cliente", "Teléfono", "Vendedor", "Creado", "Entrega", "Ciudad", "Dirección", "Total", "Pago", "Medio de pago", "Estado"];
    const lines = sorted.map((r) =>
      [
        r.order_number,
        r.invoice ? fmtInvoice(r.invoice.invoice_number) : "",
        r.customer_name,
        r.customer_phone,
        r.seller_name,
        r.createdDay,
        r.delivery_date,
        r.city,
        r.delivery_address,
        r.total,
        PAYMENT_STATUS[r.payment_status] || PAYMENT_STATUS.pending,
        PAYMENT_METHOD[r.payment_method] || "",
        STAGE_LABEL[r.stage],
      ]
        .map(csvCell)
        .join(";"),
    );
    const blob = new Blob(["\ufeff" + [head.join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pedidos-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function applyBulk() {
    const ok = await onAssignSeller([...picked], bulkSeller);
    if (ok) setPicked(new Set());
  }
  const fullOrder = full && orders.find((o) => o.id === full.id);
  const columns = [
    ["order_number", "Pedido"],
    ["customer_name", "Cliente"],
    ["seller_name", "Vendedor"],
    ["delivery_date", "Fecha entrega"],
    ["city", "Ciudad"],
    ["total", "Total", "num"],
  ];
  const colCount = columns.length + 3 + (bulk ? 1 : 0);
  return (
    <div className="oboard">
      <div className="oboard-main">
        <div className="okpis">
          {kpis.map(([k, label, Icon, tone, n]) => (
            <button
              type="button"
              key={k}
              className={"okpi " + tone + (quick === k ? " on" : "")}
              aria-pressed={quick === k}
              onClick={() => setQuick(quick === k && k !== "all" ? "all" : k)}
            >
              <span className="okpi-icon" aria-hidden="true">
                <Icon size={24} />
              </span>
              <span className="okpi-text">
                <small>{label}</small>
                <strong>{n}</strong>
                {k === "all" && trend != null && (
                  <em className={trend >= 0 ? "up" : "down"}>
                    {trend >= 0 ? <TrendingUp size={14} aria-hidden="true" /> : <TrendingDown size={14} aria-hidden="true" />}
                    {trend >= 0 ? "+" : ""}
                    {trend}% vs. mes anterior
                  </em>
                )}
              </span>
            </button>
          ))}
        </div>
        <div className="ochips" role="group" aria-label="Accesos rápidos">
          {chips.map(([k, label, Icon, n]) => (
            <button
              type="button"
              key={k}
              className={"ochip" + (quick === k ? " on" : "")}
              aria-pressed={quick === k}
              onClick={() => setQuick(k)}
            >
              {Icon ? <Icon size={16} aria-hidden="true" /> : k === "pending" ? <span className="dot" aria-hidden="true" /> : null}
              {label} ({n})
            </button>
          ))}
        </div>
        <section className="panel ofilters">
          <div className="ofilters-top">
            <label className="plist-search">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por cliente, pedido o dirección…"
                aria-label="Buscar por cliente, número de pedido, factura o dirección"
              />
            </label>
            <button type="button" className="linkbtn oclear" disabled={!dirty} onClick={clearAll}>
              <RotateCcw size={16} aria-hidden="true" /> Limpiar filtros
            </button>
            <button type="button" className="secondary" disabled={!total} onClick={exportCsv}>
              <Download size={16} aria-hidden="true" /> Exportar
            </button>
            {canSell && onNew && (
              <button type="button" className="plist-new" onClick={onNew}>
                <Plus size={20} aria-hidden="true" /> Nuevo pedido
              </button>
            )}
          </div>
          <div className="ofilters-grid">
            <label>
              Estado
              <select value={fx.stage} onChange={(e) => setF("stage", e.target.value)}>
                <option value="">Todos</option>
                {Object.entries(STAGE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            {sellersInList.length > 1 && (
              <label>
                Vendedor
                <select value={fx.seller} onChange={(e) => setF("seller", e.target.value)}>
                  <option value="">Todos</option>
                  {sellersInList.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Fecha (creación)
              <select value={fx.created} onChange={(e) => setF("created", e.target.value)}>
                <option value="">Todas las fechas</option>
                <option value="today">Hoy</option>
                <option value="7d">Últimos 7 días</option>
                <option value="month">Este mes</option>
              </select>
            </label>
            <label>
              Entrega
              <select value={fx.delivery} onChange={(e) => setF("delivery", e.target.value)}>
                <option value="">Todas</option>
                <option value="next7">Próximos 7 días</option>
                <option value="overdue">Vencidas sin finalizar</option>
                <option value="none">Sin fecha</option>
              </select>
            </label>
            <label>
              Ciudad
              <select value={fx.zone} onChange={(e) => setF("zone", e.target.value)}>
                <option value="">Todas</option>
                {zones.map((z) => (
                  <option key={z.code} value={z.code}>{z.name}</option>
                ))}
                <option value="__none">Sin municipio</option>
              </select>
            </label>
            <label>
              Medio de pago
              <select value={fx.method} onChange={(e) => setF("method", e.target.value)}>
                <option value="">Todos</option>
                {Object.entries(PAYMENT_METHOD).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
                <option value="__none">Sin pago</option>
              </select>
            </label>
          </div>
        </section>
        {bulk && picked.size > 0 && (
          <div className="panel bulkbar" role="group" aria-label="Asignar vendedor a varios pedidos">
            <span className="bulk-count" aria-live="polite">
              {picked.size} {picked.size === 1 ? "seleccionado" : "seleccionados"}
            </span>
            <select value={bulkSeller} onChange={(e) => setBulkSeller(e.target.value)} aria-label="Vendedor al que se asignan los pedidos">
              <option value="">Asignar a…</option>
              {sellerOptions.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name || u.username || "Sin nombre"}</option>
              ))}
            </select>
            <button type="button" className="compact" disabled={busy || !bulkSeller} onClick={applyBulk}>
              <UserRound size={15} aria-hidden="true" /> Asignar vendedor
            </button>
            <button type="button" className="linkbtn" disabled={busy} onClick={() => setPicked(new Set())}>
              Quitar selección
            </button>
          </div>
        )}
        <section className="panel olist">
          <div className="tablewrap">
            <table className="plist-table otable">
              <thead>
                <tr>
                  {bulk && (
                    <th className="ocheck">
                      <input
                        type="checkbox"
                        aria-label="Seleccionar los pedidos de esta página"
                        checked={visible.length > 0 && visible.every((r) => picked.has(r.id))}
                        onChange={(e) =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            visible.forEach((r) => (e.target.checked ? next.add(r.id) : next.delete(r.id)));
                            return next;
                          })
                        }
                      />
                    </th>
                  )}
                  {columns.map(([key, label, cls]) => (
                    <SortTh key={key} sortKey={key} label={label} className={cls} sort={sort} onSort={setSort} />
                  ))}
                  <th>Pago</th>
                  <th>Estado</th>
                  <th className="plist-actions-h">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr
                    key={r.id}
                    className={r.stage === "cancelled" ? "is-inactive" : ""}
                  >
                    {bulk && (
                      <td className="ocheck">
                        <input
                          type="checkbox"
                          checked={picked.has(r.id)}
                          onChange={() =>
                            setPicked((prev) => {
                              const next = new Set(prev);
                              next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                              return next;
                            })
                          }
                          aria-label={`Seleccionar pedido #${r.order_number}`}
                        />
                      </td>
                    )}
                    <td>
                      <b className="onum">#{r.order_number}</b>
                      <small className="plist-sku">{r.invoice ? fmtInvoice(r.invoice.invoice_number) : "—"}</small>
                    </td>
                    <td>
                      <span className="ocust">{r.customer_name}</span>
                      {r.customer_phone && <small className="plist-sku">{r.customer_phone}</small>}
                    </td>
                    <td>{r.seller_name || "—"}</td>
                    <td className="onowrap">
                      <CalendarDays size={15} aria-hidden="true" className="omuted" /> {r.delivery_date ? fmtDate(r.delivery_date) : "Sin fecha"}
                    </td>
                    <td className="onowrap">
                      {r.city ? (
                        <>
                          <MapPin size={15} aria-hidden="true" className="omuted" /> {r.city}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num plist-money">{fmtMoney(r.total)}</td>
                    <td>
                      <span className={"pill pay-" + (r.payment_status || "pending")}>
                        {PAYMENT_STATUS[r.payment_status] || PAYMENT_STATUS.pending}
                      </span>
                    </td>
                    <td>
                      <span className={"pill stage-" + r.stage}>{STAGE_LABEL[r.stage]}</span>
                    </td>
                    <td>
                      <div className="plist-actions">
                        <button
                          type="button"
                          className="iconbtn photo"
                          onClick={() => setFull({ id: r.id })}
                          aria-label={`Ver pedido completo #${r.order_number}`}
                          title="Ver pedido completo"
                        >
                          <FileText size={18} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="iconbtn edit"
                          disabled={busy || !orderCanEdit(r, perms)}
                          onClick={() => setFull({ id: r.id, action: "edit" })}
                          aria-label={`Editar pedido #${r.order_number}`}
                          title={orderCanEdit(r, perms) ? "Editar" : "No se puede editar"}
                        >
                          <Pencil size={18} aria-hidden="true" />
                        </button>
                        {onCancelOrder && (
                          <button
                            type="button"
                            className="iconbtn danger"
                            disabled={busy || !orderCanCancel(r, { ...perms, invoiced: !!r.invoice })}
                            onClick={() => setFull({ id: r.id, action: "cancel" })}
                            aria-label={`Cancelar pedido #${r.order_number}`}
                            title={
                              orderCanCancel(r, { ...perms, invoiced: !!r.invoice })
                                ? "Cancelar pedido"
                                : r.invoice
                                  ? "Facturado: anula la factura para cancelar"
                                  : "No se puede cancelar"
                            }
                          >
                            <Trash2 size={18} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!visible.length && (
                  <tr>
                    <td colSpan={colCount} className="plist-empty">
                      {orders.length ? "Ningún pedido coincide con los filtros." : canSell ? "Aún no has generado pedidos." : "No hay pedidos para mostrar."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <footer className="plist-foot">
            <span className="pager-info">
              Mostrando {from} – {to} de {total} pedidos
            </span>
            <PageNav page={current} pages={pages} onPage={setPage} label="Paginación de pedidos" />
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Pedidos por página">
              {[10, 25, 50].map((n) => (
                <option key={n} value={n}>{n} por página</option>
              ))}
            </select>
          </footer>
        </section>
      </div>
      {/* Editar (icono ✏️): solo el formulario; al guardar o cancelar se cierra. */}
      {fullOrder && full.action === "edit" && (
        <Modal title={`Editar pedido #${fullOrder.order_number}`} onClose={() => setFull(null)}>
          <OrderEditForm
            order={fullOrder}
            products={products}
            zones={zones}
            invoiced={invoiceOf.has(fullOrder.id)}
            canBill={canBill}
            admin={admin}
            onSave={onEdit}
            onCancel={() => setFull(null)}
          />
        </Modal>
      )}
      {/* Cancelar (icono 🗑): solo la ventana del motivo. */}
      {fullOrder && full.action === "cancel" && (
        <CancelOrderModal order={fullOrder} onConfirm={onCancelOrder} onClose={() => setFull(null)} />
      )}
      {/* Ver pedido completo (icono 📄). */}
      {fullOrder && !full.action && (
        <Modal title={`Pedido #${fullOrder.order_number}`} onClose={() => setFull(null)}>
          <Orders
            bare
            orders={[fullOrder]}
            busy={busy}
            canBill={canBill}
            admin={admin}
            userId={userId}
            canSell={canSell}
            onEdit={onEdit}
            onCancelOrder={onCancelOrder}
            products={products}
            zones={zones}
            invoices={invoices}
          />
        </Modal>
      )}
    </div>
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
// ---------------------------------------------------------------------
// Liquidación de proveedores (solo admin). Solo cuentan los pedidos con
// factura activa (no anulada) y no cancelados, por fecha de factura. Cada
// línea va al proveedor de su producto; el costo es el vigente en la fecha
// de la factura (product_costs). El domicilio no entra. Todo se calcula en
// el navegador con los datos ya cargados.
// ---------------------------------------------------------------------
function SupplierSettlement({ orders, invoices, products, suppliers, costs }) {
  const today = new Date().toLocaleDateString("en-CA");
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [openId, setOpenId] = useState(null);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const supplierById = new Map(suppliers.map((x) => [x.id, x]));
  const groups = new Map();
  let invoiceCount = 0;
  for (const inv of invoices) {
    if (inv.voided_at) continue;
    const day = new Date(inv.created_at).toLocaleDateString("en-CA");
    if ((from && day < from) || (to && day > to)) continue;
    const o = orderById.get(inv.order_id);
    if (!o || o.cancelled_at) continue;
    invoiceCount++;
    for (const it of o.order_items || []) {
      const p = productById.get(it.product_id);
      const sup = p ? supplierById.get(p.supplier_id) : null;
      const key = sup?.id || "none";
      if (!groups.has(key))
        groups.set(key, {
          id: key,
          name: sup?.name || "Sin proveedor",
          own: !!sup?.own,
          units: 0,
          sale: 0,
          cost: 0,
          missing: 0,
          items: new Map(),
        });
      const g = groups.get(key);
      const qty = it.quantity || 0;
      const sale = (it.unit_price || 0) * qty;
      const unitCost = costAt(costs, it.product_id, inv.created_at);
      g.units += qty;
      g.sale += sale;
      if (unitCost == null) g.missing += qty;
      else g.cost += unitCost * qty;
      const pk = it.product_id;
      if (!g.items.has(pk))
        g.items.set(pk, {
          id: pk,
          name: p?.name || it.products?.name || "Producto",
          units: 0,
          sale: 0,
          cost: 0,
          missing: 0,
          unitCosts: new Set(),
        });
      const r = g.items.get(pk);
      r.units += qty;
      r.sale += sale;
      if (unitCost == null) r.missing += qty;
      else {
        r.cost += unitCost * qty;
        r.unitCosts.add(unitCost);
      }
    }
  }
  const list = [...groups.values()].sort(
    (a, b) => Number(a.own) - Number(b.own) || b.sale - a.sale,
  );
  const totalSale = list.reduce((n, g) => n + g.sale, 0);
  const toPay = list.filter((g) => !g.own).reduce((n, g) => n + g.cost, 0);
  const totalCost = list.reduce((n, g) => n + g.cost, 0);
  const profit = totalSale - totalCost;
  const missing = list.reduce((n, g) => n + g.missing, 0);
  const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
  return (
    <section className="settle">
      <div className="panel settle-filters">
        <label>
          Desde (fecha de factura)
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        <p className="fieldhelp">
          Solo pedidos facturados (factura activa). El domicilio no se incluye. El costo es el vigente
          en la fecha de cada factura.
        </p>
      </div>
      <div className="kpis settle-kpis">
        <div className="kpi tone-brand">
          <span>Vendido</span>
          <strong>{fmtMoney(totalSale)}</strong>
          <small className="kpi-note">{invoiceCount} {invoiceCount === 1 ? "factura" : "facturas"}</small>
        </div>
        <div className="kpi tone-warning">
          <span>A pagar a proveedores</span>
          <strong>{fmtMoney(toPay)}</strong>
          <small className="kpi-note">Sin producción propia</small>
        </div>
        <div className="kpi tone-success">
          <span>Ganancia</span>
          <strong>{fmtMoney(profit)}</strong>
          <small className="kpi-note">{pct(profit, totalSale)} % de lo vendido</small>
        </div>
      </div>
      {missing > 0 && (
        <div className="settle-warn" role="status">
          <b>{missing} {missing === 1 ? "unidad sin costo" : "unidades sin costo"}</b> registrado: no
          suman al pago ni restan a la ganancia. Registra el costo en Productos.
        </div>
      )}
      {!list.length && (
        <div className="panel empty">No hay ventas facturadas en este rango de fechas.</div>
      )}
      <div className="settle-cards">
        {list.map((g) => {
          const open = openId === g.id;
          const gain = g.sale - g.cost;
          return (
            <article key={g.id} className={"panel settle-card" + (g.own ? " own" : "")}>
              <header>
                <h3>
                  {g.name}
                  {g.own && <span className="pill">Producción propia</span>}
                </h3>
                <button
                  type="button"
                  className="secondary compact"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : g.id)}
                >
                  {open ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                  {open ? "Ocultar detalle" : "Ver detalle"}
                </button>
              </header>
              <dl className="settle-nums">
                <div>
                  <dt>Unidades</dt>
                  <dd>{g.units}</dd>
                </div>
                <div>
                  <dt>Vendido</dt>
                  <dd>{fmtMoney(g.sale)}</dd>
                </div>
                <div>
                  <dt>{g.own ? "Costo de producción" : "A pagar"}</dt>
                  <dd className={g.own ? "" : "topay"}>{fmtMoney(g.cost)}</dd>
                </div>
                <div>
                  <dt>Ganancia</dt>
                  <dd className="gain">
                    {fmtMoney(gain)} <small>({pct(gain, g.sale)} %)</small>
                  </dd>
                </div>
              </dl>
              {g.missing > 0 && (
                <p className="settle-missing">
                  {g.missing} {g.missing === 1 ? "unidad" : "unidades"} sin costo registrado.
                </p>
              )}
              {open && (
                <div className="tablewrap">
                  <table className="mini">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th className="num">Unid.</th>
                        <th className="num">Venta</th>
                        <th className="num">Costo unit.</th>
                        <th className="num">Costo total</th>
                        <th className="num">Ganancia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...g.items.values()]
                        .sort((a, b) => b.sale - a.sale)
                        .map((r) => (
                          <tr key={r.id}>
                            <td>{r.name}</td>
                            <td className="num">{r.units}</td>
                            <td className="num">{fmtMoney(r.sale)}</td>
                            <td className="num">
                              {r.missing ? (
                                <span className="pill cancelled-pill">Sin costo</span>
                              ) : r.unitCosts.size === 1 ? (
                                fmtMoney([...r.unitCosts][0])
                              ) : (
                                "Varios"
                              )}
                            </td>
                            <td className="num">{fmtMoney(r.cost)}</td>
                            <td className="num">{fmtMoney(r.sale - r.cost)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
// Color fijo por categoría (mismo nombre = mismo color).
const catTone = (name) => {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return "cat-" + (h % 6);
};
// Listado de productos: buscador, filtro por categoría, tabla paginada y
// alta en ventana. Desactivar no borra: los pedidos ya creados lo usan.
function ProductsView({
  products,
  suppliers = [],
  costs = [],
  admin,
  busy,
  uploadingId,
  sort,
  onSort,
  onCreate,
  onEdit,
  onUpload,
  onToggle,
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [creating, setCreating] = useState(false);
  const categories = [
    ...new Set(products.map((p) => p.category?.trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "es"));
  const q = query.trim().toLowerCase();
  const rows = sortRows(
    products
      .filter((p) => !category || (p.category || "").trim() === category)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.sku || "").toLowerCase().includes(q),
      )
      .map((p) => ({
        ...p,
        supplier_name: suppliers.find((x) => x.id === p.supplier_id)?.name || null,
        cost: admin ? costAt(costs, p.id) : null,
      })),
    sort,
  );
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const from = total ? (current - 1) * pageSize + 1 : 0;
  const to = Math.min(current * pageSize, total);
  const visible = rows.slice(from ? from - 1 : 0, to);
  useEffect(() => setPage(1), [query, category, pageSize]);
  const columns = [
    ["name", "Producto"],
    ["category", "Categoría"],
    ...(admin ? [["supplier_name", "Proveedor"]] : []),
    ["price", "Precio", "num"],
    ["price_wholesale", "Mayorista", "num"],
    ...(admin ? [["cost", "Costo", "num"]] : []),
    ["active", "Estado"],
  ];
  function toggle(p) {
    if (
      p.active &&
      !window.confirm(
        `¿Desactivar «${p.name}»? No se borra: deja de aparecer al crear pedidos y se puede activar de nuevo.`,
      )
    )
      return;
    onToggle(p.id, !p.active);
  }
  return (
    <section className="panel plist">
      <header className="plist-head">
        <h2>
          <List size={26} aria-hidden="true" /> Listado de productos
        </h2>
        {admin && (
          <button type="button" className="plist-new" onClick={() => setCreating(true)}>
            <Plus size={20} aria-hidden="true" /> Nuevo producto
          </button>
        )}
      </header>
      <div className="plist-filters">
        <label className="plist-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto…"
            aria-label="Buscar producto por nombre o referencia"
          />
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filtrar por categoría"
        >
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="tablewrap">
        <table className="plist-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Imagen</th>
              {columns.map(([key, label, cls]) => (
                <SortTh
                  key={key}
                  sortKey={key}
                  label={label}
                  className={cls}
                  sort={sort}
                  onSort={onSort}
                />
              ))}
              {admin && <th className="plist-actions-h">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((p, i) => (
              <tr key={p.id} className={p.active ? "" : "is-inactive"}>
                <td className="num plist-n">{from + i}</td>
                <td>
                  <span className="plist-thumb" aria-hidden="true">
                    {p.image_url ? (
                      <img src={p.image_url} alt="" width="64" height="52" loading="lazy" />
                    ) : (
                      <Package size={20} />
                    )}
                  </span>
                </td>
                <td>
                  <b className="plist-name">{p.name}</b>
                  {p.sku && <small className="plist-sku">{p.sku}</small>}
                </td>
                <td>
                  {p.category ? (
                    <span className={"cat-tag " + catTone(p.category.trim())}>{p.category}</span>
                  ) : (
                    "—"
                  )}
                </td>
                {admin && <td>{p.supplier_name || "—"}</td>}
                <td className="num plist-money">{fmtMoney(p.price)}</td>
                <td className="num plist-money">
                  {p.price_wholesale == null ? "—" : fmtMoney(p.price_wholesale)}
                </td>
                {admin && (
                  <td className="num plist-cost">{p.cost == null ? "—" : fmtMoney(p.cost)}</td>
                )}
                <td>
                  <span className={"state-tag " + (p.active ? "on" : "off")}>
                    {p.active ? "Activo" : "Inactivo"}
                  </span>
                </td>
                {admin && (
                  <td>
                    <div className="plist-actions">
                      <button
                        type="button"
                        className="iconbtn edit"
                        disabled={busy}
                        onClick={() => onEdit(p)}
                        aria-label={`Editar ${p.name}`}
                        title="Editar"
                      >
                        <Pencil size={18} aria-hidden="true" />
                      </button>
                      <label
                        className={"iconbtn photo" + (uploadingId ? " is-disabled" : "")}
                        title={p.image_url ? "Cambiar foto" : "Subir foto"}
                      >
                        <input
                          type="file"
                          className="sr-only"
                          accept="image/jpeg,image/png,image/webp"
                          disabled={!!uploadingId}
                          aria-label={`${p.image_url ? "Cambiar" : "Subir"} foto de ${p.name}`}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            onUpload(p, file);
                          }}
                        />
                        {uploadingId === p.id ? (
                          <Loader2 size={18} className="spin" aria-hidden="true" />
                        ) : (
                          <ImagePlus size={18} aria-hidden="true" />
                        )}
                      </label>
                      <button
                        type="button"
                        className={"iconbtn " + (p.active ? "danger" : "ok")}
                        disabled={busy}
                        onClick={() => toggle(p)}
                        aria-label={`${p.active ? "Desactivar" : "Activar"} ${p.name}`}
                        title={p.active ? "Desactivar" : "Activar"}
                      >
                        {p.active ? (
                          <Trash2 size={18} aria-hidden="true" />
                        ) : (
                          <Power size={18} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={columns.length + 2 + (admin ? 1 : 0)} className="plist-empty">
                  {products.length ? "Ningún producto coincide con la búsqueda." : "Aún no hay productos."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <footer className="plist-foot">
        <span className="pager-info">
          Mostrando {from} – {to} de {total} productos
        </span>
        <nav className="plist-pages" aria-label="Paginación de productos">
          <button
            type="button"
            className="pagebtn"
            disabled={current <= 1}
            onClick={() => setPage(current - 1)}
            aria-label="Página anterior"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          {Array.from({ length: pages }, (_, i) => i + 1)
            .filter((n) => n === 1 || n === pages || Math.abs(n - current) <= 1)
            .map((n, i, arr) => (
              <React.Fragment key={n}>
                {i > 0 && n - arr[i - 1] > 1 && <span className="pagegap">…</span>}
                <button
                  type="button"
                  className={"pagebtn" + (n === current ? " on" : "")}
                  aria-current={n === current ? "page" : undefined}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              </React.Fragment>
            ))}
          <button
            type="button"
            className="pagebtn"
            disabled={current >= pages}
            onClick={() => setPage(current + 1)}
            aria-label="Página siguiente"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </nav>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          aria-label="Productos por página"
        >
          {[10, 25, 50].map((n) => (
            <option key={n} value={n}>
              {n} por página
            </option>
          ))}
        </select>
      </footer>
      {creating && (
        <ProductCreateModal
          products={products}
          suppliers={suppliers}
          busy={busy}
          onCreate={onCreate}
          onUpload={onUpload}
          onClose={() => setCreating(false)}
        />
      )}
    </section>
  );
}
// Foto en las ventanas de producto: vista previa y elegir archivo. El archivo
// se sube al guardar (subida y redimensión: uploadProductPhoto).
function PhotoPicker({ current, file, onFile, disabled }) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const src = preview || current;
  return (
    <div className="pm-photo">
      <span className="pm-photo-label">Foto del producto</span>
      <div className="pm-photo-box">
        {src ? <img src={src} alt="Vista previa de la foto" /> : <Package size={40} aria-hidden="true" />}
      </div>
      <label className={"filebtn pm-photo-btn" + (disabled ? " is-disabled" : "")}>
        <input
          type="file"
          className="sr-only"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onFile(f);
          }}
        />
        <ImagePlus size={16} aria-hidden="true" /> {src ? "Cambiar foto" : "Cargar foto"}
      </label>
      {file ? (
        <small className="pm-photo-help">
          {file.name} · se guarda al pulsar el botón de guardar.{" "}
          <button type="button" className="linkbtn" disabled={disabled} onClick={() => onFile(null)}>
            Quitar
          </button>
        </small>
      ) : (
        <small className="pm-photo-help">JPG, PNG o WebP. Se ajusta el tamaño automáticamente.</small>
      )}
    </div>
  );
}
// Ventana "Nuevo producto" (solo Administrador).
function ProductCreateModal({ products, suppliers, busy, onCreate, onUpload, onClose }) {
  const formId = "product-new";
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  async function submit(e) {
    if (saving) return;
    setSaving(true);
    const created = await onCreate(e);
    // La foto se sube cuando el producto ya existe (necesita su id).
    if (created && file) await onUpload(created, file);
    setSaving(false);
    if (created) onClose();
  }
  busy = busy || saving;
  return (
    <Modal
      title="Nuevo producto"
      onClose={onClose}
      footer={
        <>
          <span />
          <span className="modal-actions">
            <button type="button" className="secondary" disabled={busy} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" form={formId} disabled={busy}>
              {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
              {busy ? "Guardando…" : "Agregar producto"}
            </button>
          </span>
        </>
      }
    >
      <div className="pm-layout">
      <form id={formId} className="editgrid productedit" onSubmit={submit}>
        <label className="span2">
          Nombre
          <input name="name" required />
        </label>
        <label>
          Categoría / línea
          <CategorySelect products={products} />
        </label>
        <label>
          Proveedor
          <SupplierSelect suppliers={suppliers} />
        </label>
        <label>
          Referencia / SKU
          <input name="sku" defaultValue={nextSku(products)} />
        </label>
        <label>
          Precio general (COP)
          <input name="price" type="number" min="0" step="1" inputMode="numeric" />
        </label>
        <label>
          Precio mayorista (COP)
          <input name="price_wholesale" type="number" min="0" step="1" inputMode="numeric" />
        </label>
        <label>
          Costo (COP) · solo admin
          <input name="cost" type="number" min="0" step="1" inputMode="numeric" />
        </label>
        <label className="span2">
          Descripción
          <input name="description" />
        </label>
      </form>
      <PhotoPicker file={file} onFile={setFile} disabled={busy} />
      </div>
    </Modal>
  );
}
// Lista desplegable de proveedores (solo Administrador): los registrados más
// "Nuevo proveedor…". Viaja en campos ocultos supplier_id / supplier_new.
function SupplierSelect({ suppliers = [], defaultValue = "" }) {
  const [choice, setChoice] = useState(defaultValue);
  const [custom, setCustom] = useState("");
  const selectRef = useRef(null);
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
  const options = suppliers.filter((x) => x.active || x.id === defaultValue);
  return (
    <>
      <select
        ref={selectRef}
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        aria-label="Proveedor"
      >
        <option value="">Sin proveedor</option>
        {options.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
        <option value="__new__">+ Nuevo proveedor…</option>
      </select>
      {isNew && (
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Nombre del nuevo proveedor"
          aria-label="Nuevo proveedor"
          required
          autoFocus
        />
      )}
      <input type="hidden" name="supplier_id" value={isNew ? "" : choice} />
      <input type="hidden" name="supplier_new" value={isNew ? custom : ""} />
    </>
  );
}
// Ventana para editar un producto (solo Administrador). Los pedidos ya
// creados no cambian: guardan su propio precio.
function ProductEditModal({ product, products = [], suppliers = [], cost = null, onSave, onUpload, onClose }) {
  const [file, setFile] = useState(null);
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
      supplier_id: String(f.get("supplier_id") || "") || null,
      supplier_new: String(f.get("supplier_new") || "").trim(),
      price: num(f.get("price")),
      price_wholesale: num(f.get("price_wholesale")),
      cost: num(f.get("cost")),
      description: String(f.get("description") || "").trim() || null,
    });
    // La foto nueva se sube solo al guardar (Cancelar no cambia nada).
    const photoOk = ok && file && onUpload ? await onUpload(product, file) : true;
    setSaving(false);
    if (ok && photoOk) onClose();
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
      <div className="pm-layout">
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
          Proveedor
          <SupplierSelect suppliers={suppliers} defaultValue={product.supplier_id || ""} />
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
        <label>
          Costo (COP) · solo admin
          <input name="cost" type="number" min="0" step="1" inputMode="numeric" defaultValue={cost ?? ""} />
        </label>
        <label className="span2">
          Descripción
          <input name="description" defaultValue={product.description || ""} />
        </label>
      </form>
      <PhotoPicker current={product.image_url} file={file} onFile={setFile} disabled={saving} />
      </div>
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
      list_price: i.list_price ?? null,
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
    <article className={"invoice-doc" + (draft ? " draft" : "") + (inv.voided_at ? " voided" : "")}>
      {inv.voided_at && (
        <div className="inv-void" role="note">
          <b>ANULADA</b>
          <span>
            {new Date(inv.voided_at).toLocaleDateString("es-CO")}
            {inv.void_reason && <> · Motivo: {inv.void_reason}</>}
          </span>
        </div>
      )}
      <header className="inv-head">
        <div className="inv-id">
          <img
            className="inv-logo"
            src={`${import.meta.env.BASE_URL}logo-leon.png`}
            alt=""
            width="45"
            height="60"
          />
          <div>
            <div className="inv-brand">Thian Candle</div>
            <small>Chispa de luz, fe y aroma</small>
          </div>
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
              <td className="num">
                <PriceTag unit={i.unit_price} list={i.list_price ?? null} />
              </td>
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
// Ventana para anular una factura: motivo obligatorio. La factura no se borra.
function VoidInvoiceModal({ inv, onConfirm, onClose }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  async function confirm() {
    if (!reason.trim() || saving) return;
    setSaving(true);
    const ok = await onConfirm(inv.id, reason.trim());
    setSaving(false);
    if (ok) onClose();
  }
  return (
    <Modal
      title={`Anular factura ${fmtInvoice(inv.invoice_number)}`}
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
              {saving ? "Anulando…" : "Anular factura"}
            </button>
          </span>
        </>
      }
    >
      <div className="cancelform">
        <p>
          La factura de <b>{inv.customer_name}</b> (pedido #{inv.order_number}, {fmtMoney(inv.total)})
          quedará marcada como <b>anulada</b>: no se borra y conserva su número. El pedido vuelve a
          «Por facturar» y se puede editar y facturar de nuevo con un número nuevo.
        </p>
        <label>
          Motivo de la anulación
          <textarea
            rows={3}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej.: se corrigen las cantidades del pedido"
          />
        </label>
      </div>
    </Modal>
  );
}
// ---------------------------------------------------------------------
// Facturación: tarjetas y accesos rápidos (clic = filtro), buscador,
// filtros, tabla paginada y resumen en un panel lateral ancho (encima de
// la página, sin estrechar la tabla). Generar/anular siguen igual.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Mayoristas: clientes con pedidos a precio mayorista, clasificados a mano
// por el Administrador (tabla wholesale_customers, migración 20261127).
// ---------------------------------------------------------------------
const WHOLESALE_CATS = [
  ["distribuidor", "Distribuidor", Truck, "tone-info"],
  ["tienda", "Tienda", Store, "tone-success"],
  ["revendedor", "Revendedor", Repeat2, ""],
  ["empresa", "Empresa", Building2, "tone-company"],
  ["otro", "Otro", Tag, "tone-neutral"],
];
const WHOLESALE_CAT = Object.fromEntries(WHOLESALE_CATS.map(([v, l]) => [v, l]));
// Clave del cliente: teléfono (solo dígitos, últimos 10) o nombre normalizado.
// Es la customer_key de wholesale_customers: no cambiarla sin migrar los datos.
function customerKey(name, phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length >= 7) return "tel:" + d.slice(-10);
  return "nom:" + String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function WholesaleCustomers({ orders, tags, tagsError, busy, onSave, onRemove }) {
  const [query, setQuery] = useState(""),
    [cat, setCat] = useState(""),
    [sort, setSort] = useState({ key: "total", dir: "desc" }),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(10),
    [editKey, setEditKey] = useState(null);

  const tagByKey = new Map(tags.map((t) => [t.customer_key, t]));
  const groups = new Map();
  for (const o of orders) {
    if (!o.wholesale) continue;
    const key = customerKey(o.customer_name, o.customer_phone);
    const g = groups.get(key) || { key, count: 0, total: 0, last: "", lastNumber: null, customer_phone: "" };
    g.count += 1;
    g.total += orderGrandTotal(o);
    if (o.created_at > g.last) {
      g.last = o.created_at;
      g.lastNumber = o.order_number;
      g.customer_name = o.customer_name;
      g.customer_phone = o.customer_phone || g.customer_phone;
    }
    groups.set(key, g);
  }
  const rows = [...groups.values()].map((g) => {
    const t = tagByKey.get(g.key);
    return {
      ...g,
      category: t?.category || "",
      categoryLabel: t ? WHOLESALE_CAT[t.category] || t.category : "",
      notes: t?.notes || "",
      tagged: !!t,
    };
  });
  const countOf = (c) => rows.filter((r) => (c === "none" ? !r.tagged : r.category === c)).length;
  const kpis = [["none", "Sin clasificar", CircleHelp, "tone-warning"], ...WHOLESALE_CATS];

  const q = query.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const filtered = rows.filter((r) => {
    if (cat === "none" ? r.tagged : cat && r.category !== cat) return false;
    if (!q) return true;
    return (
      r.customer_name.toLowerCase().includes(q) ||
      r.notes.toLowerCase().includes(q) ||
      (qDigits.length >= 3 && String(r.customer_phone).replace(/\D/g, "").includes(qDigits))
    );
  });
  const sorted = sortRows(filtered, sort);
  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const visible = sorted.slice((current - 1) * pageSize, current * pageSize);
  const from = total ? (current - 1) * pageSize + 1 : 0;
  const to = Math.min(current * pageSize, total);
  useEffect(() => setPage(1), [query, cat, pageSize]);

  const editRow = editKey ? rows.find((r) => r.key === editKey) : null;
  const columns = [
    ["customer_name", "Cliente", ""],
    ["count", "Pedidos mayoristas", "num"],
    ["total", "Total comprado", "num"],
    ["last", "Última compra", ""],
    ["categoryLabel", "Categoría", ""],
  ];
  const catPill = (r) =>
    r.tagged ? (
      <span className={"pill wcat wcat-" + r.category}>{r.categoryLabel}</span>
    ) : (
      <span className="pill pay-pending">Sin clasificar</span>
    );
  const empty = rows.length ? "Ningún mayorista coincide con los filtros." : "Aún no hay pedidos con precio mayorista.";
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  return (
    <div className="billing wholesalers">
      {tagsError && (
        <div className="alert error" role="alert">
          No se pudieron leer las clasificaciones ({tagsError}). Si la migración
          20261127_wholesale_customers.sql no está aplicada, hay que ejecutarla en Supabase.
        </div>
      )}
      <div className="okpis wkpis">
        {kpis.map(([k, label, Icon, tone]) => {
          const n = countOf(k);
          return (
            <button
              type="button"
              key={k}
              className={"okpi " + tone + (cat === k ? " on" : "")}
              aria-pressed={cat === k}
              aria-label={`${label}: ${n}`}
              onClick={() => setCat(cat === k ? "" : k)}
            >
              <span className="okpi-icon" aria-hidden="true">
                <Icon size={24} />
              </span>
              <span className="okpi-text" aria-hidden="true">
                <small>{label}</small>
                <strong>{n}</strong>
              </span>
            </button>
          );
        })}
      </div>
      <section className="panel ofilters">
        <div className="ofilters-top">
          <label className="plist-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar cliente, teléfono o nota…"
              aria-label="Buscar mayorista por nombre, teléfono o nota"
            />
          </label>
          <select className="wcat-filter" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filtrar por categoría">
            <option value="">Todas las categorías ({rows.length})</option>
            <option value="none">Sin clasificar ({countOf("none")})</option>
            {WHOLESALE_CATS.map(([v, l]) => (
              <option key={v} value={v}>
                {l} ({countOf(v)})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="linkbtn oclear"
            disabled={!query && !cat}
            onClick={() => {
              setQuery("");
              setCat("");
            }}
          >
            <RotateCcw size={16} aria-hidden="true" /> Limpiar filtros
          </button>
        </div>
      </section>
      <section className="panel olist">
        <div className="tablewrap">
          <table className="plist-table otable btable">
            <thead>
              <tr>
                {columns.map(([key, label, cls]) => (
                  <SortTh key={key} sortKey={key} label={label} className={cls} sort={sort} onSort={setSort} />
                ))}
                <th>Notas</th>
                <th className="plist-actions-h">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.key} onClick={() => setEditKey(r.key)}>
                  <td>
                    <span className="ocust">{r.customer_name}</span>
                    <small className="plist-sku">{r.customer_phone || "Sin teléfono"}</small>
                  </td>
                  <td className="num">{r.count}</td>
                  <td className="num plist-money">{fmtMoney(r.total)}</td>
                  <td className="onowrap">
                    {fmtDate(r.last.slice(0, 10))}
                    <small className="plist-sku">Pedido #{r.lastNumber}</small>
                  </td>
                  <td>{catPill(r)}</td>
                  <td className="wnotes">{r.notes || <span className="omuted">—</span>}</td>
                  <td>
                    <div className="plist-actions bactions">
                      <button
                        type="button"
                        className="secondary compact"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditKey(r.key);
                        }}
                      >
                        <Pencil size={15} aria-hidden="true" /> Clasificar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan={columns.length + 2} className="plist-empty">
                    {empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Móvil: tarjetas en lugar de tabla; tocar abre la clasificación. */}
        <ul className="bcards" aria-label="Mayoristas">
          {visible.map((r) => (
            <li key={r.key}>
              <button type="button" className={"bcard " + (r.tagged ? "is-invoiced" : "is-todo")} onClick={() => setEditKey(r.key)}>
                <span className="bcard-main">
                  <b>{r.customer_name}</b>
                  <small>{r.customer_phone || "Sin teléfono"}</small>
                  <small>
                    {plural(r.count, "pedido")} · última {fmtDate(r.last.slice(0, 10))}
                  </small>
                  <span className="bcard-tags">{catPill(r)}</span>
                </span>
                <span className="bcard-side">
                  <strong>{fmtMoney(r.total)}</strong>
                </span>
                <ChevronRight size={22} aria-hidden="true" className="bcard-go" />
              </button>
            </li>
          ))}
          {!visible.length && <li className="plist-empty">{empty}</li>}
        </ul>
        <footer className="plist-foot">
          <span className="pager-info">
            Mostrando {from} – {to} de {total}
          </span>
          <PageNav page={current} pages={pages} onPage={setPage} label="Paginación de mayoristas" />
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Filas por página">
            {[10, 25, 50].map((n) => (
              <option key={n} value={n}>
                {n} por página
              </option>
            ))}
          </select>
        </footer>
      </section>

      {editRow && (
        <WholesaleTagModal
          row={editRow}
          busy={busy}
          disabled={!!tagsError}
          onClose={() => setEditKey(null)}
          onSave={async (category, notes) => {
            if (await onSave(editRow, category, notes)) setEditKey(null);
          }}
          onRemove={async () => {
            if (await onRemove(editRow)) setEditKey(null);
          }}
        />
      )}
    </div>
  );
}
// Mayoristas: pestañas Clientes (clasificación) y Vendedores mayoristas
// (qué lista de precios tiene cada vendedor; fase 1: aún no cambia precios).
function Wholesalers(props) {
  const [view, setView] = useState("customers");
  return (
    <>
      <div className="seg wtabs" role="group" aria-label="Sección de mayoristas">
        <button type="button" className={view === "customers" ? "is-active" : ""} aria-pressed={view === "customers"} onClick={() => setView("customers")}>
          Clientes
        </button>
        <button type="button" className={view === "sellers" ? "is-active" : ""} aria-pressed={view === "sellers"} onClick={() => setView("sellers")}>
          Vendedores mayoristas
        </button>
      </div>
      {view === "customers" ? (
        <WholesaleCustomers {...props} />
      ) : (
        <WholesaleSellers {...props} />
      )}
    </>
  );
}
function WholesaleSellers({ orders, sellers, priceLists, sellerLists, listsError, busy, onCreateList, onUpdateList, onAssign, products = [], priceItems = [], onSavePrices, invoices = [] }) {
  const [pricesOf, setPricesOf] = useState(null), // lista abierta para editar precios
    [importing, setImporting] = useState(false),
    [statementOf, setStatementOf] = useState(null), // vendedor con estado de cuenta abierto
    [viewAs, setViewAs] = useState(null); // vendedor en «Ver como»
  const { specialFor } = React.useContext(PriceListCtx);
  const [newName, setNewName] = useState(""),
    [editId, setEditId] = useState(null),
    [editName, setEditName] = useState(""),
    [query, setQuery] = useState(""),
    [only, setOnly] = useState("");
  const listById = new Map(priceLists.map((l) => [l.id, l]));
  const listOf = new Map(sellerLists.map((s) => [s.seller_id, s.price_list_id]));
  const stats = new Map();
  for (const o of orders) {
    const st = stats.get(o.seller_id) || { count: 0, total: 0 };
    st.count += 1;
    st.total += orderGrandTotal(o);
    stats.set(o.seller_id, st);
  }
  const membersOf = (id) => sellerLists.filter((s) => s.price_list_id === id).length;
  const q = query.trim().toLowerCase();
  const rows = sellers
    .map((u) => ({ ...u, listId: listOf.get(u.id) || "", ...(stats.get(u.id) || { count: 0, total: 0 }) }))
    .filter((u) => (only === "yes" ? u.listId : only === "no" ? !u.listId : true))
    .filter((u) => !q || (u.full_name || "").toLowerCase().includes(q) || (u.username || "").toLowerCase().includes(q))
    .sort((a, b) => b.total - a.total);
  const wholesaleCount = sellers.filter((u) => listOf.has(u.id)).length;
  const disabled = busy || !!listsError;

  return (
    <div className="billing wholesalers">
      {listsError && (
        <div className="alert error" role="alert">
          No se pudieron leer las listas de precios ({listsError}). Si la migración
          20261127b_price_lists.sql no está aplicada, hay que ejecutarla en Supabase.
        </div>
      )}
      <section className="panel wlists">
        <div className="wlists-head">
          <h2>Listas de precios</h2>
          <p className="omuted">
            Cada vendedor mayorista tiene una lista. Sus pedidos toman el precio de la lista desde 1 unidad;
            los productos que no estén en la lista siguen la regla normal.
          </p>
          <div className="wlists-tools">
            <button type="button" className="secondary compact" disabled={!priceLists.length} onClick={() => downloadPriceTemplate(products, priceLists, priceItems)}>
              <Download size={16} aria-hidden="true" /> Descargar plantilla
            </button>
            <button type="button" className="compact" disabled={busy || !!listsError || !priceLists.length} onClick={() => setImporting(true)}>
              <FileText size={16} aria-hidden="true" /> Importar precios
            </button>
          </div>
        </div>
        <ul className="wlist-items">
          {priceLists.map((l) => (
            <li key={l.id} className={l.active ? "" : "is-inactive"}>
              {editId === l.id ? (
                <form
                  className="wlist-edit"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await onUpdateList(l.id, { name: editName.trim() })) setEditId(null);
                  }}
                >
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={60} aria-label="Nombre de la lista" autoFocus />
                  <button type="submit" className="compact" disabled={disabled || !editName.trim()}>
                    Guardar
                  </button>
                  <button type="button" className="secondary compact" onClick={() => setEditId(null)}>
                    Cancelar
                  </button>
                </form>
              ) : (
                <>
                  <span className="wlist-name">
                    <Tag size={16} aria-hidden="true" /> <b>{l.name}</b>
                    <small className="omuted">
                      {membersOf(l.id)} vendedor{membersOf(l.id) === 1 ? "" : "es"}
                      {!l.active && " · inactiva"}
                    </small>
                  </span>
                  <span className="wlist-actions">
                    <button type="button" className="secondary compact" disabled={disabled} onClick={() => setPricesOf(l.id)}>
                      Precios ({priceItems.filter((i) => i.price_list_id === l.id).length})
                    </button>
                    <button
                      type="button"
                      className="iconbtn"
                      disabled={disabled}
                      aria-label={`Renombrar ${l.name}`}
                      title="Renombrar"
                      onClick={() => {
                        setEditId(l.id);
                        setEditName(l.name);
                      }}
                    >
                      <Pencil size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="secondary compact"
                      disabled={disabled || (l.active && membersOf(l.id) > 0)}
                      title={l.active && membersOf(l.id) > 0 ? "Quita primero los vendedores de esta lista" : undefined}
                      onClick={() => onUpdateList(l.id, { active: !l.active })}
                    >
                      {l.active ? "Desactivar" : "Activar"}
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
          {!priceLists.length && <li className="omuted">Aún no hay listas. Crea la primera, por ejemplo «Mayorista».</li>}
        </ul>
        <form
          className="wlist-new"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onCreateList(newName.trim())) setNewName("");
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={60}
            placeholder="Nombre de la lista nueva"
            aria-label="Nombre de la lista nueva"
          />
          <button type="submit" className="compact" disabled={disabled || !newName.trim()}>
            <Plus size={16} aria-hidden="true" /> Crear lista
          </button>
        </form>
      </section>

      <section className="panel ofilters">
        <div className="ofilters-top">
          <label className="plist-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar vendedor…"
              aria-label="Buscar vendedor por nombre o usuario"
            />
          </label>
          <select className="wcat-filter" value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Filtrar vendedores">
            <option value="">Todos los vendedores ({sellers.length})</option>
            <option value="yes">Mayoristas ({wholesaleCount})</option>
            <option value="no">No mayoristas ({sellers.length - wholesaleCount})</option>
          </select>
        </div>
      </section>

      <section className="panel">
        <ul className="wsellers" aria-label="Vendedores">
          {rows.map((u) => {
            const current = u.listId ? listById.get(u.listId) : null;
            return (
              <li key={u.id} className={"wseller" + (u.listId ? " is-wholesale" : "")}>
                <span className="wseller-main">
                  <b>{u.full_name || u.username}</b>
                  <small className="omuted">
                    @{u.username} · {u.count} pedido{u.count === 1 ? "" : "s"} · {fmtMoney(u.total)} vendido
                  </small>
                </span>
                <label className="wseller-pick">
                  <span className="sr-only">Lista de precios de {u.full_name || u.username}</span>
                  <select value={u.listId} disabled={disabled} onChange={(e) => onAssign(u.id, e.target.value || null)}>
                    <option value="">No es mayorista</option>
                    {priceLists
                      .filter((l) => l.active || l.id === u.listId)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                          {!l.active ? " (inactiva)" : ""}
                        </option>
                      ))}
                  </select>
                </label>
                {current && <span className="pill wcat-revendedor wseller-tag">{current.name}</span>}
                {current && (
                  <span className="wseller-actions">
                    <button type="button" className="secondary compact" onClick={() => setStatementOf(u)}>
                      <Receipt size={15} aria-hidden="true" /> Estado de cuenta
                    </button>
                    <button type="button" className="secondary compact" onClick={() => setViewAs(u)}>
                      <Eye size={15} aria-hidden="true" /> Ver como {(u.full_name || u.username).split(" ")[0]}
                    </button>
                  </span>
                )}
              </li>
            );
          })}
          {!rows.length && <li className="plist-empty">Ningún vendedor coincide.</li>}
        </ul>
      </section>
      {pricesOf && listById.get(pricesOf) && (
        <PriceListEditor
          list={listById.get(pricesOf)}
          products={products}
          priceItems={priceItems}
          busy={busy}
          onClose={() => setPricesOf(null)}
          onSave={async (up, del) => {
            if (await onSavePrices(up, del)) setPricesOf(null);
          }}
        />
      )}
      {statementOf && (
        <Modal title={"Estado de cuenta · " + (statementOf.full_name || statementOf.username)} onClose={() => setStatementOf(null)}>
          <WholesaleStatement
            seller={statementOf}
            orders={orders}
            invoices={invoices}
            listName={specialFor(statementOf.id)?.name || ""}
            viewer="admin"
          />
        </Modal>
      )}
      {viewAs && (
        <WholesaleViewAs seller={viewAs} orders={orders} special={specialFor(viewAs.id)} products={products} onClose={() => setViewAs(null)} />
      )}
      {importing && (
        <PriceImportModal
          products={products}
          priceLists={priceLists}
          priceItems={priceItems}
          busy={busy}
          onClose={() => setImporting(false)}
          onApply={async (up, del) => {
            if (await onSavePrices(up, del)) setImporting(false);
          }}
        />
      )}
    </div>
  );
}
// ---------------------------------------------------------------------
// Precios por lista (fase 2): plantilla Excel, importación y edición manual.
// ---------------------------------------------------------------------
const PRICE_FIXED_COLS = ["Referencia", "Producto", "Categoría", "Precio general", "Precio mayorista"];
const normHead = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
// "18.000", "$ 18,000", 18000 -> 18000. Vacío -> null. Otro texto -> NaN.
function parsePrice(v) {
  const t = String(v ?? "").trim();
  if (!t) return null;
  // Número de Excel: sin miles y con 1-2 o 4+ decimales. "18.000" se toma como miles.
  if (/^\d+(\.(\d{1,2}|\d{4,}))?(e[+-]?\d+)?$/i.test(t)) return Math.round(Number(t));
  const digits = t.replace(/[$\s]/g, "").replace(/[.,](?=\d{3}(\D|$))/g, "");
  return /^\d+$/.test(digits) ? Number(digits) : NaN;
}
const sortProducts = (products) =>
  [...products].sort(
    (a, b) =>
      (a.category || "").localeCompare(b.category || "", "es") || a.name.localeCompare(b.name, "es"),
  );

function downloadPriceTemplate(products, priceLists, priceItems) {
  const lists = priceLists.filter((l) => l.active);
  const price = new Map(priceItems.map((i) => [i.price_list_id + "|" + i.product_id, i.price]));
  const rows = [
    [...PRICE_FIXED_COLS, ...lists.map((l) => l.name)],
    ...sortProducts(products.filter((p) => p.active)).map((p) => [
      p.sku || "",
      p.name,
      p.category || "",
      p.price ?? "",
      p.price_wholesale ?? "",
      ...lists.map((l) => price.get(l.id + "|" + p.id) ?? ""),
    ]),
  ];
  const blob = writeXlsx(rows, {
    sheetName: "Precios mayoristas",
    widths: [16, 38, 18, 15, 17, ...lists.map(() => 18)],
  });
  downloadBlob(blob, `plantilla-precios-mayoristas-${new Date().toLocaleDateString("en-CA")}.xlsx`);
}

// Compara la hoja con los precios guardados. Devuelve cambios y errores.
function buildPriceImport(rows, products, priceLists, priceItems) {
  const errors = [];
  const head = (rows[0] || []).map(normHead);
  const refCol = head.indexOf("referencia");
  const nameCol = head.indexOf("producto");
  if (refCol < 0 && nameCol < 0)
    return { errors: ["La primera fila debe tener la columna «Referencia» o «Producto»."], changes: [], lists: [] };
  const fixed = new Set(PRICE_FIXED_COLS.map(normHead));
  const listByName = new Map(priceLists.map((l) => [normHead(l.name), l]));
  const lists = [];
  head.forEach((h, c) => {
    if (!h || fixed.has(h)) return;
    const l = listByName.get(h);
    if (!l) errors.push(`Columna «${rows[0][c]}»: no existe una lista con ese nombre (se ignora).`);
    else if (!l.active) errors.push(`Columna «${rows[0][c]}»: la lista está inactiva (se ignora).`);
    else lists.push({ col: c, list: l });
  });
  if (!lists.length) errors.push("No hay columnas con el nombre de una lista activa: no hay nada que importar.");
  const bySku = new Map(products.filter((p) => p.sku).map((p) => [p.sku.trim().toLowerCase(), p]));
  const byName = new Map();
  products.forEach((p) => {
    const k = normHead(p.name);
    byName.set(k, byName.has(k) ? "dup" : p);
  });
  const current = new Map(priceItems.map((i) => [i.price_list_id + "|" + i.product_id, i.price]));
  const seen = new Set();
  const changes = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (!row.some((v) => String(v ?? "").trim())) continue; // fila vacía
    const ref = refCol >= 0 ? String(row[refCol] ?? "").trim() : "";
    const name = nameCol >= 0 ? String(row[nameCol] ?? "").trim() : "";
    let p = ref ? bySku.get(ref.toLowerCase()) : null;
    if (!p && name) {
      const hit = byName.get(normHead(name));
      if (hit === "dup") {
        errors.push(`Fila ${r + 1}: hay varios productos llamados «${name}»; usa la Referencia.`);
        continue;
      }
      p = hit || null;
    }
    if (!p) {
      errors.push(`Fila ${r + 1}: no se encontró el producto «${ref || name}».`);
      continue;
    }
    if (seen.has(p.id)) {
      errors.push(`Fila ${r + 1}: «${p.name}» está repetido; se usa la primera fila.`);
      continue;
    }
    seen.add(p.id);
    for (const { col, list } of lists) {
      const v = parsePrice(row[col]);
      const before = current.get(list.id + "|" + p.id) ?? null;
      if (Number.isNaN(v)) {
        errors.push(`Fila ${r + 1}, ${list.name}: «${row[col]}» no es un precio válido.`);
        continue;
      }
      if (v === before) continue;
      changes.push({
        list,
        product: p,
        before,
        after: v,
        kind: v == null ? "remove" : before == null ? "new" : "change",
      });
    }
  }
  return { errors, changes, lists: lists.map((x) => x.list) };
}

const PRICE_KIND = { new: ["Nuevo", "pay-paid"], change: ["Cambia", "pay-partial"], remove: ["Se quita", "cancelled-pill"] };

// ---------------------------------------------------------------------
// Estado de cuenta del mayorista (modelo «compra y revende»): lo que debe =
// total de sus pedidos no cancelados − lo abonado. Solo lectura; usa los
// mismos totales que el resto de la app (orderGrandTotal, amount_paid).
// viewer: "admin" (te debe) | "seller" (Mi cuenta: debes).
// ---------------------------------------------------------------------
function WholesaleStatement({ seller, orders, invoices = [], listName = "", viewer = "admin", showInvoices = true }) {
  const [period, setPeriod] = useState("all"),
    [onlyOwed, setOnlyOwed] = useState(false);
  const now = new Date();
  const monthKey = (d) => d.getFullYear() * 12 + d.getMonth();
  const thisMonth = monthKey(now);
  const invByOrder = new Map(invoices.filter((i) => !i.voided_at).map((i) => [i.order_id, i]));
  const all = orders
    .filter((o) => o.seller_id === seller.id && !o.cancelled_at)
    .map((o) => {
      const total = orderGrandTotal(o);
      const paid = Math.min(o.amount_paid || 0, total);
      return {
        id: o.id,
        order_number: o.order_number,
        created_at: o.created_at,
        customer_name: o.customer_name,
        total,
        paid,
        balance: total - paid,
        listLines: (o.order_items || []).filter((i) => i.list_price != null).length,
        invoice: invByOrder.get(o.id) || null,
      };
    })
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const rows = all.filter((r) => {
    const m = monthKey(new Date(r.created_at));
    if (period === "this" && m !== thisMonth) return false;
    if (period === "last" && m !== thisMonth - 1) return false;
    return !onlyOwed || r.balance > 0;
  });
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const owedAll = all.reduce((s, r) => s + r.balance, 0);
  const who = seller.full_name || seller.username || "Mayorista";
  const exportXlsx = () => {
    const data = [
      ["Pedido", "Fecha", "Cliente", "Total", "Abonado", "Saldo", ...(showInvoices ? ["Factura"] : [])],
      ...rows.map((r) => [
        r.order_number,
        new Date(r.created_at).toLocaleDateString("es-CO"),
        r.customer_name,
        r.total,
        r.paid,
        r.balance,
        ...(showInvoices ? [r.invoice ? fmtInvoice(r.invoice.invoice_number) : "Sin factura"] : []),
      ]),
      [],
      ["", "", "Totales", sum("total"), sum("paid"), sum("balance")],
    ];
    downloadBlob(
      writeXlsx(data, { sheetName: "Estado de cuenta", widths: [10, 12, 32, 14, 14, 14, 14] }),
      `estado-cuenta-${(seller.username || "mayorista").replace(/[^\w.-]/g, "")}-${new Date().toLocaleDateString("en-CA")}.xlsx`,
    );
  };
  return (
    <div className="wstatement">
      <p className="omuted wst-who">
        {who}
        {listName && <> · lista <b>{listName}</b></>} · {all.length} pedido{all.length === 1 ? "" : "s"} · saldo total{" "}
        <b>{fmtMoney(owedAll)}</b>
      </p>
      <div className="wst-kpis" role="group" aria-label="Resumen del período">
        <div className="wst-kpi">
          <small>Comprado</small>
          <strong>{fmtMoney(sum("total"))}</strong>
        </div>
        <div className="wst-kpi">
          <small>Pagado</small>
          <strong>{fmtMoney(sum("paid"))}</strong>
        </div>
        <div className={"wst-kpi is-owed" + (sum("balance") > 0 ? " on" : "")}>
          <small>{viewer === "seller" ? "Saldo por pagar" : "Te debe"}</small>
          <strong>{fmtMoney(sum("balance"))}</strong>
        </div>
      </div>
      <div className="wst-tools">
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Período">
          <option value="all">Todo</option>
          <option value="this">Este mes</option>
          <option value="last">Mes anterior</option>
        </select>
        <label className="pw-show">
          <input type="checkbox" checked={onlyOwed} onChange={(e) => setOnlyOwed(e.target.checked)} /> Solo con saldo
        </label>
        <button type="button" className="secondary compact" disabled={!rows.length} onClick={exportXlsx}>
          <Download size={16} aria-hidden="true" /> Exportar Excel
        </button>
      </div>
      <div className="tablewrap wst-table">
        <table className="plist-table">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Cliente</th>
              <th className="num">Total</th>
              <th className="num">Abonado</th>
              <th className="num">Saldo</th>
              {showInvoices && <th>Factura</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="onowrap">
                  <b>#{r.order_number}</b>
                  <small className="plist-sku">{new Date(r.created_at).toLocaleDateString("es-CO")}</small>
                </td>
                <td>
                  {r.customer_name}
                  {r.listLines > 0 && listName && <small className="plist-sku">Precio de lista</small>}
                </td>
                <td className="num">{fmtMoney(r.total)}</td>
                <td className="num">{fmtMoney(r.paid)}</td>
                <td className={"num" + (r.balance > 0 ? " bsaldo" : "")}>{fmtMoney(r.balance)}</td>
                {showInvoices && (
                  <td>{r.invoice ? fmtInvoice(r.invoice.invoice_number) : <span className="omuted">Sin factura</span>}</td>
                )}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={showInvoices ? 6 : 5} className="plist-empty">
                  {all.length ? "Ningún pedido en este período." : "Aún no hay pedidos."}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <b>Totales</b>
                </td>
                <td className="num">
                  <b>{fmtMoney(sum("total"))}</b>
                </td>
                <td className="num">
                  <b>{fmtMoney(sum("paid"))}</b>
                </td>
                <td className="num">
                  <b>{fmtMoney(sum("balance"))}</b>
                </td>
                {showInvoices && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
// «Ver como» (solo admin): catálogo con su lista + su cuenta, solo lectura.
function WholesaleViewAs({ seller, orders, special, products, onClose }) {
  const [view, setView] = useState("catalog");
  const who = seller.full_name || seller.username;
  return (
    <Modal title={"Vista de " + who} onClose={onClose}>
      <div className="alert info wviewas-note">
        Vista de solo lectura: así ve {who} su catálogo y su cuenta. No se puede crear pedidos ni pagar desde aquí.
      </div>
      <div className="seg wtabs" role="group" aria-label="Qué ver">
        <button type="button" className={view === "catalog" ? "is-active" : ""} aria-pressed={view === "catalog"} onClick={() => setView("catalog")}>
          Catálogo
        </button>
        <button type="button" className={view === "account" ? "is-active" : ""} aria-pressed={view === "account"} onClick={() => setView("account")}>
          Mi cuenta
        </button>
      </div>
      {view === "catalog" ? (
        <div className="wviewas-catalog">
          <ProductCatalog
            products={products.filter((p) => p.active)}
            inCart={() => 0}
            onAdd={() => {}}
            readOnly
            special={special}
            titleId={"viewas-" + seller.id}
            title={special ? "Catálogo · " + special.name : "Catálogo"}
          />
        </div>
      ) : (
        <WholesaleStatement seller={seller} orders={orders} listName={special?.name || ""} viewer="seller" showInvoices={false} />
      )}
    </Modal>
  );
}
function PriceImportModal({ products, priceLists, priceItems, busy, onClose, onApply }) {
  const [fileName, setFileName] = useState(""),
    [result, setResult] = useState(null),
    [readError, setReadError] = useState(""),
    [reading, setReading] = useState(false);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileName(file.name);
    setReadError("");
    setResult(null);
    setReading(true);
    try {
      const rows = await readSheet(file);
      setResult(buildPriceImport(rows, products, priceLists, priceItems));
    } catch (err) {
      setReadError(err.message || "No se pudo leer el archivo.");
    }
    setReading(false);
  };
  const changes = result?.changes || [];
  const count = (k) => changes.filter((c) => c.kind === k).length;
  const apply = () =>
    onApply(
      changes
        .filter((c) => c.kind !== "remove")
        .map((c) => ({ price_list_id: c.list.id, product_id: c.product.id, price: c.after })),
      changes.filter((c) => c.kind === "remove").map((c) => ({ price_list_id: c.list.id, product_id: c.product.id })),
    );
  return (
    <Modal
      title="Importar precios de las listas"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" disabled={busy || !changes.length} onClick={apply}>
            {busy && <Loader2 size={16} className="spin" aria-hidden="true" />} Aplicar {changes.length || ""} cambio
            {changes.length === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      <ol className="pimport-steps omuted">
        <li>Descarga la plantilla: trae todos los productos y una columna por cada lista activa.</li>
        <li>Escribe el precio en pesos en la columna de la lista. Celda vacía = sin precio especial.</li>
        <li>Sube el archivo (.xlsx o .csv) y revisa los cambios antes de aplicarlos.</li>
      </ol>
      <label className="pimport-file">
        <span className="secondary compact pimport-btn">
          <FileText size={16} aria-hidden="true" /> {fileName ? "Elegir otro archivo" : "Elegir archivo"}
        </span>
        <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={pick} />
        {fileName && <small className="omuted">{fileName}</small>}
      </label>
      {reading && (
        <p className="omuted">
          <Loader2 size={16} className="spin" aria-hidden="true" /> Leyendo…
        </p>
      )}
      {readError && (
        <div className="alert error" role="alert">
          {readError}
        </div>
      )}
      {result && (
        <>
          <p className="pimport-summary" role="status">
            {result.lists.length ? <>Listas: <b>{result.lists.map((l) => l.name).join(", ")}</b> · </> : null}
            {count("new")} nuevo{count("new") === 1 ? "" : "s"} · {count("change")} cambio
            {count("change") === 1 ? "" : "s"} · {count("remove")} se quita{count("remove") === 1 ? "" : "n"}
            {!changes.length && !result.errors.length && " · sin cambios: los precios ya coinciden"}
          </p>
          {result.errors.length > 0 && (
            <details className="pimport-errors" open={!changes.length}>
              <summary>
                {result.errors.length} aviso{result.errors.length === 1 ? "" : "s"} (no se importan esas filas)
              </summary>
              <ul>
                {result.errors.slice(0, 100).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
                {result.errors.length > 100 && <li>… y {result.errors.length - 100} más.</li>}
              </ul>
            </details>
          )}
          {changes.length > 0 && (
            <div className="tablewrap pimport-table">
              <table className="plist-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Lista</th>
                    <th className="num">Antes</th>
                    <th className="num">Ahora</th>
                    <th>Cambio</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.slice(0, 300).map((c, i) => (
                    <tr key={i}>
                      <td>
                        {c.product.name}
                        {c.product.sku && <small className="plist-sku">{c.product.sku}</small>}
                      </td>
                      <td>{c.list.name}</td>
                      <td className="num">{c.before == null ? "—" : fmtMoney(c.before)}</td>
                      <td className="num">{c.after == null ? "—" : fmtMoney(c.after)}</td>
                      <td>
                        <span className={"pill " + PRICE_KIND[c.kind][1]}>{PRICE_KIND[c.kind][0]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {changes.length > 300 && <p className="omuted">Se muestran 300 de {changes.length}; se aplican todos.</p>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

// Edición manual de los precios de una lista.
function PriceListEditor({ list, products, priceItems, busy, onClose, onSave }) {
  const saved = new Map(priceItems.filter((i) => i.price_list_id === list.id).map((i) => [i.product_id, i.price]));
  const [draft, setDraft] = useState(() => new Map([...saved].map(([k, v]) => [k, String(v)])));
  const [query, setQuery] = useState(""),
    [onlyListed, setOnlyListed] = useState(saved.size > 0);
  const q = normHead(query);
  const rows = sortProducts(products.filter((p) => p.active || saved.has(p.id))).filter(
    (p) =>
      (!onlyListed || saved.has(p.id) || draft.get(p.id)) &&
      (!q || normHead(p.name).includes(q) || normHead(p.sku).includes(q)),
  );
  const diff = [];
  let invalid = 0;
  new Set([...saved.keys(), ...draft.keys()]).forEach((id) => {
    const v = parsePrice(draft.get(id));
    if (Number.isNaN(v)) invalid++;
    else if (v !== (saved.get(id) ?? null)) diff.push({ product_id: id, price: v });
  });
  const save = () =>
    onSave(
      diff.filter((d) => d.price != null).map((d) => ({ price_list_id: list.id, ...d })),
      diff.filter((d) => d.price == null).map((d) => ({ price_list_id: list.id, product_id: d.product_id })),
    );
  return (
    <Modal
      title={"Precios · " + list.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" disabled={busy || !diff.length || invalid > 0} onClick={save}>
            {busy && <Loader2 size={16} className="spin" aria-hidden="true" />} Guardar {diff.length || ""} cambio
            {diff.length === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      <p className="omuted">
        Precio en pesos por unidad, desde 1 unidad. Deja la casilla vacía para que el producto siga la regla normal.
      </p>
      <div className="plist-editor-tools">
        <label className="plist-search">
          <Search size={18} aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto o referencia…" aria-label="Buscar producto" />
        </label>
        <label className="pw-show">
          <input type="checkbox" checked={onlyListed} onChange={(e) => setOnlyListed(e.target.checked)} /> Solo productos con precio
        </label>
      </div>
      {invalid > 0 && (
        <div className="alert error" role="alert">
          Hay {invalid} precio{invalid === 1 ? "" : "s"} no válido{invalid === 1 ? "" : "s"}: usa solo números.
        </div>
      )}
      <div className="tablewrap plist-editor">
        <table className="plist-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="num">General</th>
              <th className="num">Mayorista 12+</th>
              <th className="num">Precio de la lista</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const v = draft.get(p.id) ?? "";
              const bad = Number.isNaN(parsePrice(v));
              return (
                <tr key={p.id} className={p.active ? "" : "is-inactive"}>
                  <td>
                    {p.name}
                    <small className="plist-sku">{p.sku || "Sin referencia"}</small>
                  </td>
                  <td className="num">{fmtMoney(p.price)}</td>
                  <td className="num">{p.price_wholesale == null ? "—" : fmtMoney(p.price_wholesale)}</td>
                  <td className="num">
                    <input
                      className="plist-price-input"
                      inputMode="numeric"
                      value={v}
                      aria-label={"Precio de " + p.name + " en " + list.name}
                      aria-invalid={bad}
                      placeholder="—"
                      onChange={(e) => setDraft((m) => new Map(m).set(p.id, e.target.value))}
                    />
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="plist-empty">
                  {onlyListed ? "Esta lista aún no tiene precios. Quita «Solo productos con precio» para agregarlos." : "Ningún producto coincide."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function WholesaleTagModal({ row, busy, disabled, onClose, onSave, onRemove }) {
  const [category, setCategory] = useState(row.category || ""),
    [notes, setNotes] = useState(row.notes || ""),
    [confirmRemove, setConfirmRemove] = useState(false);
  const changed = category !== (row.category || "") || notes.trim() !== (row.notes || "");
  return (
    <Modal
      title={"Clasificar · " + row.customer_name}
      onClose={onClose}
      footer={
        <>
          {row.tagged &&
            (confirmRemove ? (
              <button type="button" className="dangerbtn solid" disabled={busy} onClick={onRemove}>
                Sí, quitar clasificación
              </button>
            ) : (
              <button type="button" className="secondary dangerbtn" disabled={busy || disabled} onClick={() => setConfirmRemove(true)}>
                Quitar clasificación
              </button>
            ))}
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" disabled={busy || disabled || !category || !changed} onClick={() => onSave(category, notes)}>
            {busy && <Loader2 size={16} className="spin" aria-hidden="true" />} Guardar
          </button>
        </>
      }
    >
      <p className="omuted">
        {row.customer_phone || "Sin teléfono"} · {row.count} pedido{row.count === 1 ? "" : "s"} mayorista
        {row.count === 1 ? "" : "s"} · {fmtMoney(row.total)}
      </p>
      {disabled && (
        <div className="alert error" role="alert">
          La tabla de clasificaciones no está disponible; no se puede guardar.
        </div>
      )}
      <fieldset className="wcat-pick">
        <legend>Categoría</legend>
        {WHOLESALE_CATS.map(([v, l, Icon]) => (
          <label key={v} className={"wcat-opt" + (category === v ? " on" : "")}>
            <input type="radio" name="wcat" value={v} checked={category === v} onChange={() => setCategory(v)} />
            <Icon size={18} aria-hidden="true" /> {l}
          </label>
        ))}
      </fieldset>
      <label className="wnotes-field">
        Notas (opcional)
        <textarea
          rows={3}
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ej.: compra cada mes, prefiere entrega en Chía…"
        />
      </label>
      {confirmRemove && (
        <div className="alert error" role="alert">
          Se borran la categoría y las notas de este cliente. Sus pedidos no cambian.
        </div>
      )}
    </Modal>
  );
}
const BILL_STATE = {
  todo: ["Por facturar", "pay-pending"],
  invoiced: ["Facturada", "pay-partial"],
  paid: ["Pagada", "pay-paid"],
  voided: ["Anulada", "cancelled-pill"],
};
const billStageLabel = (r) => (r.stage === "finished" ? "Listo para entregar" : STAGE_LABEL[r.stage]);
// Enlace de WhatsApp con un resumen escrito; el usuario revisa y envía.
function whatsappLink(r, doc) {
  const digits = (r.customer_phone || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const phone = digits.length === 10 ? "57" + digits : digits;
  const lines = [
    `Hola ${r.customer_name || ""}, te saluda Thian Candle.`,
    `Resumen de tu pedido #${r.order_number}${r.inv && !r.inv.voided_at ? ` (factura ${fmtInvoice(r.inv.invoice_number)})` : ""}:`,
    `Total: ${fmtMoney(doc.total)}`,
    `Abonado: ${fmtMoney(doc.amount_paid || 0)}`,
    `Saldo por pagar: ${fmtMoney(doc.balance || 0)}`,
  ];
  if (r.delivery_date)
    lines.push(`Entrega: ${fmtDate(r.delivery_date)}${r.delivery_time ? " · " + fmtTime(r.delivery_time) : ""}`);
  lines.push("¡Gracias por tu compra!");
  return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`;
}
function BillingDrawer({ row, doc, busy, admin, canVoid, onClose, onGenerate, onOpenInvoice, onOpenOrder, onVoid }) {
  const boxRef = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    boxRef.current?.querySelector("button")?.focus();
    const onKey = (e) => e.key === "Escape" && !document.querySelector(".modal-backdrop") && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [row.key]);
  const [label, cls] = BILL_STATE[row.kind];
  const pay = row.order?.payment_status || (doc.balance > 0 ? "partial" : "paid");
  const wa = whatsappLink(row, doc);
  return (
    <div className="bdrawer-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="bdrawer" role="dialog" aria-modal="true" aria-labelledby="bdrawer-title" ref={boxRef}>
        <header className="bdrawer-head">
          <span className="bdrawer-icon" aria-hidden="true">
            <FileText size={20} />
          </span>
          <h2 id="bdrawer-title">Resumen de facturación</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Cerrar resumen">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="bdrawer-body">
          <div className="bdrawer-order">
            <div>
              <strong>Pedido #{row.order_number}</strong>
              {row.inv && <small>{fmtInvoice(row.inv.invoice_number)}</small>}
            </div>
            <span className={"pill " + cls}>{label}</span>
          </div>
          <dl className="bdrawer-facts">
            <div>
              <dt><UserRound size={17} aria-hidden="true" /> Cliente</dt>
              <dd>
                {row.customer_name}
                {row.customer_phone && <small>Tel. {row.customer_phone}</small>}
              </dd>
            </div>
            <div>
              <dt><Truck size={17} aria-hidden="true" /> Entrega</dt>
              <dd>
                {row.city ? `${row.city} · ${doc.delivery_fee ? fmtMoney(doc.delivery_fee) : "sin costo"}` : "Sin municipio"}
                <small>
                  {row.delivery_date ? fmtDate(row.delivery_date) : "Sin fecha"}
                  {row.delivery_time && ` · ${fmtTime(row.delivery_time)}`}
                </small>
              </dd>
            </div>
            <div>
              <dt><UserRound size={17} aria-hidden="true" /> Vendedor</dt>
              <dd>{row.seller_name || "—"}</dd>
            </div>
            <div>
              <dt><CreditCard size={17} aria-hidden="true" /> Pago</dt>
              <dd>
                <span className={"pill pay-" + pay}>{PAYMENT_STATUS[pay] || PAYMENT_STATUS.pending}</span>
                {row.method && <small>{PAYMENT_METHOD[row.method]}</small>}
              </dd>
            </div>
            <div>
              <dt><Package size={17} aria-hidden="true" /> Pedido</dt>
              <dd>
                <span className={"pill stage-" + row.stage}>{billStageLabel(row)}</span>
              </dd>
            </div>
          </dl>
          {row.inv?.voided_at && (
            <p className="bdrawer-void">
              Anulada el {new Date(row.inv.voided_at).toLocaleDateString("es-CO")}
              {row.inv.void_reason && ` · Motivo: ${row.inv.void_reason}`}
            </p>
          )}
          <div className="bdrawer-totals">
            <div><span>Productos</span><span>{fmtMoney(doc.subtotal)}</span></div>
            <div><span>Domicilio</span><span>{fmtMoney(doc.delivery_fee || 0)}</span></div>
            <div className="is-total"><span>Total</span><span>{fmtMoney(doc.total)}</span></div>
            <div><span>Abonado</span><span>{fmtMoney(doc.amount_paid || 0)}</span></div>
            <div className="is-balance"><span>Saldo</span><span>{fmtMoney(doc.balance || 0)}</span></div>
          </div>
        </div>
        <footer className="bdrawer-foot">
          {row.kind === "todo" ? (
            <button type="button" className="bdrawer-main" disabled={busy} onClick={onGenerate}>
              <Receipt size={18} aria-hidden="true" /> Generar factura
            </button>
          ) : (
            <button type="button" className="bdrawer-main" onClick={onOpenInvoice}>
              <FileText size={18} aria-hidden="true" /> Ver factura
            </button>
          )}
          {row.order && (
            <button type="button" className="secondary" onClick={onOpenOrder}>
              <Package size={18} aria-hidden="true" /> Ver pedido
            </button>
          )}
          {wa ? (
            <a className="bdrawer-wa" href={wa} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={18} aria-hidden="true" /> Enviar por WhatsApp
            </a>
          ) : (
            <span className="fieldhelp">Sin teléfono válido para WhatsApp.</span>
          )}
          {admin && canVoid && (
            <button type="button" className="secondary dangerbtn" disabled={busy} onClick={onVoid}>
              <Ban size={18} aria-hidden="true" /> Anular factura
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
function Billing({
  orders,
  invoices: allInvoices,
  zones,
  busy,
  admin = false,
  onCreate,
  onVoid,
  canBill,
  canSell,
  userId,
  onEdit,
  onCancelOrder,
  products = [],
}) {
  const today = new Date().toLocaleDateString("en-CA");
  const plusDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString("en-CA");
  };
  // Solo las facturas activas cuentan; las anuladas se listan aparte.
  const invoices = allInvoices.filter((x) => !x.voided_at);
  const voided = allInvoices.filter((x) => x.voided_at);
  const invoiceOf = new Map(invoices.map((x) => [x.order_id, x]));
  const orderOf = new Map(orders.map((o) => [o.id, o]));
  const zoneName = new Map(zones.map((z) => [z.code, z.name]));
  const empty = { stage: "", seller: "", delivery: "", zone: "", method: "" };
  const [quick, setQuick] = useState("todo");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(empty);
  const [sort, setSort] = useState({ key: null, dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [drawerKey, setDrawerKey] = useState(null);
  const [voidingId, setVoidingId] = useState(null);
  const [previewId, setPreviewId] = useState(null);
  const [openInvoiceId, setOpenInvoiceId] = useState(null);
  const [orderId, setOrderId] = useState(null);
  const voiding = allInvoices.find((x) => x.id === voidingId);
  const preview = orders.find((o) => o.id === previewId);
  const openInv = allInvoices.find((x) => x.id === openInvoiceId);
  const orderView = orders.find((o) => o.id === orderId);
  const base = (o, inv) => ({
    order: o,
    inv,
    order_number: o?.order_number ?? inv?.order_number,
    customer_name: o?.customer_name ?? inv?.customer_name,
    customer_phone: o?.customer_phone ?? inv?.customer_phone,
    seller_id: o?.seller_id || "",
    seller_name: o?.seller_name || "",
    delivery_date: o?.delivery_date ?? inv?.delivery_date,
    delivery_time: o?.delivery_time ?? inv?.delivery_time,
    zone: o?.delivery_zone || "",
    city: o?.delivery_zone ? zoneName.get(o.delivery_zone) || o.delivery_zone : inv?.delivery_zone_name || "",
    method: o?.payment_method || inv?.payment_method || "",
    stage: o ? orderStage(o) : "cancelled",
    ready: !!o && (o.order_items || []).length > 0 && orderStage(o) === "finished",
  });
  const rows = [
    ...orders.map((o) => {
      const inv = invoiceOf.get(o.id) || null;
      const total = inv ? inv.total : orderGrandTotal(o);
      const saldo = inv ? inv.balance || 0 : Math.max(orderGrandTotal(o) - (o.amount_paid || 0), 0);
      return {
        ...base(o, inv),
        key: o.id,
        kind: inv ? (saldo > 0 ? "invoiced" : "paid") : "todo",
        total,
        saldo,
      };
    }),
    ...voided.map((inv) => ({
      ...base(orderOf.get(inv.order_id) || null, inv),
      key: "v-" + inv.id,
      kind: "voided",
      total: inv.total,
      saldo: inv.balance || 0,
    })),
  ];
  const QUICK = {
    todo: (r) => r.kind === "todo",
    ready: (r) => r.kind === "todo" && r.ready,
    producing: (r) => r.kind === "todo" && !r.ready,
    done: (r) => r.kind === "invoiced" || r.kind === "paid",
    voided: (r) => r.kind === "voided",
    owed: (r) => r.kind === "invoiced",
    today: (r) => r.kind !== "voided" && r.delivery_date === today,
  };
  const count = (k) => rows.filter(QUICK[k]).length;
  const balance = invoices.reduce((s, x) => s + (x.balance || 0), 0);
  // [clave, etiqueta, etiqueta corta (móvil), icono, tono, valor]
  const kpis = [
    ["ready", "Listos para facturar", "Listos", CheckCircle2, "tone-success", count("ready")],
    ["producing", "En producción", "En producción", Settings, "tone-info", count("producing")],
    ["done", "Facturas", "Facturadas", FileText, "tone-brand", count("done")],
    ["voided", "Anuladas", "Anuladas", Ban, "tone-danger", count("voided")],
    ["owed", "Saldo por cobrar", "Saldo por cobrar", Coins, "tone-warning", fmtMoney(balance)],
  ];
  // En móvil solo se ven los tres primeros accesos (el resto, en filtros).
  const chips = [
    ["todo", "Por facturar", Receipt],
    ["done", "Facturadas", CheckCircle2],
    ["voided", "Anuladas", X],
    ["owed", "Con saldo", Coins],
    ["today", "Entrega hoy", Truck],
  ];
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const cardTone = (r) => (r.kind === "todo" ? (r.ready ? "ready" : "producing") : r.kind);
  // Filtros
  const q = query.trim().toLowerCase();
  const fx = filters;
  const sellersInList = [
    ...new Map(rows.filter((r) => r.seller_id).map((r) => [r.seller_id, r.seller_name || "—"])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], "es"));
  const filtered = rows.filter(
    (r) =>
      QUICK[quick](r) &&
      (!q ||
        String(r.order_number).includes(q.replace("#", "")) ||
        (r.customer_name || "").toLowerCase().includes(q) ||
        (r.customer_phone || "").includes(q) ||
        (r.inv && fmtInvoice(r.inv.invoice_number).toLowerCase().includes(q))) &&
      (!fx.stage || r.stage === fx.stage) &&
      (!fx.seller || r.seller_id === fx.seller) &&
      (!fx.delivery ||
        (fx.delivery === "today" && r.delivery_date === today) ||
        (fx.delivery === "next7" && !!r.delivery_date && r.delivery_date >= today && r.delivery_date <= plusDays(7)) ||
        (fx.delivery === "overdue" && !!r.delivery_date && r.delivery_date < today) ||
        (fx.delivery === "none" && !r.delivery_date)) &&
      (!fx.zone || (fx.zone === "__none" ? !r.zone : r.zone === fx.zone)) &&
      (!fx.method || (fx.method === "__none" ? !r.method : r.method === fx.method)),
  );
  // Sin orden elegido: listos primero, luego por fecha de entrega.
  const sorted = sort.key
    ? sortRows(filtered, sort)
    : [...filtered].sort(
        (a, b) =>
          Number(b.ready) - Number(a.ready) ||
          (a.delivery_date || "9999-12-31").localeCompare(b.delivery_date || "9999-12-31") ||
          b.order_number - a.order_number,
      );
  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const from = total ? (current - 1) * pageSize + 1 : 0;
  const to = Math.min(current * pageSize, total);
  const visible = sorted.slice(from ? from - 1 : 0, to);
  useEffect(() => setPage(1), [quick, query, filters, pageSize]);
  const setF = (k, v) => setFilters((p) => ({ ...p, [k]: v }));
  const dirty = quick !== "todo" || q || Object.values(fx).some(Boolean) || sort.key;
  function clearAll() {
    setQuick("todo");
    setQuery("");
    setFilters(empty);
    setSort({ key: null, dir: "asc" });
  }
  function exportCsv() {
    const head = ["Pedido", "Factura", "Cliente", "Teléfono", "Vendedor", "Entrega", "Ciudad", "Total", "Saldo", "Estado del pedido", "Estado factura"];
    const lines = sorted.map((r) =>
      [
        r.order_number,
        r.inv ? fmtInvoice(r.inv.invoice_number) : "",
        r.customer_name,
        r.customer_phone,
        r.seller_name,
        r.delivery_date,
        r.city,
        r.total,
        r.saldo,
        billStageLabel(r),
        BILL_STATE[r.kind][0],
      ]
        .map(csvCell)
        .join(";"),
    );
    const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `facturacion-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function generate() {
    const n = await onCreate(preview.id);
    if (n == null) {
      lastCreated.current = null;
      return;
    }
    setPreviewId(null);
  }
  // Al terminar de recargar, abre la factura recién generada
  const lastCreated = useRef(null);
  useEffect(() => {
    if (!lastCreated.current) return;
    const inv = invoices.find((x) => x.order_id === lastCreated.current && !x.voided_at);
    if (inv) {
      setOpenInvoiceId(inv.id);
      lastCreated.current = null;
    }
  }, [allInvoices]);
  const drawerRow = rows.find((r) => r.key === drawerKey);
  const drawerDoc = drawerRow && (drawerRow.inv || invoiceDraft(drawerRow.order, zones));
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };
  const columns = [
    ["order_number", "Pedido"],
    ["customer_name", "Cliente"],
    ["seller_name", "Vendedor"],
    ["delivery_date", "Entrega"],
    ["total", "Total", "num"],
    ["saldo", "Saldo", "num"],
  ];
  return (
    <div className="billing">
      <div className="okpis">
        {kpis.map(([k, label, short, Icon, tone, n]) => (
          <button
            type="button"
            key={k}
            className={"okpi bkpi-" + k + " " + tone + (quick === k ? " on" : "")}
            aria-pressed={quick === k}
            aria-label={`${label}: ${n}`}
            onClick={() => setQuick(quick === k ? "todo" : k)}
          >
            <span className="okpi-icon" aria-hidden="true">
              <Icon size={24} />
            </span>
            <span className="okpi-text" aria-hidden="true">
              <small>
                <span className="bk-long">{label}</span>
                <span className="bk-short">{short}</span>
              </small>
              <strong className={k === "owed" ? "okpi-money" : ""}>{n}</strong>
            </span>
          </button>
        ))}
      </div>
      <div className="ochips bchips" role="group" aria-label="Accesos rápidos">
        {chips.map(([k, label, Icon]) => (
          <button
            type="button"
            key={k}
            className={"ochip bchip-" + k + (quick === k ? " on" : "")}
            aria-pressed={quick === k}
            onClick={() => setQuick(k)}
          >
            <Icon size={16} aria-hidden="true" />
            {label} ({count(k)})
          </button>
        ))}
      </div>
      <section className={"panel ofilters bfilters" + (filtersOpen ? " is-open" : "")}>
        <div className="ofilters-top">
          <label className="plist-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar pedido, cliente o factura…"
              aria-label="Buscar por número de pedido, cliente, teléfono o factura"
            />
          </label>
          <button
            type="button"
            className="secondary bfilter-toggle"
            aria-expanded={filtersOpen}
            aria-controls="bfilters-grid"
            aria-label={`Filtros${activeFilters ? ` (${activeFilters} activos)` : ""}`}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <Filter size={20} aria-hidden="true" />
            {activeFilters > 0 && <span className="bfilter-dot" aria-hidden="true" />}
          </button>
          <button type="button" className="linkbtn oclear" disabled={!dirty} onClick={clearAll}>
            <RotateCcw size={16} aria-hidden="true" /> Limpiar filtros
          </button>
          <button type="button" className="secondary bexport" disabled={!total} onClick={exportCsv}>
            <Download size={16} aria-hidden="true" /> Exportar
          </button>
        </div>
        <div className="ofilters-grid" id="bfilters-grid">
          <label className="bmobile-only">
            Acceso rápido
            <select value={quick} onChange={(e) => setQuick(e.target.value)}>
              <option value="todo">Por facturar</option>
              <option value="ready">Listos para facturar</option>
              <option value="producing">En producción</option>
              <option value="done">Facturadas</option>
              <option value="voided">Anuladas</option>
              <option value="owed">Con saldo</option>
              <option value="today">Entrega hoy</option>
            </select>
          </label>
          <label>
            Estado del pedido
            <select value={fx.stage} onChange={(e) => setF("stage", e.target.value)}>
              <option value="">Todos</option>
              <option value="finished">Listo para entregar</option>
              <option value="in_progress">En producción</option>
              <option value="pending">Pendiente</option>
            </select>
          </label>
          {sellersInList.length > 1 && (
            <label>
              Vendedor
              <select value={fx.seller} onChange={(e) => setF("seller", e.target.value)}>
                <option value="">Todos</option>
                {sellersInList.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Fecha de entrega
            <select value={fx.delivery} onChange={(e) => setF("delivery", e.target.value)}>
              <option value="">Cualquier fecha</option>
              <option value="today">Hoy</option>
              <option value="next7">Próximos 7 días</option>
              <option value="overdue">Vencidas</option>
              <option value="none">Sin fecha</option>
            </select>
          </label>
          <label>
            Ciudad
            <select value={fx.zone} onChange={(e) => setF("zone", e.target.value)}>
              <option value="">Todas</option>
              {zones.map((z) => (
                <option key={z.code} value={z.code}>{z.name}</option>
              ))}
              <option value="__none">Sin municipio</option>
            </select>
          </label>
          <label>
            Medio de pago
            <select value={fx.method} onChange={(e) => setF("method", e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(PAYMENT_METHOD).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
              <option value="__none">Sin pago</option>
            </select>
          </label>
        </div>
      </section>
      <section className="panel olist">
        <div className="tablewrap">
          <table className="plist-table otable btable">
            <thead>
              <tr>
                {columns.map(([key, label, cls]) => (
                  <SortTh key={key} sortKey={key} label={label} className={cls} sort={sort} onSort={setSort} />
                ))}
                <th>Estado del pedido</th>
                <th>Estado factura</th>
                <th className="plist-actions-h">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const [label, cls] = BILL_STATE[r.kind];
                return (
                  <tr
                    key={r.key}
                    className={(drawerKey === r.key ? "is-current " : "") + (r.kind === "voided" ? "is-inactive" : "")}
                    onClick={() => setDrawerKey(r.key)}
                  >
                    <td>
                      <b className="onum">#{r.order_number}</b>
                      <small className="plist-sku">{r.inv ? fmtInvoice(r.inv.invoice_number) : "—"}</small>
                    </td>
                    <td>
                      <span className="ocust">{r.customer_name}</span>
                      {r.customer_phone && <small className="plist-sku">{r.customer_phone}</small>}
                    </td>
                    <td>{r.seller_name || "—"}</td>
                    <td className="onowrap">
                      <DueChip order={r} done={r.kind !== "todo"} />
                    </td>
                    <td className="num plist-money">{fmtMoney(r.total)}</td>
                    <td className={"num plist-money" + (r.saldo > 0 ? " bsaldo" : "")}>{fmtMoney(r.saldo)}</td>
                    <td>
                      <span className={"pill stage-" + r.stage}>{billStageLabel(r)}</span>
                    </td>
                    <td>
                      <span className={"pill " + cls}>{label}</span>
                    </td>
                    <td>
                      <div className="plist-actions bactions">
                        {r.kind === "todo" ? (
                          <button
                            type="button"
                            className={"compact" + (r.ready ? "" : " secondary")}
                            disabled={busy}
                            onClick={stop(() => setPreviewId(r.order.id))}
                          >
                            Generar factura
                          </button>
                        ) : (
                          <button type="button" className="secondary compact" onClick={stop(() => setOpenInvoiceId(r.inv.id))}>
                            <FileText size={15} aria-hidden="true" /> Ver factura
                          </button>
                        )}
                        <button
                          type="button"
                          className="iconbtn photo"
                          onClick={stop(() => setDrawerKey(r.key))}
                          aria-label={`Resumen de facturación del pedido #${r.order_number}`}
                          title="Resumen"
                        >
                          <PanelRightOpen size={18} aria-hidden="true" />
                        </button>
                        {admin && onVoid && (r.kind === "invoiced" || r.kind === "paid") && (
                          <button
                            type="button"
                            className="iconbtn danger"
                            disabled={busy}
                            onClick={stop(() => setVoidingId(r.inv.id))}
                            aria-label={`Anular factura ${fmtInvoice(r.inv.invoice_number)}`}
                            title="Anular factura"
                          >
                            <Ban size={18} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!visible.length && (
                <tr>
                  <td colSpan={columns.length + 3} className="plist-empty">
                    {quick === "voided"
                      ? "No hay facturas anuladas."
                      : quick === "todo" && !q && !Object.values(fx).some(Boolean)
                        ? "No hay pedidos por facturar."
                        : "Ningún pedido coincide con los filtros."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Móvil: tarjetas en lugar de tabla; tocar abre el resumen. */}
        <ul className="bcards" aria-label="Pedidos">
          {visible.map((r) => {
            const [label, cls] = BILL_STATE[r.kind];
            return (
              <li key={r.key}>
                <button type="button" className={"bcard is-" + cardTone(r)} onClick={() => setDrawerKey(r.key)}>
                  <span className="bcard-main">
                    <b>#{r.order_number} · {r.customer_name}</b>
                    <small>
                      <MapPin size={15} aria-hidden="true" /> {r.city || "Sin municipio"}
                    </small>
                    <small>
                      <UserRound size={15} aria-hidden="true" /> Vendedor: {r.seller_name || "—"}
                    </small>
                    <span className="bcard-tags">
                      <DueChip order={r} done={r.kind !== "todo"} />
                      {r.kind === "todo" ? (
                        <span className={"pill stage-" + r.stage}>{billStageLabel(r)}</span>
                      ) : (
                        <span className={"pill " + cls}>{label}</span>
                      )}
                    </span>
                  </span>
                  <span className="bcard-side">
                    <strong>{fmtMoney(r.total)}</strong>
                  </span>
                  <ChevronRight size={22} aria-hidden="true" className="bcard-go" />
                </button>
              </li>
            );
          })}
          {!visible.length && <li className="plist-empty">Ningún pedido coincide con los filtros.</li>}
        </ul>
        <footer className="plist-foot">
          <span className="pager-info">
            Mostrando {from} – {to} de {total}
          </span>
          <PageNav page={current} pages={pages} onPage={setPage} label="Paginación de facturación" />
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Filas por página">
            {[10, 25, 50].map((n) => (
              <option key={n} value={n}>{n} por página</option>
            ))}
          </select>
        </footer>
      </section>

      {drawerRow && (
        <BillingDrawer
          row={drawerRow}
          doc={drawerDoc}
          busy={busy}
          admin={admin}
          canVoid={!!onVoid && (drawerRow.kind === "invoiced" || drawerRow.kind === "paid")}
          onClose={() => setDrawerKey(null)}
          onGenerate={() => {
            setDrawerKey(null);
            setPreviewId(drawerRow.order.id);
          }}
          onOpenInvoice={() => {
            setDrawerKey(null);
            setOpenInvoiceId(drawerRow.inv.id);
          }}
          onOpenOrder={() => {
            setDrawerKey(null);
            setOrderId(drawerRow.order.id);
          }}
          onVoid={() => {
            setDrawerKey(null);
            setVoidingId(drawerRow.inv.id);
          }}
        />
      )}
      {preview && (
        <InvoiceModal
          inv={invoiceDraft(preview, zones)}
          title={`Vista previa · Pedido #${preview.order_number}`}
          onClose={() => setPreviewId(null)}
          actions={
            <>
              <span className="fieldhelp">
                {(preview.order_items || []).length > 0 && orderStage(preview) === "finished"
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
      {voiding && (
        <VoidInvoiceModal inv={voiding} onConfirm={onVoid} onClose={() => setVoidingId(null)} />
      )}
      {openInv && (
        <InvoiceModal
          inv={openInv}
          title={`Factura ${fmtInvoice(openInv.invoice_number)}${openInv.voided_at ? " · ANULADA" : ""}`}
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
      {orderView && (
        <Modal title={`Pedido #${orderView.order_number}`} onClose={() => setOrderId(null)}>
          <Orders
            bare
            orders={[orderView]}
            busy={busy}
            canBill={canBill}
            admin={admin}
            userId={userId}
            canSell={canSell}
            onEdit={onEdit}
            onCancelOrder={onCancelOrder}
            products={products}
            zones={zones}
            invoices={allInvoices}
          />
        </Modal>
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
