// État de l'app : bibliothèque de l'utilisateur et réglages, sauvegardés dans le navigateur.
// La progression est rattachée au titre (film ou série), jamais à la plateforme :
// changer de plateforme ne touche pas aux épisodes vus.
import { demoById } from './catalog.js';

const KEY = 'nextup:v1';
const listeners = new Set();
let state = null;

const clone = (o) => JSON.parse(JSON.stringify(o));
const epKey = (ep) => `${ep.s}:${ep.e}`;
const DAY = 86400000;

export function init() {
  try {
    state = JSON.parse(localStorage.getItem(KEY));
  } catch {
    state = null;
  }
  if (!state) {
    state = emptyState();
    seedDemo();
    persist();
  }
  // Les titres de démo reprennent les données à jour du catalogue (ex. affiches ajoutées depuis).
  for (const entry of Object.values(state.entries)) {
    if (demoById[entry.id]) entry.title = { ...entry.title, ...demoById[entry.id] };
  }
}

const emptyState = () => ({ version: 1, entries: {}, settings: { region: 'BE' }, sync: null });

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Stockage indisponible (navigation privée) : l'app fonctionne quand même pendant la session.
  }
}

function commit() {
  persist();
  listeners.forEach((fn) => fn());
  schedulePush();
}

export const subscribe = (fn) => listeners.add(fn);
export const settings = () => state.settings;
export const get = (id) => state.entries[id];
export const entries = () => Object.values(state.entries);
export const has = (id) => Boolean(state.entries[id]);

export function updateSettings(patch) {
  Object.assign(state.settings, patch);
  commit();
}

// ——— Épisodes et progression ———

export function episodes(title) {
  const out = [];
  for (const season of title.seasons || []) for (let e = 1; e <= season.count; e++) out.push({ s: season.n, e });
  return out;
}

export function isAired(title, ep) {
  const last = title.lastAired;
  if (!last) return true;
  return ep.s < last.s || (ep.s === last.s && ep.e <= last.e);
}

export function progress(entry) {
  const t = entry.title;
  if (t.type === 'movie') {
    const done = entry.status === 'completed';
    const minutes = entry.minutes || 0;
    return { movie: true, done, minutes, pct: done ? 1 : t.runtime ? Math.min(minutes / t.runtime, 1) : 0 };
  }
  const eps = episodes(t);
  const seen = new Set(entry.watched);
  let lastIdx = -1;
  let watched = 0;
  eps.forEach((ep, i) => {
    if (seen.has(epKey(ep))) {
      lastIdx = i;
      watched++;
    }
  });
  const next = eps[lastIdx + 1] || null;
  const nextAired = next ? isAired(t, next) : false;
  // Minutes déjà regardées de l'épisode en cours (seulement si c'est bien le prochain épisode).
  const ep = entry.epProgress;
  const nextMinutes = next && ep && ep.s === next.s && ep.e === next.e ? ep.minutes : 0;
  return {
    watched,
    total: eps.length,
    pct: eps.length ? watched / eps.length : 0,
    last: eps[lastIdx] || null,
    next,
    nextAired,
    nextMinutes,
    finished: !next && !!t.ended,
    // Tout ce qui est sorti a été vu, la suite n'est pas encore diffusée.
    upToDate: !t.ended && (!next || !nextAired) && watched > 0,
  };
}

export const isWatched = (entry, s, e) => entry.watched.includes(`${s}:${e}`);

function touch(entry) {
  entry.updatedAt = Date.now();
}

// Le bouton +1 : marque le prochain épisode comme vu. Renvoie l'ancien état pour pouvoir annuler.
export function plusOne(id) {
  const entry = state.entries[id];
  const p = progress(entry);
  if (!p.next || !p.nextAired) return null;
  const before = clone(entry);
  entry.watched.push(epKey(p.next));
  entry.epProgress = null;
  entry.status = 'watching';
  entry.lastWatchedAt = Date.now();
  if (progress(entry).finished) entry.status = 'completed';
  touch(entry);
  commit();
  return { before, ep: p.next, completed: entry.status === 'completed' };
}

export function restore(snapshot) {
  state.entries[snapshot.id] = { ...snapshot, updatedAt: Date.now() };
  commit();
}

// "J'en suis à S4 É7" : tout ce qui précède est vu, le reste non.
function watchedBefore(title, next) {
  return episodes(title)
    .filter((ep) => ep.s < next.s || (ep.s === next.s && ep.e < next.e))
    .map(epKey);
}

