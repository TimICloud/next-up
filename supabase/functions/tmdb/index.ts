// Passerelle entre Next Up et TMDB.
// La clé TMDB de Next Up reste ici, côté serveur (secret TMDB_TOKEN) : elle n'est jamais envoyée aux utilisateurs.
// Seuls les utilisateurs connectés à un compte Next Up peuvent l'utiliser.
import { createClient } from 'npm:@supabase/supabase-js@2';

const TMDB_TOKEN = Deno.env.get('TMDB_TOKEN') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '');

// Uniquement les appels dont l'app a besoin.
const ALLOWED = /^\/(configuration|search\/multi|trending\/all\/week|(tv|movie)\/\d+(\/watch\/providers)?|tv\/\d+\/season\/\d+)$/;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return json({ error: 'not signed in' }, 401);

  const url = new URL(req.url);
  const path = url.searchParams.get('path') ?? '';
  if (!ALLOWED.test(path)) return json({ error: 'path not allowed' }, 400);

  const target = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of url.searchParams) if (k !== 'path' && k !== 'api_key') target.searchParams.set(k, v);
  if (!target.searchParams.has('language')) target.searchParams.set('language', 'fr-FR');

  // Accepte le jeton de lecture (v4, commence par "eyJ") ou la clé API classique (v3).
  const bearer = TMDB_TOKEN.startsWith('eyJ');
  if (!bearer) target.searchParams.set('api_key', TMDB_TOKEN);
  const res = await fetch(target, bearer ? { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } } : {});

  return new Response(await res.text(), {
    status: res.status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=600' },
  });
});
