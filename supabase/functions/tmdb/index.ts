// Passerelle entre Next Up et TMDB.
// La clé TMDB de Next Up reste ici, côté serveur (secret TMDB_TOKEN) : elle n'est jamais envoyée aux utilisateurs.
// Seuls les utilisateurs connectés à un compte Next Up peuvent l'utiliser.
import { createClient } from 'npm:@supabase/supabase-js@2';

const TMDB_TOKEN = (Deno.env.get('TMDB_TOKEN') ?? Deno.env.get('TMDB-token') ?? '').trim();
const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '');

// Uniquement les appels dont l'app a besoin (+ la recherche intelligente de Next Up).
const ALLOWED = /^\/(configuration|search\/multi|trending\/all\/week|(tv|movie)\/\d+(\/watch\/providers)?|tv\/\d+\/season\/\d+(\/watch\/providers)?|nextup\/search)$/;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });

function tmdb(path: string, params: Record<string, string>) {
  const target = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) if (k !== 'api_key') target.searchParams.set(k, v);
  if (!target.searchParams.has('language')) target.searchParams.set('language', 'fr-FR');
  // Accepte le jeton de lecture (v4, commence par "eyJ") ou la clé API classique (v3).
  const bearer = TMDB_TOKEN.startsWith('eyJ');
  if (!bearer) target.searchParams.set('api_key', TMDB_TOKEN);
  return fetch(target, bearer ? { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } } : {});
}

// ——— Recherche tolérante aux fautes ———

const norm = (s: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const STOP = new Set(['the', 'le', 'la', 'les', 'de', 'des', 'du', 'a', 'an', 'of', 'et', 'and', 'un', 'une']);

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const ratio = (a: string, b: string) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

// Ressemblance entre la saisie et un titre (0 à 1), mot à mot puis sur l'ensemble.
function similarity(q: string, title: string) {
  if (!q || !title) return 0;
  if (title === q) return 1;
  if (title.startsWith(q) || title.includes(` ${q}`)) return 0.95;
  const qw = q.split(' ');
  const tw = title.split(' ');
  let total = 0;
  let bestWord = 0;
  for (const w of qw) {
    let best = 0;
    for (const t of tw) best = Math.max(best, ratio(w, t), w.length >= 3 && t.startsWith(w) ? 0.9 : 0);
    total += best;
    if (w.length >= 3 && !STOP.has(w)) bestWord = Math.max(bestWord, best);
  }
  const words = total / qw.length;
  const compactQ = q.replace(/ /g, '');
  const whole = ratio(compactQ, title.replace(/ /g, '').slice(0, compactQ.length + 2));
  // Un seul mot important bien reconnu suffit à proposer le titre (« Navy Seals » → « SEAL Team »).
  return Math.max(words * 0.8 + whole * 0.2, bestWord * 0.7);
}

// Variantes de la saisie : singulier, mots seuls, mots raccourcis (fautes en fin de mot).
function variants(query: string) {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const singular = words.map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
  const out = new Set([words.join(' '), singular.join(' ')]);
  const strong = singular.filter((w) => w.length >= 3 && !STOP.has(w));
  if (words.length > 1) {
    for (const w of strong) out.add(w);
    out.add(singular.slice(1).join(' '));
  }
  for (const w of strong) if (w.length >= 6) out.add(w.slice(0, -2));
  return [...out].filter((v) => v.length >= 2).slice(0, 6);
}

async function smartSearch(query: string, region: string) {
  const q = norm(query);
  const list = variants(query);
  const pages = await Promise.all(list.map(async (v, i) => {
    const res = await tmdb('/search/multi', { query: v, include_adult: 'false', region });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []).map((r: Record<string, unknown>, rank: number) => ({ r, exact: i === 0 && rank < 5 }));
  }));

  const seen = new Map<string, { r: Record<string, unknown>; score: number }>();
  for (const { r, exact } of pages.flat()) {
    if (r.media_type !== 'tv' && r.media_type !== 'movie') continue;
    const key = `${r.media_type}-${r.id}`;
    if (seen.has(key)) continue;
    const sim = Math.max(similarity(q, norm(String(r.name ?? r.title ?? ''))), similarity(q, norm(String(r.original_name ?? r.original_title ?? ''))));
    if (sim < 0.45 && !exact) continue;
    const pop = Math.min(1, Math.log10(1 + Number(r.popularity ?? 0)) / 3);
    const votes = Math.min(1, Math.log10(1 + Number(r.vote_count ?? 0)) / 4);
    // Ressemblance d'abord, mais un titre connu passe devant un titre obscur au nom presque identique.
    seen.set(key, { r, score: sim * 0.5 + pop * 0.3 + votes * 0.2 + (exact ? 0.05 : 0) });
  }
  const results = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 24).map((x) => x.r);
  return { results };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  // Vérification locale du jeton de l'utilisateur (sans appel réseau quand c'est possible).
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub || data.claims.role !== 'authenticated') return json({ error: 'not signed in' }, 401);

  const url = new URL(req.url);
  const path = url.searchParams.get('path') ?? '';
  if (!ALLOWED.test(path)) return json({ error: 'path not allowed' }, 400);
  const params = Object.fromEntries([...url.searchParams].filter(([k]) => k !== 'path'));

  if (path === '/nextup/search') {
    return json(await smartSearch(params.query ?? '', params.region ?? 'BE'), 200, { 'Cache-Control': 'private, max-age=300' });
  }

  const res = await tmdb(path, params);
  return new Response(await res.text(), {
    status: res.status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=600' },
  });
});