export function setPosition(id, next, minutes = 0) {
  const entry = state.entries[id];
  entry.watched = watchedBefore(entry.title, next);
  entry.epProgress = minutes > 0 ? { s: next.s, e: next.e, minutes } : null;
  if (entry.watched.length || minutes > 0) {
    entry.status = 'watching';
    entry.lastWatchedAt = Date.now();
  }
  touch(entry);
  commit();
}

// Minutes regardées de l'épisode en cours (le prochain à voir).
export function setEpisodeMinutes(id, minutes) {
  const entry = state.entries[id];
  const { next } = progress(entry);
  if (!next) return;
  entry.epProgress = minutes > 0 ? { s: next.s, e: next.e, minutes } : null;
  if (minutes > 0) {
    entry.lastWatchedAt = Date.now();
    if (entry.status === 'planned' || entry.status === 'paused') entry.status = 'watching';
  }
  touch(entry);
  commit();
}

export function toggleEpisode(id, s, e) {
  const entry = state.entries[id];
  const k = `${s}:${e}`;
  const i = entry.watched.indexOf(k);
  if (i >= 0) entry.watched.splice(i, 1);
  else {
    entry.watched.push(k);
    entry.lastWatchedAt = Date.now();
    if (entry.status === 'planned') entry.status = 'watching';
  }
  syncCompletion(entry);
  touch(entry);
  commit();
}

export function setSeason(id, s, value) {
  const entry = state.entries[id];
  const keys = episodes(entry.title).filter((ep) => ep.s === s).map(epKey);
  const others = entry.watched.filter((k) => !keys.includes(k));
  entry.watched = value ? [...others, ...keys] : others;
  if (value) {
    entry.lastWatchedAt = Date.now();
    if (entry.status === 'planned') entry.status = 'watching';
  }
  syncCompletion(entry);
  touch(entry);
  commit();
}

function syncCompletion(entry) {
  const p = progress(entry);
  if (p.finished) entry.status = 'completed';
  else if (entry.status === 'completed') entry.status = 'watching';
}

export function setStatus(id, status) {
  const entry = state.entries[id];
  entry.status = status;
  if (entry.title.type === 'tv' && status === 'completed') entry.watched = episodes(entry.title).map(epKey);
  if (entry.title.type === 'tv' && status === 'planned') entry.watched = [];
  if (entry.title.type === 'movie' && status === 'watching') entry.lastWatchedAt = Date.now();
  touch(entry);
  commit();
}

export function setMinutes(id, minutes) {
  const entry = state.entries[id];
  entry.minutes = minutes;
  entry.lastWatchedAt = Date.now();
  if (entry.status === 'planned') entry.status = 'watching';
  touch(entry);
  commit();
}

// ——— Plateformes ———

// « Regardé avec » : liste vide = l'utilisateur regarde seul (par défaut).
export function setWatchedWith(id, people) {
  const entry = state.entries[id];
  entry.watchedWith = people;
  touch(entry);
  commit();
}

export function setPlatform(id, platform) {
  const entry = state.entries[id];
  if (entry.platform === platform) return;
  entry.platform = platform;
  entry.platformHistory.push({ platform, at: Date.now() });
  touch(entry);
  commit();
}

export function setProviders(id, providers, paid = []) {
  const entry = state.entries[id];
  if (!entry) return;
  entry.providers = providers;
  entry.paidProviders = paid;
  entry.providersAt = Date.now();
  persist();
}

// Alerte quand la série n'est plus disponible sur la plateforme où l'utilisateur la regarde.
// Avec des abonnements renseignés, seules les séries regardées sur une de ces plateformes déclenchent l'alerte,
// et les plateformes auxquelles l'utilisateur est abonné sont proposées en premier.
// Renvoie { to: plateformes où le titre est inclus (abonnements d'abord), paidOnly: plus inclus, seulement
// à l'achat/location sur la plateforme actuelle } ou null s'il n'y a rien à signaler.
export function platformAlert(entry, subs = []) {
  const list = entry.providers;
  const paid = entry.paidProviders || [];
  if (!list || entry.status === 'completed' || entry.platform === 'other') return null;
  if (list.includes(entry.platform)) return null;
  if (!list.length && !paid.length) return null;
  if (subs.length && !subs.includes(entry.platform)) return null;
  if (entry.alertAck === `${list.join(',')}|${paid.join(',')}`) return null;
  return {
    to: [...list].sort((a, b) => subs.includes(b) - subs.includes(a)),
    paidOnly: paid.includes(entry.platform),
  };
}

