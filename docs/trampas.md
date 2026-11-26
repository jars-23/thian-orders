# Trampas conocidas

Formato: **síntoma · causa · solución** (3 líneas). Ver [[arquitectura]] y [[plan-de-cambio]].

## T1 · Build local "vacío"
- **Síntoma:** `npm run build` termina bien pero el bundle no contiene el código de la app.
- **Causa:** sin `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, `supabase` es `null` y el minificador elimina el código muerto.
- **Solución:** el build local solo valida sintaxis; la verificación real es con el bundle publicado o una página de prueba.

## T2 · Cambiar la firma de una RPC crea una sobrecarga
- **Síntoma:** tras añadir un parámetro, PostgREST responde "could not choose the best candidate function" o usa la versión vieja.
- **Causa:** `CREATE OR REPLACE` con otra lista de parámetros crea una función nueva y deja la anterior.
- **Solución:** `DROP FUNCTION` de la firma vieja, crear la nueva, repetir `REVOKE/GRANT` y `NOTIFY pgrst, 'reload schema'`.

## T3 · `create_order` no puede hacer UPDATE de `orders`
- **Síntoma:** un vendedor crea el pedido y falla al guardar el total.
- **Causa:** RLS solo deja actualizar `orders` al admin; la RPC es SECURITY INVOKER.
- **Solución:** calcular todo (total, mayorista, pago) antes del INSERT; nada de UPDATE posterior.

## T4 · Inputs numéricos que rechazan valores válidos
- **Síntoma:** el navegador no acepta un abono de 20000.
- **Causa:** `step="100"` con `min="1"` solo acepta 1, 101, 201…
- **Solución:** usar `step="1"` en importes y cantidades.

## T5 · El trigger guarda de `order_items` bloquea ediciones legítimas
- **Síntoma:** `update_order` falla al cambiar cantidades aunque el usuario tenga permiso.
- **Causa:** el trigger solo permite cambiar `status` en UPDATE.
- **Solución:** dentro de la RPC, `set_config('thian.order_edit','on', true)` (local a la transacción) y el trigger lo respeta.

## T6 · Heredoc de bash con comillas
- **Síntoma:** "unexpected EOF" al escribir ficheros con `cat <<EOF`.
- **Causa:** comillas y backticks del contenido rompen el heredoc en Git Bash.
- **Solución:** escribir con la herramienta Write o un script de node; heredoc solo con `'EOF'` y contenido simple.

## T7 · El traductor de Chrome rompe el panel de Supabase
- **Síntoma:** al ejecutar SQL aparece "Sorry! A browser extension may have caused an error" (`removeChild`) y no se ve el resultado.
- **Causa:** Chrome Translate modifica el DOM del SQL Editor (también traduce nombres de columnas en los resultados).
- **Solución:** desactivar la traducción en supabase.com; si pasa, NO repetir el script: verificar con una consulta de solo lectura (la migración es transaccional).

## T8 · Deploy de Pages: "No artifacts named github-pages"
- **Síntoma:** el paso Deploy falla aunque Build y Upload artifact salen bien y el artefacto aparece en el run.
- **Causa:** fallo intermitente de GitHub al leer el artefacto (el workflow no cambió; githubstatus en verde).
- **Solución:** desde el hotfix `deploy-pages` el workflow tiene dos jobs (`build` → `deploy`). Si aun así falla, NO usar "Re-run failed jobs" en un run con artefacto ya subido (da "Multiple artifacts named github-pages"): lanzar un run nuevo (push o "Run workflow").

## T9 · `String.replace` de JS se come los `$$` del SQL
- **Síntoma:** tras generar SQL con un script de node, las funciones quedan con `AS $` y `END; $;`.
- **Causa:** en `str.replace(a, b)`, `$$` dentro de `b` significa "un `$`".
- **Solución:** usar `str.replace(a, () => b)` y contar `$$` antes/después (`grep -o '\$\$' | wc -l`).

## T10 · En local no se puede iniciar sesión
- **Síntoma:** `npm run dev` con `.env.local` correcto carga el login, pero siempre dice «Usuario o contraseña incorrectos».
- **Causa:** la Edge Function `login-username` solo responde al origen de `ALLOWED_ORIGIN` (GitHub Pages) y rechaza `http://localhost:5173` (`supabase/functions/login-username/index.ts:27`).
- **Solución:** probar los cambios de interfaz en la web tras el push. Aceptar localhost exigiría cambiar el contrato de la función (orden expresa).

## T11 · Un `<aside>` dentro de la app hereda el estilo de la barra lateral
- **Síntoma:** un panel nuevo sale con fondo marrón oscuro y texto apagado.
- **Causa:** `src/style.css:165` da estilo a `aside` (la barra lateral) por etiqueta, no por clase.
- **Solución:** no usar `<aside>` en contenido; usar `<div>`/`<section>` con clase propia.
