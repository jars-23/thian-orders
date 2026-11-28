// Edge Function admin-set-password: el Administrador cambia la contraseña de
// otro usuario. Mismas guardas que create-user (origen, sesión, admin activo).
// Contrato: POST { user_id: uuid, password: string(10..128) } -> 200 { id }.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') ?? '';
const headers = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function reply(status: number, value: Record<string, unknown>) {
  return new Response(JSON.stringify(value), { status, headers });
}
serve(async (req) => {
  if (!allowedOrigin || req.headers.get('origin') !== allowedOrigin) return new Response('Origen no permitido', { status: 403 });
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply(405, { error: 'Método no permitido' });
  const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return reply(401, { error: 'Sesión requerida' });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: identity, error: identityError } = await admin.auth.getUser(jwt);
  if (identityError || !identity.user) return reply(401, { error: 'Sesión inválida' });
  const actorId = identity.user.id;
  const { data: actor, error: actorError } = await admin.from('profiles').select('active').eq('id', actorId).single();
  if (actorError || !actor?.active) return reply(403, { error: 'Acceso denegado' });
  const { data: adminRole, error: roleError } = await admin.from('user_roles').select('roles!inner(code)')
    .eq('user_id', actorId).eq('roles.code', 'admin').limit(1);
  if (roleError || !adminRole?.length) return reply(403, { error: 'Solo administradores pueden cambiar contraseñas' });

  let payload;
  try { payload = await req.json(); } catch { return reply(400, { error: 'Solicitud inválida' }); }
  const userId = String(payload?.user_id || '');
  const password = payload?.password;
  if (!uuidRe.test(userId) || typeof password !== 'string' || password.length < 10 || password.length > 128)
    return reply(400, { error: 'La contraseña debe tener entre 10 y 128 caracteres' });
  if (userId === actorId) return reply(400, { error: 'Tu propia contraseña se cambia en «Cambiar mi contraseña»' });

  const { data: target, error: targetError } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (targetError) return reply(500, { error: 'No se pudo validar el usuario' });
  if (!target) return reply(404, { error: 'Usuario no encontrado' });

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password });
  if (updateError) return reply(500, { error: 'No se pudo cambiar la contraseña' });
  return reply(200, { id: userId });
});