// Disponibilité saison par saison (données TMDB, propres à cet appareil).
export function setSeasonAvail(id, seasons) {
  const entry = state.entries[id];
  if (!entry) return;
  entry.seasonAvail = { ...(entry.seasonAvail || {}), ...seasons };
  entry.seasonAvailAt = Date.now();
  persist();
  listeners.forEach((fn) => fn());
}

// Statut d'une saison sur la plateforme choisie : 'included', 'paid', 'none' ou null (inconnu).
export function seasonStatus(entry, n) {
  const a = entry.seasonAvail?.[n];
  if (!a) return null;
  // Aucune offre pour cette saison alors que d'autres saisons en ont : pas (encore) disponible dans le pays.
  if (!a.included.length && !a.paid.length) {
    return Object.values(entry.seasonAvail).some((x) => x.included.length || x.paid.length) ? 'none' : null;
  }
  if (a.included.includes(entry.platform)) return 'included';
  if (a.paid.includes(entry.platform)) return 'paid';
  return 'none';
}

// La saison en cours (celle du prochain épisode) si on la connaît, sinon la série entière.
function currentAvail(entry) {
  if (entry.title.type === 'tv') {
    const { next } = progress(entry);
    const a = next && entry.seasonAvail?.[next.s];
    if (a && (a.included.length || a.paid.length)) return a;
  }
  return { included: entry.providers || [], paid: entry.paidProviders || [] };
}

// Sur la plateforme choisie, le titre (ou la saison en cours) n'est pas inclus dans l'abonnement :
// seulement à l'achat ou en location.
export function purchaseOnly(entry) {
  const a = currentAvail(entry);
  return a.paid.includes(entry.platform) && !a.included.includes(entry.platform);
}

// Le titre peut-il être regardé avec les abonnements de l'utilisateur ?
export function availableForMe(entry, subs) {
  if (!subs.length) return true;
  const a = currentAvail(entry);
  if (a.included.length || a.paid.length || entry.providers) return a.included.some((p) => subs.includes(p));
  return subs.includes(entry.platform);
}

export function ackAlert(id) {
  const entry = state.entries[id];
  entry.alertAck = `${(entry.providers || []).join(',')}|${(entry.paidProviders || []).join(',')}`;
  touch(entry);
  commit();
}

// ——— Bibliothèque ———

export function add(title, { platform, status, next, minutes }) {
  const now = Date.now();
  const entry = {
    id: title.id, title, platform,
    platformHistory: [{ platform, at: now }],
    status, watched: [], minutes: 0,
    providers: title.source === 'demo' ? title.providers : null,
    addedAt: now, updatedAt: now, lastWatchedAt: status === 'watching' ? now : null,
  };
  if (title.type === 'tv') {
    if (status === 'completed') entry.watched = episodes(title).map(epKey);
    if (status === 'watching' && next) entry.watched = watchedBefore(title, next);
  } else if (status === 'watching') {
    entry.minutes = minutes || 0;
  }
  state.entries[title.id] = entry;
  commit();
}

// Modification d'un titre ajouté manuellement (nom, saisons…). Les épisodes vus qui n'existent plus sont retirés.
export function editTitle(id, patch) {
  const entry = state.entries[id];
  entry.title = { ...entry.title, ...patch };
  const valid = new Set(episodes(entry.title).map(epKey));
  entry.watched = entry.watched.filter((k) => valid.has(k));
  syncCompletion(entry);
  touch(entry);
  commit();
}

export function updateTitle(id, title) {
  const entry = state.entries[id];
  if (!entry) return;
  entry.title = { ...entry.title, ...title };
  syncCompletion(entry);
  persist();
  listeners.forEach((fn) => fn());
}

export function remove(id) {
  delete state.entries[id];
  commit();
}

export function stats() {
  let episodesSeen = 0, minutes = 0, moviesSeen = 0, showsDone = 0, watching = 0;
  for (const e of entries()) {
    const p = progress(e);
    if (p.movie) {
      if (p.done) {
        moviesSeen++;
        minutes += e.title.runtime || 0;
      } else minutes += e.minutes || 0;
    } else {
      episodesSeen += p.watched;
      minutes += p.watched * (e.title.runtime || 40);
      if (e.status === 'completed') showsDone++;
    }
    if (e.status === 'watching') watching++;
  }
  return { episodesSeen, minutes, moviesSeen, showsDone, watching };
}

// ——— Sauvegarde ———

export const exportData = () => JSON.stringify({ app: 'next-up', exportedAt: new Date().toISOString(), entries: state.entries }, null, 2);

export function importData(json) {
  const data = JSON.parse(json);
  if (!data || typeof data.entries !== 'object') throw new Error('Fichier non reconnu');
  const now = Date.now();
  state.entries = Object.fromEntries(Object.entries(data.entries).map(([id, e]) => [id, { ...e, updatedAt: now }]));
  commit();
}

