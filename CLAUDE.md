# Thian Orders — guía para Claude Code

App interna de pedidos y producción de **Thian Candle**.
React 18 + Vite 5 + Supabase (Auth, PostgREST/RPC, Storage, Edge Functions); MUI solo en el login.
Publicada en GitHub Pages: https://jars-23.github.io/thian-orders/ (repo `jars-23/thian-orders`, rama `main`).
Idioma de la interfaz: **español**. Identificadores en inglés, prosa en español.

Mi papel: **ANALIZAR, PROPONER, AJUSTAR código y MANTENER el cerebro (`docs/`)**. Las pruebas las hace el usuario a mano.
Cuenta Pro: respuestas cortas, sin subagentes, Sonnet por defecto.

## Compilar
- `npm run build` (validación local; no requiere permiso).
- Sin `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` en local, el minificador elimina el código de la app:
  el build local **solo valida sintaxis**. Ver [[trampas]].
- El despliegue lo hace GitHub Actions (`.github/workflows/deploy.yml`) al hacer push a `main`. **El push lo hace el usuario.**

## Carpetas clave
| Ruta | Qué es |
|---|---|
| `src/main.jsx` | Casi toda la SPA (App, pedidos, producción, catálogo, edición) |
| `src/style.css` | Estilos (tokens en `:root`, responsive ≤1100 / ≤760 px) |
| `src/components/auth/`, `src/theme/` | Login con MUI y su tema |
| `supabase/setup.sql` | Esquema completo para instalación desde cero |
| `supabase/migrations/` | Cambios para bases ya instaladas (se ejecutan en orden) |
| `supabase/seed/` | Cargas de datos (catálogo) |
| `supabase/functions/` | Edge Functions `login-username`, `create-user` |
| `docs/` | Cerebro del sistema (Obsidian) |

## Lo que NO se toca sin orden expresa
- Políticas RLS, firmas de RPC, esquema de la base, contratos de Edge Functions.
- `supabase/legacy/` (solo referencia).
- Ficheros de secretos (`.env*`): nunca se leen ni se muestran.

## Reglas (resumen de R1–R10)
1. **Solo local**: sin push, PR, despliegues ni servicios externos. Dejo el comando exacto.
2. **Sin escritura en BD**: entrego el SQL (migración + espejo en `setup.sql`) con **respaldo y marcha atrás**; lo ejecuta el usuario.
3. **No se inventa**: cada dato lleva «medido: fichero:línea / comando» o «no verificado».
4. **Leer antes de tocar**; buscar en todo el repo antes de renombrar.
5. **Lógica de negocio, firmas y contratos** no se tocan sin orden expresa.
6. **Una autorización = una acción**. Ante la duda, preguntar.
7. **Sin secretos**: grep de la clave concreta, nunca su valor.
8. **Dependencias/plugins**: licencia comprobada + `npm audit`; instala el usuario.
9. Identificadores en inglés, prosa en español.
10. **Una guarda no se rodea**: si un permiso bloquea, se informa.

## Flujo por encargo
1. **Analizar** (≤15 líneas, medido vs supuesto) → 2. **Proponer** con [[plan-de-cambio]] y diff antes de editar
→ 3. **Ajustar** tras «sí» y compilar → 4. **Guía de prueba manual** (antes/después/regresión/datos)
→ 5. **Cerrar**: entrada en `docs/bitacora/AAAA-MM-DD.md` (fecha de `Get-Date`), trampas nuevas en [[trampas]],
cambios de estructura en [[arquitectura]] → 6. **Commit** solo si se pide, en `feature/<slug>` o `hotfix/<slug>`, nunca push.

## Roles de la app
`admin`, `seller`, `production`, `billing` (Supervisor y Ventas y Producción: retiro pendiente, ver bitácora).
Permisos reales en Supabase (RLS + RPC SECURITY DEFINER); el frontend solo los refleja.

## Ahorro de tokens
CLAUDE.md → `docs/trampas.md` → `graphify-out/GRAPH_REPORT.md` (si existe) → Grep con puntería → Read con offset/limit.
No repetir lo ya decidido. Al cerrar: recordar `/usage` y `/clear`.
