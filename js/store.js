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
}

const emptyState = () => ({ version: 1, entries: {}, settings: { tmdbKey: '', region: 'BE' } });

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
  return {
    watched,
    total: eps.length,
    pct: eps.length ? watched / eps.length : 0,
    last: eps[lastIdx] || null,
    next,
    nextAired,
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
  entry.status = 'watching';
  entry.lastWatchedAt = Date.now();
  if (progress(entry).finished) entry.status = 'completed';
  touch(entry);
  commit();
  return { before, ep: p.next, completed: entry.status === 'completed' };
}

export function restore(snapshot) {
  state.entries[snapshot.id] = snapshot;
  commit();
}

// "J'en suis à S4 É7" : tout ce qui précède est vu, le reste non.
function watchedBefore(title, next) {
  return episodes(title)
    .filter((ep) => ep.s < next.s || (ep.s === next.s && ep.e < next.e))
    .map(epKey);
}

export function setPosition(id, next) {
  const entry = state.entries[id];
  entry.watched = watchedBefore(entry.title, next);
  if (entry.watched.length) {
    entry.status = 'watching';
    entry.lastWatchedAt = Date.now();
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

export function setPlatform(id, platform) {
  const entry = state.entries[id];
  if (entry.platform === platform) return;
  entry.platform = platform;
  entry.platformHistory.push({ platform, at: Date.now() });
  touch(entry);
  commit();
}

export function setProviders(id, providers) {
  const entry = state.entries[id];
  if (!entry) return;
  entry.providers = providers;
  entry.providersAt = Date.now();
  persist();
}

// Alerte quand la série n'est plus disponible sur la plateforme où l'utilisateur la regarde.
export function platformAlert(entry) {
  const list = entry.providers;
  if (!list || !list.length || entry.status === 'completed' || entry.platform === 'other') return null;
  if (list.includes(entry.platform)) return null;
  if (entry.alertAck === list.join(',')) return null;
  return list;
}

export function ackAlert(id) {
  const entry = state.entries[id];
  entry.alertAck = (entry.providers || []).join(',');
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
  state.entries = data.entries;
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