export function clearLibrary() {
  state.entries = {};
  commit();
}

export function resetDemo() {
  state.entries = {};
  seedDemo();
  commit();
}

// ——— Synchronisation avec le compte Next Up ———
// Chaque entrée porte `updatedAt` ; la version la plus récente gagne.
// `state.sync.at[id]` = date de la dernière version envoyée/reçue (-1 : suppression envoyée).

let sync = null;
let pushTimer;

export const syncing = () => Boolean(sync);

export async function startSync(client, userId) {
  sync = { client, userId };
  if (state.sync?.userId !== userId) {
    // Nouveau compte sur cet appareil : la bibliothèque de démo n'est pas importée dans le compte.
    for (const id of Object.keys(state.entries)) if (id.startsWith('demo-')) delete state.entries[id];
    state.sync = { userId, at: {} };
  }
  await pull();
}

export function stopSync() {
  sync = null;
  clearTimeout(pushTimer);
  state.entries = {};
  state.sync = null;
  persist();
  listeners.forEach((fn) => fn());
}

export async function pull() {
  if (!sync) return;
  const { data, error } = await sync.client.from('library_entries').select('id, data, deleted');
  if (error) throw error;
  const at = state.sync.at;
  for (const row of data) {
    const remote = row.data;
    const local = state.entries[row.id];
    if (row.deleted) {
      if (local && local.updatedAt <= remote.updatedAt) delete state.entries[row.id];
      if (!local || local.updatedAt <= remote.updatedAt) at[row.id] = -1;
      continue;
    }
    if (!local || remote.updatedAt > local.updatedAt) state.entries[row.id] = remote;
    at[row.id] = remote.updatedAt;
  }
  persist();
  listeners.forEach((fn) => fn());
  schedulePush();
}

function schedulePush() {
  if (!sync) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 600);
}

async function push() {
  if (!sync) return;
  const at = state.sync.at;
  const now = Date.now();
  const rows = [];
  for (const e of Object.values(state.entries)) {
    if ((at[e.id] || 0) < e.updatedAt) rows.push({ id: e.id, data: e, deleted: false, updated_at: new Date(e.updatedAt).toISOString() });
  }
  for (const id of Object.keys(at)) {
    if (!state.entries[id] && at[id] !== -1) rows.push({ id, data: { id, updatedAt: now }, deleted: true, updated_at: new Date(now).toISOString() });
  }
  if (!rows.length) return;
  const { error } = await sync.client.from('library_entries').upsert(rows.map((r) => ({ ...r, user_id: sync.userId })));
  if (error) {
    pushTimer = setTimeout(push, 15000); // hors ligne : on réessaie plus tard
    return;
  }
  for (const r of rows) at[r.id] = r.deleted ? -1 : r.data.updatedAt;
  persist();
}

// ——— Bibliothèque de démonstration ———

function seedDemo() {
  const now = Date.now();
  const put = (slug, platform, status, opts = {}) => {
    const title = demoById[slug];
    add(title, { platform, status, next: opts.next, minutes: opts.minutes });
    const entry = state.entries[title.id];
    entry.lastWatchedAt = opts.ago != null ? now - opts.ago : null;
    if (opts.all) entry.watched = episodes(title).map(epKey);
    entry.addedAt = now - (opts.added || 30) * DAY;
    entry.platformHistory[0].at = entry.addedAt;
  };
  put('demo-tv-suits', 'netflix', 'watching', { next: { s: 4, e: 7 }, ago: 0.6 * DAY, added: 200 });
  put('demo-tv-breaking-bad', 'netflix', 'watching', { next: { s: 2, e: 4 }, ago: 3 * 3600000 });
  put('demo-tv-severance', 'apple', 'watching', { next: { s: 2, e: 5 }, ago: 2 * DAY });
  put('demo-tv-the-bear', 'disney', 'watching', { all: true, ago: 12 * DAY });
  put('demo-movie-dune-2', 'max', 'watching', { minutes: 72, ago: 1.5 * DAY });
  put('demo-tv-the-last-of-us', 'max', 'planned', { added: 5 });
  put('demo-tv-wednesday', 'netflix', 'planned', { added: 3 });
  put('demo-movie-oppenheimer', 'prime', 'planned', { added: 8 });
  put('demo-tv-lupin', 'netflix', 'completed', { ago: 40 * DAY, added: 90 });
  put('demo-movie-interstellar', 'prime', 'completed', { ago: 60 * DAY, added: 60 });
}
