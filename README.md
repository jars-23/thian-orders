# Thian Orders — Gestión de pedidos y producción

Aplicación interna de Thian Candle: React + Vite + Material UI + Supabase, publicada en GitHub Pages
(`https://jars-23.github.io/thian-orders/`).

Repositorio: `https://github.com/jars-23/thian-orders` (copia de `thian-candle/thian-report`,
que queda como `upstream`). Si cambia el nombre del repositorio, actualiza `base` en `vite.config.js`.

- Inicio de sesión con **username y contraseña** (Edge Function `login-username`).
- Usuarios con **varios roles**: `admin`, `seller`, `production`, `billing`, `supervisor`, `sales_production`.
- Pedidos con varios productos; cada producto tiene su estado de producción (`pending`, `in_progress`, `finished`).
- La autorización real está en Supabase (RLS + RPC), no solo en la interfaz.

## Permisos por rol

| Rol | Ve pedidos | Registra pedidos | Cambia estados | Administra |
|---|---|---|---|---|
| `admin` | Todos | Sí | Sí | Usuarios, roles, productos |
| `seller` | Solo los suyos | Sí | No | No |
| `production` | Todos | No | Sí | No |
| `sales_production` | Todos | Sí | Sí | No |
| `billing`, `supervisor` | Todos (lectura) | No | No | No |

Los roles son acumulativos. Los estados se cambian con la RPC `set_order_item_status`,
que solo modifica `order_items.status`.

---

## Instalación desde cero

### 1. Crear el proyecto Supabase
1. En https://supabase.com crea una organización y un proyecto. Guarda la contraseña de la base de datos.
2. Deja activada la **Data API** del proyecto.
3. **SQL Editor** → pega y ejecuta completo [`supabase/setup.sql`](supabase/setup.sql).
   Crea tablas, roles, funciones, triggers y políticas RLS.
4. **Authentication → Sign In / Providers → Email**: desactiva **Allow new users to sign up**.
   Las cuentas las crea el administrador.

### 2. Crear el primer administrador
1. **Authentication → Users → Add user → Create new user**: correo y contraseña, con
   **Auto Confirm User** marcado.
2. En **SQL Editor**, ejecuta el bloque *PRIMER ADMINISTRADOR* que está comentado al final de
   `setup.sql`, reemplazando correo, username y nombre.
3. Comprueba con la consulta de verificación que el usuario tiene el rol `admin`.

Los siguientes usuarios se crean desde la app: **Usuarios y roles → Registrar nuevo usuario**.

### 3. Desplegar las Edge Functions
Con Node.js instalado no hace falta instalar la CLI globalmente (`npx` la descarga):

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase secrets set ALLOWED_ORIGIN=https://jars-23.github.io
npx supabase functions deploy login-username --no-verify-jwt
npx supabase functions deploy create-user
```

- `ALLOWED_ORIGIN` es el origen exacto del frontend, **sin ruta ni `/` final**.
  Para probar en local usa temporalmente `http://localhost:5173`.
- `login-username` es pública (sin verificación de JWT). `create-user` exige sesión y además
  valida en código que quien llama sea admin activo.
- Si `create-user` responde *Invalid JWT* (proyectos con las nuevas claves de firma), vuelve a
  desplegarla con `--no-verify-jwt`: la función valida el token por sí misma.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase.
  **Nunca** pongas la service_role en `.env` ni en GitHub.

### 4. Conectar el frontend
**Local:**
```bash
npm install
cp .env.example .env   # completar URL y clave pública
npm run dev
```

**GitHub Pages:** en el repositorio → **Settings → Secrets and variables → Actions → Secrets**,
actualiza `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` con los valores del proyecto nuevo.
Luego ejecuta el workflow **Deploy Thian Candle** (o haz push a `main`).

### 5. Verificación
1. Inicia sesión con el username del administrador.
2. Crea un producto, un usuario de cada rol y un pedido.
3. Comprueba con cada usuario qué pedidos ve y si puede cambiar estados según la tabla de permisos.

---

## Estructura

```
src/                       Frontend React
supabase/setup.sql         Esquema completo (instalación desde cero)
supabase/migrations/       Cambios para bases ya instaladas (ejecutar en orden)
supabase/functions/        Edge Functions login-username y create-user
supabase/legacy/           Scripts históricos v1.0–v1.2 (solo referencia, no ejecutar)
```

## Seguridad pendiente antes de uso intensivo
- Limitar intentos de inicio de sesión (rate limiting) en `login-username`.
- Auditoría de cambios de estado.
- Flujo de contraseña temporal con cambio obligatorio.
