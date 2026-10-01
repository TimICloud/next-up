// Suppression définitive d'un compte Next Up, demandée par l'utilisateur lui-même depuis Profil.
// Le compte est supprimé avec toute sa bibliothèque (library_entries est liée au compte « on delete cascade »).
// Seule la personne connectée peut supprimer SON compte : l'identifiant vient de son jeton, jamais de la requête.
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default ?? '';

const auth = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY') ?? '');
const admin = createClient(URL_, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Vérification complète auprès du serveur d'authentification (action irréversible).
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return json({ error: 'not signed in' }, 401);

  const userId = data.user.id;
  const { error: libError } = await admin.from('library_entries').delete().eq('user_id', userId);
  if (libError) return json({ error: 'library' }, 500);
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) return json({ error: 'account' }, 500);

  return json({ deleted: true });
});
