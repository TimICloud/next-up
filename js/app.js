import * as S from './store.js';
import * as C from './catalog.js';
import * as Auth from './auth.js';
import { PLATFORMS, platform } from './platforms.js';
import { icon, logo } from './icons.js';
import { norm, similarity } from './fuzzy.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const epLabel = (ep) => `S${ep.s} · É${ep.e}`;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Abonnements : dans le compte quand on est connecté (tous les appareils), sinon sur l'appareil.
const subscriptions = () => S.settings().subscriptions ?? [];

// À la connexion : on reprend les abonnements du compte, ou on y enregistre ceux de l'appareil.
function syncSubscriptions() {
  const fromAccount = Auth.user()?.user_metadata?.subscriptions;
  if (fromAccount) S.updateSettings({ subscriptions: fromAccount });
  else if (subscriptions().length) Auth.updateMeta({ subscriptions: subscriptions() }).catch(() => {});
}

// ——— Dates de sortie ———
const DAY_MS = 86400000;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

function relDay(days, date) {
  if (days === 0) return 'aujourd’hui';
  if (days === 1) return 'demain';
  if (days < 7) return date.toLocaleDateString('fr-BE', { weekday: 'long' });
  return `dans ${days} jours`;
}

// Prochaines sorties des titres suivis (données TMDB rafraîchies en arrière-plan).
function upcoming() {
  const today = startOfDay(Date.now());
  const items = [];
  const fresh = [];
  const tbd = [];
  for (const e of S.entries()) {
    const t = e.title;
    if (t.source !== 'tmdb') continue;
    if (t.type === 'tv') {
      if (t.nextAir?.date) {
        const date = parseDay(t.nextAir.date);
        const days = Math.round((date - today) / DAY_MS);
        if (days >= 0) items.push({ e, date, days, label: epLabel(t.nextAir), name: t.nextAir.name, premiere: t.nextAir.e === 1 });
      } else if (t.returning && !t.ended) {
        tbd.push(e);
      }
      // Nouveaux épisodes sortis ces 14 derniers jours et pas encore vus.
      const p = S.progress(e);
      if (t.lastAirDate && t.lastAired && p.next && p.nextAired && e.status !== 'planned' && p.next.s === t.lastAired.s) {
        const days = Math.round((today - parseDay(t.lastAirDate)) / DAY_MS);
        if (days >= 0 && days <= 14) fresh.push({ e, days, label: epLabel(p.next) });
      }
    } else if (t.releaseDate && e.status !== 'completed') {
      const date = parseDay(t.releaseDate);
      const days = Math.round((date - today) / DAY_MS);
      if (days >= 0) items.push({ e, date, days, label: 'Sortie du film', movie: true });
    }
  }
  items.sort((a, b) => a.date - b.date);
  return { items, fresh, tbd };
}

// Personnes avec qui on regarde un titre (en plus de celles créées par l'utilisateur).
const COMPANIONS = [
  ['Famille', '👨‍👩‍👧'], ['Copine', '❤️'], ['Copain', '❤️'], ['Mère', '👩'], ['Père', '👨'],
  ['Sœur', '👧'], ['Frère', '👦'], ['Enfants', '🧒'], ['Amis', '🙌'], ['Colocs', '🏠'],
];
const companionEmoji = (name) => COMPANIONS.find(([n]) => n === name)?.[1] || '👤';
const withChip = (name) => `<span class="with-chip static"><span>${companionEmoji(name)}</span>${esc(name)}</span>`;
const withText = (people) => people.join(', ').replace(/, ([^,]*)$/, ' et $1');

const STATUS = {
  watching: 'En cours',
  paused: 'En pause',
  planned: 'À voir',
  completed: 'Terminé',
};

// État d'interface (non sauvegardé).
const ui = {
  bumped: null,
  editName: false,
  libFilter: 'all',
  season: {},
  editPlatform: false,
  sheet: null,
  query: '',
  results: null,
  resultsById: {},
  searching: false,
  searchError: null,
  epNames: {},
  loading: new Set(),
};

// ——— Petits composants ———

function poster(t, cls = '') {
  const src = C.posterSrc(t);
  if (src) return `<div class="poster ${cls}"><img src="${src}" alt="" loading="lazy"></div>`;
  const [a, b] = t.palette || C.paletteFor(t.name);
  return `<div class="poster gen ${cls}" style="--a:${a};--b:${b}">
    <span class="gen-type">${t.type === 'movie' ? 'Film' : 'Série'}</span>
    <span class="gen-title">${esc(t.original || t.name)}</span>
    <span class="gen-year">${t.year || ''}</span></div>`;
}

function backdrop(t) {
  if (t.backdrop) return `<img class="bd-img" src="${C.img(t.backdrop, 'w780')}" alt="" loading="lazy">`;
  const src = C.posterSrc(t);
  if (src) return `<img class="bd-img blur" src="${src}" alt="" loading="lazy">`;
  const [a, b] = t.palette || C.paletteFor(t.name);
  return `<div class="bd-gen" style="--a:${a};--b:${b}"><span>${esc(t.original || t.name)}</span></div>`;
}

const chip = (pid) => {
  const p = platform(pid);
  return `<span class="pchip" style="--pc:${p.color}"><i></i>${esc(p.name)}</span>`;
};

const bar = (pct) => `<div class="bar"><span style="width:${Math.round(pct * 100)}%"></span></div>`;

function plusButton(entry, p, size = '') {
  const blocked = !p.next || !p.nextAired;
  const bumped = ui.bumped === entry.id ? 'bump' : '';
  return `<button class="plus ${size} ${bumped}" data-action="plus" data-id="${esc(entry.id)}" ${blocked ? 'disabled' : ''}
    aria-label="Marquer ${p.next ? epLabel(p.next) : ''} comme vu"><span>+1</span></button>`;
}

// 95 → « 1 h 35 », 19 → « 19 min ».
const fmtDur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`);
const leftText = (watched, runtime) => (runtime ? `reste ${fmtDur(Math.max(runtime - watched, 0))}` : '');
const epRuntime = (e) => e.title.runtime || 60;

function nextLine(entry, p) {
  if (p.movie) {
    if (p.done) return 'Vu';
    return entry.minutes ? `${fmtDur(entry.minutes)} vues${entry.title.runtime ? ` · <b>${leftText(entry.minutes, entry.title.runtime)}</b>` : ''}` : 'Pas encore commencé';
  }
  if (p.finished) return 'Série terminée';
  if (p.upToDate) return 'À jour · en attente de la suite';
  if (p.next && p.nextMinutes) return `Reprendre · <b>${epLabel(p.next)}</b> à ${p.nextMinutes} min · ${leftText(p.nextMinutes, epRuntime(entry))}`;
  if (p.next) return `Prochain · <b>${epLabel(p.next)}</b>`;
  return '';
}

// ——— Vues ———

function viewHome() {
  const list = S.entries();
  const hour = new Date().getHours();
  const hello = hour < 6 ? 'Bonne nuit' : hour < 18 ? 'Bonjour' : 'Bonsoir';

  if (!list.length && Auth.enabled && !Auth.user()) {
    return `<div class="welcome">
        ${logo('big')}
        <h1>Bienvenue sur Next Up</h1>
        <p class="muted">Suis où tu en es dans tes séries et films, sur toutes tes plateformes. Connecte-toi pour retrouver ta bibliothèque.</p>
        <a class="btn primary block" href="#/account/login">Se connecter</a>
        <a class="btn block" href="#/account/signup">Créer un compte</a>
      </div>`;
  }
  if (!list.length) {
    return `<header class="page-head"><p class="eyebrow">${hello}</p><h1>Next Up</h1></header>
      <div class="empty">
        <div class="empty-art">${icon('play')}</div>
        <h2>Ta bibliothèque est vide</h2>
        <p>Ajoute la série ou le film que tu regardes, choisis la plateforme et indique où tu en es.</p>
        <a class="btn primary" href="#/add">${icon('plus')} Ajouter un titre</a>
        ${Auth.enabled && !Auth.user() ? '<a class="link" href="#/account/login">J’ai déjà un compte · me connecter</a>' : ''}
      </div>`;
  }

  const withP = list.map((e) => ({ e, p: S.progress(e) }));
  const subs = subscriptions();
  const alerts = list.map((e) => ({ e, alert: S.platformAlert(e, subs) })).filter((a) => a.alert);
  const soon = upcoming().items.filter((x) => x.days <= 7);
  const resume = withP
    .filter(({ e, p }) => e.status === 'watching' && (p.movie ? !p.done : p.next && p.nextAired))
    .sort((a, b) => (b.e.lastWatchedAt || 0) - (a.e.lastWatchedAt || 0));
  const upToDate = withP.filter(({ e, p }) => e.status === 'watching' && p.upToDate);
  const planned = list.filter((e) => e.status === 'planned').sort((a, b) => b.addedAt - a.addedAt);

  return `
    <header class="page-head">
      <p class="eyebrow">${hello}</p>
      <h1>On reprend où<br>tu t’étais arrêté.</h1>
    </header>
    ${homeSearch()}

    ${Auth.enabled && !Auth.user() ? accountBanner() : ''}
    ${alerts.map(({ e, alert }) => alertCard(e, alert)).join('')}
    ${!subs.length ? `<a class="subs-banner" href="#/profile/abonnements">
      <span class="subs-icons">${['netflix', 'prime', 'disney'].map((id) => `<i style="--pc:${platform(id).color}"></i>`).join('')}</span>
      <span><b>Indique tes abonnements</b><small>Pour savoir ce que tu peux regarder et être prévenu au bon moment.</small></span>
      ${icon('back', 'flip')}</a>` : ''}
    ${soon.length ? `<a class="soon-card" href="#/upcoming">
      <span class="soon-icon">${icon('calendar')}</span>
      <span><small>Bientôt</small><span class="soon-line"><b>${esc(soon[0].e.title.name)}</b> · ${soon[0].label} · <em>${relDay(soon[0].days, soon[0].date)}</em></span>
        ${soon.length > 1 ? `<small>+ ${plural(soon.length - 1, 'autre sortie', 'autres sorties')} cette semaine</small>` : ''}</span>
      ${icon('back', 'flip')}</a>` : ''}

    <section class="block">
      <div class="block-head"><h2>Continuer</h2><span class="count">${resume.length}</span></div>
      ${resume.length ? `<div class="resume-list">${resume.map(({ e, p }) => resumeCard(e, p)).join('')}</div>`
        : `<p class="muted pad">Rien en cours. <a href="#/add">Ajoute un titre</a> ou lance un titre de ta liste « À voir ».</p>`}
    </section>

    ${upToDate.length ? `<section class="block">
      <div class="block-head"><h2>À jour</h2><span class="count">${upToDate.length}</span></div>
      <p class="muted block-sub">Tu as tout vu, on attend les prochains épisodes.</p>
      <div class="row-scroll">${upToDate.map(({ e }) => miniPoster(e)).join('')}</div>
    </section>` : ''}

    ${planned.length ? `<section class="block">
      <div class="block-head"><h2>À voir</h2><span class="count">${planned.length}</span></div>
      <div class="row-scroll">${planned.map((e) => miniPoster(e)).join('')}</div>
    </section>` : ''}`;
}

const accountBanner = () => `<a class="account-banner" href="#/account/signup">
    ${logo()}
    <span><b>Crée ton compte Next Up</b><small>Tout le catalogue films et séries, et ta progression sur tous tes appareils.</small></span>
    ${icon('back', 'flip')}
  </a>`;

const homeSearch = () => `<button class="home-search" data-action="openSearch">
    ${icon('search')}<span>Titre, acteur, thème…</span></button>`;

// ——— Recherche globale (loupe de la barre du haut, barre de l'accueil) ———
const finder = { q: '', catalog: null, byId: {}, loading: false, seq: 0, timer: null, abort: null };

function openFinder() {
  const root = $('#finder');
  root.hidden = false;
  renderFinder();
  requestAnimationFrame(() => root.classList.add('open'));
  setTimeout(() => $('#finder-q')?.focus(), 60);
}

function closeFinder() {
  const root = $('#finder');
  root.classList.remove('open');
  finder.abort?.abort();
  setTimeout(() => { if (!root.classList.contains('open')) root.hidden = true; }, 200);
}

function finderLibrary(q) {
  if (!q) return [];
  return S.entries()
    .map((e) => ({ e, s: Math.max(similarity(q, norm(e.title.name)), similarity(q, norm(e.title.original || ''))) }))
    .filter((x) => x.s >= 0.5)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map((x) => x.e);
}

function finderResults() {
  const q = norm(finder.q);
  if (!q) return `<p class="finder-hint">Tape un titre, un acteur ou un thème (« zombie », « mafia »…) : tes titres d’abord, puis tout le catalogue pour en ajouter.</p>`;
  const mine = finderLibrary(q);
  const owned = new Set(S.entries().map((e) => e.id));
  const catalog = (finder.catalog || []).filter((t) => !owned.has(t.id)).slice(0, 12);
  const row = (t, attrs, sub) => `<button class="finder-row" ${attrs}>${poster(t, 'finder-poster')}
      <span class="finder-info"><b>${esc(t.name)}</b><small>${sub}</small></span>${icon('back', 'flip')}</button>`;
  return `${mine.length ? `<section><h3 class="label">Dans ta bibliothèque</h3>${mine.map((e) => {
      const p = S.progress(e);
      const sub = [STATUS[e.status], !p.movie && p.next && e.status !== 'planned' ? epLabel(p.next) : '', platform(e.platform).name].filter(Boolean).join(' · ');
      return row(e.title, `data-action="finderOpen" data-id="${esc(e.id)}"`, esc(sub));
    }).join('')}</section>` : ''}
    <section><h3 class="label">Ajouter${C.live() ? '' : ' (catalogue de démo)'}</h3>
      ${finder.loading && !finder.catalog ? '<div class="spinner"></div>'
        : catalog.length ? catalog.map((t) => row(t, `data-action="finderAdd" data-id="${esc(t.id)}"`, `${t.type === 'movie' ? 'Film' : 'Série'}${t.year ? ` · ${t.year}` : ''}${t.reason ? ` · <span class="reason">${esc(t.reason)}</span>` : ''}`)).join('')
        : `<p class="finder-hint">Aucun autre titre trouvé. <button class="link" data-action="finderManual">Ajouter manuellement</button></p>`}
    </section>`;
}

function renderFinder() {
  const root = $('#finder');
  if (!root.firstChild) {
    root.innerHTML = `<div class="finder-bar">
        ${icon('search')}
        <input id="finder-q" type="search" placeholder="Titre, acteur, thème…" autocomplete="off" enterkeyhint="search" aria-label="Rechercher">
        <button class="finder-close" data-action="closeFinder">Fermer</button>
      </div>
      <div class="finder-body" id="finder-body"></div>`;
  }
  $('#finder-q').value = finder.q;
  $('#finder-body').innerHTML = finderResults();
  $('#finder-body').classList.toggle('loading', finder.loading && Boolean(finder.catalog));
}

function runFinder() {
  clearTimeout(finder.timer);
  const q = finder.q.trim();
  finder.abort?.abort();
  if (!q) {
    finder.catalog = null;
    finder.loading = false;
    renderFinder();
    return;
  }
  const s = S.settings();
  const cached = C.cachedSearch(q, s);
  if (cached) {
    Object.assign(finder, { catalog: cached, loading: false });
    cached.forEach((t) => { finder.byId[t.id] = t; });
    renderFinder();
    return;
  }
  finder.loading = true;
  renderFinder();
  finder.timer = setTimeout(async () => {
    const seq = ++finder.seq;
    finder.abort = new AbortController();
    try {
      const res = await C.search(q, s, finder.abort.signal);
      if (seq !== finder.seq) return;
      res.forEach((t) => { finder.byId[t.id] = t; });
      Object.assign(finder, { catalog: res, loading: false });
    } catch (e) {
      if (e.name === 'AbortError' || seq !== finder.seq) return;
      Object.assign(finder, { catalog: [], loading: false });
    }
    renderFinder();
  }, 150);
}

function resumeCard(e, p) {
  const t = e.title;
  return `<article class="rcard" data-go="#/title/${encodeURIComponent(e.id)}">
    <div class="rcard-bg">${backdrop(t)}</div>
    ${poster(t, 'rcard-poster')}
    <div class="rcard-body">
      <div class="rcard-top">${chip(e.platform)}${t.type === 'movie' ? '<span class="tag">Film</span>' : ''}${S.purchaseOnly(e) ? '<span class="tag warn">€ Achat</span>' : S.availableForMe(e, subscriptions()) ? '' : '<span class="tag warn">Hors abonnements</span>'}</div>
      <h3>${esc(t.name)}</h3>
      <p class="next">${nextLine(e, p)}</p>
      ${bar(p.pct)}
      <p class="meta">${p.movie ? `${Math.round(p.pct * 100)} %` : `${p.watched} / ${p.total} épisodes`}${e.watchedWith?.length ? ` · <span class="with-meta">avec ${esc(withText(e.watchedWith))}</span>` : ''}</p>
    </div>
    ${p.movie
      ? `<button class="plus done-btn" data-action="movieDone" data-id="${esc(e.id)}" aria-label="Marquer comme vu">${icon('check')}</button>`
      : plusButton(e, p)}
  </article>`;
}

function miniPoster(e) {
  const p = S.progress(e);
  return `<a class="mini" href="#/title/${encodeURIComponent(e.id)}">
    ${poster(e.title)}
    ${p.pct > 0 && p.pct < 1 ? bar(p.pct) : ''}
    <span class="mini-name">${esc(e.title.name)}</span>
    <span class="mini-sub">${chip(e.platform)}</span>
  </a>`;
}

function alertCard(e, { to, paidOnly }) {
  const from = platform(e.platform).name;
  const target = to[0];
  const subs = subscriptions();
  const headline = paidOnly
    ? `<b>${esc(e.title.name)}</b> n’est plus inclus dans l’abonnement ${esc(from)} : seulement à l’achat ou en location.`
    : `<b>${esc(e.title.name)}</b> n’est plus sur ${esc(from)}.`;
  const where = to.length
    ? `Inclus dans l’abonnement ${to.map((pid) => esc(platform(pid).name)).join(', ')}${subs.includes(target) ? ' (un de tes abonnements)' : subs.length ? ' (pas dans tes abonnements)' : ''}.`
    : 'Il n’est plus inclus dans aucun abonnement pour l’instant.';
  return `<div class="alert">
    <div class="alert-icon">${icon(paidOnly ? 'alert' : 'swap')}</div>
    <div class="alert-body">
      <p>${headline}</p>
      <p class="muted">${where} Ta progression est conservée.</p>
      <div class="alert-actions">
        ${target ? `<button class="btn small primary" data-action="switchPlatform" data-id="${esc(e.id)}" data-p="${target}">Passer sur ${esc(platform(target).name)}</button>` : ''}
        <button class="btn small ghost" data-action="ackAlert" data-id="${esc(e.id)}">${target ? 'Ignorer' : 'OK, compris'}</button>
      </div>
    </div>
  </div>`;
}

const LIB_FILTERS = [
  ['all', 'Tout'],
  ['watching', 'En cours'],
  ['planned', 'À voir'],
  ['completed', 'Terminés'],
  ['movie', 'Films'],
  ['tv', 'Séries'],
  ['mine', 'Sur mes abonnements'],
];

function viewLibrary() {
  const f = ui.libFilter;
  const subs = subscriptions();
  const match = (e) => {
    if (f === 'all') return true;
    if (f === 'movie' || f === 'tv') return e.title.type === f;
    if (f === 'watching') return e.status === 'watching' || e.status === 'paused';
    if (f === 'mine') return e.status !== 'completed' && S.availableForMe(e, subs);
    return e.status === f;
  };
  const list = S.entries()
    .filter(match)
    .sort((a, b) => (b.lastWatchedAt || b.addedAt) - (a.lastWatchedAt || a.addedAt));

  return `<header class="page-head compact"><h1>Bibliothèque</h1>
      <p class="muted">${plural(S.entries().length, 'titre', 'titres')}</p></header>
    <div class="filters">${LIB_FILTERS.map(([k, label]) =>
      `<button class="fchip ${f === k ? 'on' : ''}" data-action="libFilter" data-f="${k}">${label}</button>`).join('')}</div>
    ${f === 'mine' && !subs.length ? `<div class="empty small"><p>Indique d’abord tes abonnements.</p><a class="btn" href="#/profile/abonnements">Choisir mes abonnements</a></div>`
      : f === 'mine' ? `<p class="muted block-sub">À voir ou en cours, et disponible sur ${subs.map((id) => platform(id).name).join(', ')}.</p>` : ''}
    ${list.length ? `<div class="grid">${list.map(tile).join('')}</div>`
      : f === 'mine' && !subs.length ? '' : `<div class="empty small"><p>Rien ici pour l’instant.</p><a class="btn" href="#/add">${icon('plus')} Ajouter</a></div>`}`;
}

function tile(e) {
  const p = S.progress(e);
  const canPlus = !p.movie && e.status === 'watching' && p.next && p.nextAired;
  return `<div class="tile" data-go="#/title/${encodeURIComponent(e.id)}">
    <div class="tile-poster">${poster(e.title)}
      ${e.status === 'completed' ? `<span class="tile-done">${icon('check')}</span>` : ''}
      ${S.purchaseOnly(e) && e.status !== 'completed' ? '<span class="tile-paid">€ Achat</span>' : ''}
      ${canPlus ? plusButton(e, p, 'sm') : ''}
    </div>
    ${bar(p.pct)}
    <b class="tile-name">${esc(e.title.name)}</b>
    <span class="tile-sub"><i style="--pc:${platform(e.platform).color}"></i>${p.movie ? STATUS[e.status] : p.next && e.status !== 'planned' ? epLabel(p.next) : STATUS[e.status]}</span>
  </div>`;
}

function upRow({ e, date, days, label, name, premiere }) {
  const t = e.title;
  return `<a class="up-row" href="#/title/${encodeURIComponent(e.id)}">
    ${poster(t, 'up-poster')}
    <span class="up-info">
      <b>${esc(t.name)}</b>
      <span>${label}${name && !/^(Épisode|Episode) \d+$/i.test(name) ? ` · ${esc(name)}` : ''}</span>
      <span class="up-tags">${chip(e.platform)}${premiere ? '<span class="tag hot">Nouvelle saison</span>' : ''}</span>
    </span>
    <span class="up-when"><b>${relDay(days, date)}</b><small>${date.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' })}</small></span>
  </a>`;
}

function viewUpcoming() {
  const head = `<header class="page-head compact"><h1>À venir</h1>${ui.upcomingLoading ? '<span class="mini-spinner" aria-label="Mise à jour"></span>' : ''}</header>`;
  if (!C.live()) {
    return `${head}<div class="empty">
      <div class="empty-art">${icon('calendar')}</div>
      <h2>Les prochaines sorties de tes séries</h2>
      <p>${Auth.enabled ? 'Connecte-toi pour savoir quand sortent les prochains épisodes, saisons et films de ta bibliothèque.' : 'Disponible avec un compte Next Up.'}</p>
      ${Auth.enabled ? '<a class="btn primary" href="#/account/login">Se connecter</a>' : ''}
    </div>`;
  }
  const { items, fresh, tbd } = upcoming();
  if (!items.length && !fresh.length && !tbd.length) {
    return `${head}<div class="empty">
      <div class="empty-art">${icon('calendar')}</div>
      <h2>${ui.upcomingLoading ? 'Recherche des prochaines sorties…' : 'Rien d’annoncé pour l’instant'}</h2>
      <p>Les prochains épisodes et saisons des séries de ta bibliothèque apparaîtront ici.</p>
    </div>`;
  }
  const groups = [
    ['Aujourd’hui', items.filter((x) => x.days === 0)],
    ['Demain', items.filter((x) => x.days === 1)],
    ['Cette semaine', items.filter((x) => x.days >= 2 && x.days < 7)],
    ['Plus tard', items.filter((x) => x.days >= 7)],
  ].filter(([, list]) => list.length);

  return `${head}
    ${fresh.length ? `<section class="block first">
      <div class="block-head"><h2>Nouveaux épisodes</h2><span class="count">${fresh.length}</span></div>
      <div class="up-list">${fresh.map(({ e, days, label }) => `<a class="up-row fresh" href="#/title/${encodeURIComponent(e.id)}">
        ${poster(e.title, 'up-poster')}
        <span class="up-info"><b>${esc(e.title.name)}</b><span>${label} est disponible</span><span class="up-tags">${chip(e.platform)}</span></span>
        <span class="up-when"><b>${days === 0 ? 'Sorti aujourd’hui' : days === 1 ? 'Sorti hier' : `Il y a ${days} j`}</b></span>
      </a>`).join('')}</div>
    </section>` : ''}
    ${groups.map(([title, list], i) => `<section class="block ${i === 0 && !fresh.length ? 'first' : ''}">
      <div class="block-head"><h2>${title}</h2><span class="count">${list.length}</span></div>
      <div class="up-list">${list.map(upRow).join('')}</div>
    </section>`).join('')}
    ${tbd.length ? `<section class="block">
      <div class="block-head"><h2>Date à confirmer</h2><span class="count">${tbd.length}</span></div>
      <p class="muted block-sub">La série continue, mais la date de la suite n’est pas encore connue.</p>
      <div class="row-scroll">${tbd.map(miniPoster).join('')}</div>
    </section>` : ''}`;
}

function viewAdd() {
  return `<header class="page-head compact"><h1>Ajouter</h1>
      <p class="muted">Cherche un film ou une série${C.live() ? '' : ' (catalogue de démo)'}.</p></header>
    ${Auth.enabled && !Auth.user() ? `<p class="hint-card">${icon('search')}<span><a href="#/account/login">Connecte-toi</a> pour chercher dans tous les films et séries.</span></p>` : ''}
    <label class="search">
      ${icon('search')}
      <input id="q" type="search" placeholder="Titre, acteur, thème…" value="${esc(ui.query)}" autocomplete="off" enterkeyhint="search">
    </label>
    <div id="results">${resultsHTML()}</div>
    <button class="manual-cta" data-action="manual">
      <span class="manual-icon">${icon('plus')}</span>
      <span><b>Ajouter manuellement</b><small>Un titre introuvable ? Crée-le toi-même : nom, saisons, épisodes.</small></span>
      ${icon('back', 'flip')}
    </button>`;
}

function resultsHTML() {
  if (ui.searchError) return `<p class="muted pad">${esc(ui.searchError)}</p>`;
  if (!ui.results) return `<div class="spinner"></div>`;
  if (!ui.results.length) return `<p class="muted pad">Aucun résultat pour « ${esc(ui.query)} ». Tu peux l’ajouter manuellement ci-dessous.</p>`;
  return `${ui.query ? '' : '<h2 class="sub-title">Suggestions</h2>'}
    <div class="grid">${ui.results.map((t) => `
      <button class="tile result" data-action="pick" data-id="${esc(t.id)}">
        <div class="tile-poster">${poster(t)}${S.has(t.id) ? `<span class="tile-done">${icon('check')}</span>` : ''}</div>
        <b class="tile-name">${esc(t.name)}</b>
        <span class="tile-sub">${t.type === 'movie' ? 'Film' : 'Série'}${t.year ? ` · ${t.year}` : ''}</span>
        ${t.reason ? `<span class="tile-reason">${esc(t.reason)}</span>` : ''}
      </button>`).join('')}</div>`;
}

function viewTitle(id) {
  const e = S.get(id);
  if (!e) return `<div class="empty"><h2>Titre introuvable</h2><a class="btn" href="#/">Retour à l’accueil</a></div>`;
  const t = e.title;
  const p = S.progress(e);
  const alertTo = S.platformAlert(e, subscriptions());
  const facts = [t.year, t.type === 'tv' ? plural((t.seasons || []).length, 'saison', 'saisons') : t.runtime ? `${t.runtime} min` : null, (t.genres || []).slice(0, 2).join(', ')].filter(Boolean);

  return `<div class="detail">
    <div class="hero">${backdrop(t)}<div class="hero-fade"></div>
      <button class="icon-btn back" data-action="back" aria-label="Retour">${icon('back')}</button>
    </div>
    <div class="detail-head">
      ${poster(t, 'detail-poster')}
      <div class="detail-title">
        <span class="status s-${e.status}">${STATUS[e.status]}</span>
        <h1>${esc(t.name)}</h1>
        <p class="muted">${facts.map(esc).join(' · ')}</p>
        ${t.source === 'custom' ? `<button class="link small left" data-action="editCustom" data-id="${esc(e.id)}">Ajouté manuellement · Modifier</button>` : ''}
      </div>
    </div>
    ${t.overview ? `<p class="overview">${esc(t.overview)}</p>` : ''}

    ${alertTo ? alertCard(e, alertTo) : ''}

    ${t.type === 'tv' ? progressCardTV(e, p) : progressCardMovie(e, p)}
    ${withCard(e)}
    ${platformCard(e)}
    ${availCard(e)}
    ${statusCard(e)}
    ${t.type === 'tv' ? episodesSection(e, p) : ''}
    <button class="btn ghost danger block remove-btn" data-action="remove" data-id="${esc(e.id)}">${icon('trash')} Retirer de ma bibliothèque</button>
  </div>`;
}

function progressCardTV(e, p) {
  const names = p.next ? ui.epNames[`${e.id}|${p.next.s}`] : null;
  const epName = p.next && names ? names[p.next.e] : null;
  let head;
  if (p.finished) head = `<span class="label">Bravo</span><div class="big">Série terminée</div>`;
  else if (p.upToDate) head = `<span class="label">Tu es à jour</span><div class="big">${p.next ? `${epLabel(p.next)} bientôt` : 'Suite à venir'}</div>`;
  else head = `<span class="label">${p.nextMinutes ? 'Reprendre' : p.watched ? 'Prochain épisode' : 'Pour commencer'}</span><div class="big">${epLabel(p.next)}</div>${epName ? `<span class="epname">${esc(epName)}</span>` : ''}`;

  return `<section class="card progress-card">
    <div class="pc-top"><div>${head}</div>${plusButton(e, p, 'xl')}</div>
    ${bar(p.pct)}
    <div class="pc-meta"><span>${p.watched} / ${p.total} épisodes</span><span>${Math.round(p.pct * 100)} %</span></div>
    ${p.next && p.nextAired ? episodeMinutes(e, p) : ''}
    ${watchButton(e)}
    <button class="link" data-action="position" data-id="${esc(e.id)}">Modifier où j’en suis</button>
  </section>`;
}

// Curseur « Arrêté à … min » pour l'épisode en cours.
function episodeMinutes(e, p) {
  const runtime = epRuntime(e);
  const m = Math.min(p.nextMinutes, runtime);
  return `<div class="ep-minutes">
    <div class="ep-minutes-head">
      <span>${icon('clock')} Arrêté à <b data-out="epmin">${m} min</b></span>
      <span class="left" data-out="epleft">${leftText(m, runtime)}</span>
    </div>
    <p class="ep-minutes-sub">${epLabel(p.next)} · durée ${fmtDur(runtime)}</p>
    <input class="range" type="range" min="0" max="${runtime}" step="1" value="${m}"
      data-input="epMinutes" data-id="${esc(e.id)}" aria-label="Minutes regardées de ${epLabel(p.next)}" style="--v:${(m / runtime) * 100}%">
  </div>`;
}

function progressCardMovie(e, p) {
  const runtime = e.title.runtime || 180;
  return `<section class="card progress-card">
    <div class="pc-top">
      <div><span class="label">${p.done ? 'Film vu' : 'Progression'}</span>
        <div class="big">${p.done ? 'Terminé' : `<span data-out="mvmin">${fmtDur(e.minutes || 0)}</span>`}</div>
        ${!p.done && e.title.runtime ? `<span class="epname">sur ${fmtDur(e.title.runtime)} · <b class="left" data-out="mvleft">${leftText(e.minutes || 0, e.title.runtime)}</b></span>` : ''}</div>
      ${p.done ? '' : `<button class="plus xl done-btn" data-action="movieDone" data-id="${esc(e.id)}" aria-label="Marquer comme vu">${icon('check')}</button>`}
    </div>
    ${p.done ? bar(1) : `<input class="range" type="range" min="0" max="${runtime}" step="1" value="${e.minutes || 0}"
      data-input="minutes" data-id="${esc(e.id)}" aria-label="Minutes regardées" style="--v:${Math.round(p.pct * 100)}%">`}
    ${watchButton(e)}
  </section>`;
}

// « Regarder sur Netflix » : ouvre la plateforme (son app sur téléphone) sur le titre, ou sa recherche.
function watchButton(e) {
  const link = C.watchLink(e.title, e.platform);
  if (!link) return '';
  const pf = platform(e.platform);
  const p = S.progress(e);
  const ep = !p.movie && p.next && p.nextAired ? epLabel(p.next) : '';
  const paid = S.purchaseOnly(e) ? ' <em>(achat)</em>' : '';
  // Les plateformes ne publient pas d'identifiants d'épisodes : on ouvre la fiche du titre
  // (ou la recherche), où la plateforme propose elle-même « Reprendre » au bon épisode.
  const main = `<a class="watch-btn" href="${esc(link.url)}" target="_blank" rel="noopener" style="--pc:${pf.color}">
    ${icon('play')}<span>Regarder sur <b>${esc(pf.name)}</b>${paid}</span>${icon('external')}</a>`;
  const where = link.exact ? `Ouvre la fiche ${esc(pf.name)}` : `Ouvre la recherche ${esc(pf.name)} « ${esc(e.title.original || e.title.name)} »`;
  const sub = ep ? `${where} · épisode à reprendre : <b>${ep}</b>` : where;
  return `${main}<p class="watch-sub">${sub}</p>`;
}

// Étiquette de plateforme cliquable (fiche, disponibilités).
function watchChip(e, id, extra = '') {
  const link = C.watchLink(e.title, id);
  const inner = chip(id).replace('</span>', `${extra} ${icon('external', 'chip-ext')}</span>`);
  return link ? `<a class="chip-link" href="${esc(link.url)}" target="_blank" rel="noopener" aria-label="Ouvrir sur ${esc(platform(id).name)}">${inner}</a>` : chip(id);
}

// Carte de la fiche d'un titre : même en-tête partout (nom à gauche, action à droite).
const detailCard = (label, body, { action = '', cls = '' } = {}) => `<section class="card dcard ${cls}">
    <header class="card-head"><h3 class="label">${label}</h3>${action}</header>
    ${body}
  </section>`;
const cardButton = (text, attrs) => `<button class="btn small ghost" ${attrs}>${text}</button>`;

function withCard(e) {
  const people = e.watchedWith || [];
  return detailCard('Regardé avec',
    `<div class="chips">${people.length ? people.map(withChip).join('') : '<span class="with-chip static alone"><span>🙋</span>Juste moi</span>'}</div>`,
    { action: cardButton('Modifier', `data-action="editWith" data-id="${esc(e.id)}"`) });
}

function platformCard(e) {
  const history = e.platformHistory || [];
  const date = (ts) => new Date(ts).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' });
  const avail = e.providers;
  return detailCard('Regardé sur', `
    <div class="platform-now">${chip(e.platform)}</div>
    ${ui.editPlatform ? `<div class="pick-grid">${PLATFORMS.map((pl) =>
      `<button class="pick ${pl.id === e.platform ? 'on' : ''}" style="--pc:${pl.color}" data-action="setPlatform" data-id="${esc(e.id)}" data-p="${pl.id}"><i></i>${esc(pl.name)}${avail?.includes(pl.id) ? '<small>inclus</small>' : e.paidProviders?.includes(pl.id) ? '<small class="paid">achat</small>' : ''}</button>`).join('')}</div>
      <p class="hint">Changer de plateforme ne modifie pas ta progression.</p>` : ''}
    ${history.length > 1 ? `<ol class="timeline">${history.map((h) =>
      `<li><i style="--pc:${platform(h.platform).color}"></i><b>${esc(platform(h.platform).name)}</b><span>depuis le ${date(h.at)}</span></li>`).join('')}</ol>` : ''}`,
  { action: cardButton(ui.editPlatform ? 'Fermer' : 'Changer', 'data-action="editPlatform"') });
}

function availCard(e) {
  if (e.title.source === 'custom') return '';
  const avail = e.providers;
  const subs = subscriptions();
  const label = `Disponible en ${esc(S.settings().region)}${e.title.source === 'demo' ? ' (démo)' : ''}`;
  if (avail == null) return detailCard(label, `<p class="muted">${C.live() ? 'Recherche…' : 'Disponible avec un compte Next Up.'}</p>`);
  const mixedSeasons = avail.includes(e.platform)
    && Object.values(e.seasonAvail || {}).some((a) => a.paid.includes(e.platform) && !a.included.includes(e.platform));
  return detailCard(label, `
    ${avail.length ? `<p class="avail-kind">Inclus dans l’abonnement</p>
      <div class="chips">${avail.map((id) => watchChip(e, id, subs.includes(id) ? ` ${icon('check', 'mine')}` : '')).join('')}</div>`
      : '<p class="muted">Inclus dans aucun abonnement pour l’instant.</p>'}
    ${e.paidProviders?.length ? `<p class="avail-kind">À l’achat ou en location</p>
      <div class="chips">${e.paidProviders.map((id) => watchChip(e, id, ' <em class="paid">€</em>')).join('')}</div>` : ''}
    ${mixedSeasons ? `<p class="hint warn">Sur ${esc(platform(e.platform).name)}, certaines saisons ne sont qu’à l’achat : détail par saison dans « Épisodes ».</p>` : ''}
    ${subs.length ? `<p class="hint">${avail.some((id) => subs.includes(id)) ? `${icon('check')} Inclus dans tes abonnements`
      : e.paidProviders?.some((id) => subs.includes(id)) ? 'Sur tes plateformes, mais seulement à l’achat ou en location (en plus de l’abonnement).'
      : 'Pas inclus dans tes abonnements.'}</p>` : ''}`);
}

function statusCard(e) {
  return detailCard('Statut', `<div class="seg">${Object.entries(STATUS).map(([k, label]) =>
    `<button class="${e.status === k ? 'on' : ''}" data-action="status" data-id="${esc(e.id)}" data-status="${k}">${label}</button>`).join('')}</div>`);
}

// Où regarder la saison affichée, sur la plateforme choisie et ailleurs.
function seasonAvailLine(e, n) {
  const st = S.seasonStatus(e, n);
  if (!st) return e.title.source === 'tmdb' && C.live() && !e.seasonAvail ? '<p class="season-avail muted">Vérification des disponibilités par saison…</p>' : '';
  const a = e.seasonAvail[n];
  const pf = esc(platform(e.platform).name);
  const elsewhere = a.included.filter((id) => id !== e.platform).map((id) => platform(id).name);
  const also = elsewhere.length ? ` · incluse sur ${esc(elsewhere.join(', '))}` : '';
  if (st === 'included') return `<p class="season-avail ok">${icon('check')} Saison ${n} incluse dans l’abonnement ${pf}</p>`;
  if (st === 'paid') return `<p class="season-avail paid"><b>€</b> Saison ${n} : seulement à l’achat ou en location sur ${pf}${also}</p>`;
  const buy = a.paid.map((id) => platform(id).name);
  if (!a.included.length && !buy.length) {
    const country = { BE: 'en Belgique', FR: 'en France', CH: 'en Suisse', LU: 'au Luxembourg', CA: 'au Canada' }[S.settings().region] || 'dans ton pays';
    return `<p class="season-avail none">Saison ${n} pas encore disponible ${country}, ni en abonnement ni à l’achat</p>`;
  }
  return `<p class="season-avail none">Saison ${n} pas disponible sur ${pf}${also}${buy.length ? ` · à l’achat sur ${esc(buy.join(', '))}` : ''}</p>`;
}

function episodesSection(e, p) {
  const seasons = e.title.seasons || [];
  if (!seasons.length) return '';
  const current = ui.season[e.id] ?? p.next?.s ?? p.last?.s ?? seasons[0].n;
  const season = seasons.find((s) => s.n === current) || seasons[0];
  const names = ui.epNames[`${e.id}|${season.n}`];
  const seenIn = (s) => e.watched.filter((k) => k.startsWith(`${s.n}:`)).length;
  const allSeen = seenIn(season) === season.count;

  return detailCard('Épisodes', `
    <div class="season-tabs">${seasons.map((s) => {
      const pct = seenIn(s) / s.count;
      const st = S.seasonStatus(e, s.n);
      const flag = st === 'paid' ? '<i class="stab-flag paid" title="À l’achat">€</i>' : st === 'none' ? '<i class="stab-flag none" title="Pas sur cette plateforme">—</i>' : '';
      return `<button class="stab ${s.n === season.n ? 'on' : ''} ${pct === 1 ? 'full' : ''} ${st ? `st-${st}` : ''}" data-action="season" data-id="${esc(e.id)}" data-s="${s.n}">
        <span class="stab-n">S${s.n}${flag}</span><span class="stab-bar"><span style="width:${pct * 100}%"></span></span></button>`;
    }).join('')}</div>
    ${seasonAvailLine(e, season.n)}
    <div class="season-head">
      <span class="muted">Saison ${season.n} · ${seenIn(season)} / ${season.count} vus</span>
      <button class="link" data-action="seasonAll" data-id="${esc(e.id)}" data-s="${season.n}" data-v="${allSeen ? 0 : 1}">${allSeen ? 'Tout décocher' : 'Tout marquer vu'}</button>
    </div>
    <div class="eps">${Array.from({ length: season.count }, (_, i) => {
      const n = i + 1;
      const on = S.isWatched(e, season.n, n);
      const isNext = p.next && p.next.s === season.n && p.next.e === n;
      const aired = S.isAired(e.title, { s: season.n, e: n });
      return `<button class="ep ${on ? 'on' : ''} ${isNext ? 'next' : ''} ${aired ? '' : 'future'}" data-action="toggleEp" data-id="${esc(e.id)}" data-s="${season.n}" data-e="${n}">
        <span class="ep-n">${n}</span>
        <span class="ep-t">${names?.[n] ? esc(names[n]) : `Épisode ${n}`}</span>
        <span class="ep-c">${on ? icon('check') : isNext ? `<em>${p.nextMinutes ? `${p.nextMinutes} min` : 'Prochain'}</em>` : aired ? '' : '<em>À venir</em>'}</span>
      </button>`;
    }).join('')}</div>`, { cls: 'eps-card' });
}

function viewProfile() {
  const st = S.stats();
  const s = S.settings();
  const hours = Math.round(st.minutes / 60);
  return `<header class="page-head compact"><h1>Profil</h1></header>
    <div class="stats">
      <div class="stat"><b>${st.episodesSeen}</b><span>épisodes vus</span></div>
      <div class="stat"><b>${hours} h</b><span>devant l’écran</span></div>
      <div class="stat"><b>${st.watching}</b><span>en cours</span></div>
      <div class="stat"><b>${st.moviesSeen + st.showsDone}</b><span>terminés</span></div>
    </div>

    ${accountCard()}
    ${subsCard()}

    <section class="card">
      <label class="field first"><span>Pays (pour les plateformes disponibles)</span>
        <select data-input="region">${[['BE', 'Belgique'], ['FR', 'France'], ['CH', 'Suisse'], ['LU', 'Luxembourg'], ['CA', 'Canada']].map(([k, l]) =>
          `<option value="${k}" ${s.region === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </section>

    <section class="card">
      <div class="card-title">${icon('download')}<h3>Mes données</h3></div>
      <p class="muted">${S.syncing() ? 'Ta bibliothèque est sauvegardée dans ton compte. Tu peux aussi l’exporter dans un fichier.' : 'Ta bibliothèque est enregistrée sur cet appareil. Exporte-la pour la sauvegarder ou la transférer.'}</p>
      <div class="btn-row">
        <button class="btn" data-action="export">${icon('download')} Exporter</button>
        <label class="btn">${icon('upload')} Importer<input type="file" accept="application/json" data-input="import" hidden></label>
      </div>
      <div class="btn-row">
        ${Auth.enabled ? '' : '<button class="btn ghost" data-action="resetDemo">Recharger la démo</button>'}
        <button class="btn ghost danger" data-action="clearAll">Tout effacer</button>
      </div>
    </section>
    ${Auth.user() ? `<section class="card danger-zone">
      <div class="card-title">${icon('trash')}<h3>Supprimer mon compte</h3></div>
      <p class="muted">Ton compte, ta bibliothèque et ta progression seront effacés définitivement, sur tous tes appareils.</p>
      <button class="btn ghost danger" data-action="askDelete">Supprimer mon compte</button>
    </section>` : ''}
    <p class="credit muted">Next Up utilise l’API TMDB mais n’est ni approuvé ni certifié par TMDB.</p>`;
}

function subsCard() {
  const subs = subscriptions();
  return `<section class="card" id="abonnements">
    <div class="card-title">${icon('tv')}<h3>Mes abonnements</h3></div>
    <p class="muted">Coche les plateformes auxquelles tu es abonné : l’app te montre ce que tu peux regarder et ne t’alerte que pour tes plateformes.</p>
    <div class="pick-grid">${PLATFORMS.filter((pl) => pl.id !== 'other').map((pl) => `<button class="pick ${subs.includes(pl.id) ? 'on' : ''}"
      style="--pc:${pl.color}" data-action="toggleSub" data-p="${pl.id}" aria-pressed="${subs.includes(pl.id)}"><i></i>${esc(pl.name)}${subs.includes(pl.id) ? icon('check', 'pick-check') : ''}</button>`).join('')}</div>
    ${subs.length ? `<p class="hint ok">${icon('check')} ${plural(subs.length, 'abonnement', 'abonnements')}${Auth.user() ? ' · enregistré dans ton compte' : ''}</p>` : ''}
  </section>`;
}

function accountCard() {
  if (!Auth.enabled) {
    return `<section class="card">
      <div class="card-title">${icon('user')}<h3>Compte Next Up</h3></div>
      <p class="muted">Les comptes ne sont pas encore activés : l’app tourne en mode démo, avec un catalogue limité. Une fois le serveur configuré, tu pourras créer ton compte pour accéder à tous les films et séries et retrouver ta progression sur tous tes appareils.</p>
    </section>`;
  }
  const u = Auth.user();
  if (!u) {
    return `<section class="card">
      <div class="card-title">${icon('user')}<h3>Compte Next Up</h3></div>
      <p class="muted">Crée ton compte gratuit pour accéder à tous les films et séries, voir où ils sont disponibles et retrouver ta progression sur tous tes appareils.</p>
      <div class="btn-row">
        <a class="btn primary" href="#/account/signup">Créer un compte</a>
        <a class="btn" href="#/account/login">Se connecter</a>
      </div>
    </section>`;
  }
  const name = Auth.displayName();
  if (ui.editName) {
    return `<section class="card">
      <form class="name-form" data-form="name">
        <label class="field first"><span>Prénom</span>
          <input name="name" value="${esc(name)}" autocomplete="given-name" maxlength="40" required></label>
        <p class="form-error" hidden></p>
        <div class="btn-row">
          <button class="btn ghost" type="button" data-action="editName">Annuler</button>
          <button class="btn primary" type="submit">Enregistrer</button>
        </div>
      </form>
    </section>`;
  }
  return `<section class="card account">
    <span class="avatar">${esc(name.slice(0, 1).toUpperCase())}</span>
    <div class="account-info">
      <span class="name-row"><b>${esc(name)}</b>
        <button class="link small" data-action="editName">Modifier</button></span>
      <span class="muted">${esc(u.email)}</span>
      <span class="hint ok">${icon('check')} Catalogue complet · bibliothèque synchronisée</span>
      <a class="link small left" href="#/account/new-password">Changer mon mot de passe</a></div>
    <button class="btn small ghost" data-action="signOut">Déconnexion</button>
  </section>`;
}

const PERKS = ['Tous les films et séries, avec leurs affiches', 'Ta progression sur téléphone et ordinateur', 'Une alerte quand une série change de plateforme'];

function viewAccount(mode) {
  if (!Auth.enabled) {
    return `<div class="empty"><h2>Comptes pas encore activés</h2><p>Le serveur Next Up n’est pas encore configuré. L’app fonctionne en mode démo.</p><a class="btn" href="#/">Retour à l’accueil</a></div>`;
  }
  if (mode === 'new-password') return viewNewPassword();
  if (Auth.user()) {
    return `<div class="empty"><h2>Tu es connecté</h2><p>${esc(Auth.user().email)}</p><a class="btn primary" href="#/">Aller à l’accueil</a></div>`;
  }
  const signup = mode === 'signup';
  const reset = mode === 'reset';
  const notice = ui.authNotice;
  ui.authNotice = null;
  const title = signup ? 'Crée ton compte' : reset ? 'Mot de passe oublié' : 'Bon retour !';
  const sub = signup ? 'Gratuit, en 30 secondes.' : reset ? 'Indique ton e-mail, on t’envoie un lien pour choisir un nouveau mot de passe.' : 'Connecte-toi pour retrouver ta bibliothèque.';
  return `<div class="auth">
    <button class="icon-btn" data-action="back" aria-label="Retour">${icon('back')}</button>
    <div class="auth-head">${logo('big')}<h1>${title}</h1><p class="muted">${sub}</p></div>
    ${notice ? `<p class="notice ${ui.authWarn ? 'warn' : ''}">${esc(notice)}</p>` : ''}
    ${reset ? '' : `<div class="seg auth-tabs">
      <a href="#/account/signup" class="${signup ? 'on' : ''}">Créer un compte</a>
      <a href="#/account/login" class="${signup ? '' : 'on'}">Se connecter</a></div>`}
    <form class="auth-form" data-form="auth" data-mode="${signup ? 'signup' : reset ? 'reset' : 'login'}" novalidate>
      ${signup ? '<label class="field"><span>Prénom</span><input name="name" autocomplete="given-name" required></label>' : ''}
      <label class="field"><span>E-mail</span><input name="email" type="email" autocomplete="email" inputmode="email" required></label>
      ${reset ? '' : `<label class="field"><span>Mot de passe</span><input name="password" type="password" minlength="6" autocomplete="${signup ? 'new-password' : 'current-password'}" required>${signup ? '<small>6 caractères minimum</small>' : ''}</label>`}
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">${signup ? 'Créer mon compte' : reset ? 'Envoyer le lien' : 'Se connecter'}</button>
    </form>
    ${mode === 'login' || !mode ? '<a class="link center" href="#/account/reset">Mot de passe oublié ?</a>' : ''}
    ${reset ? '<a class="link center" href="#/account/login">Retour à la connexion</a>' : ''}
    ${signup ? `<ul class="perks">${PERKS.map((p) => `<li>${icon('check')}${p}</li>`).join('')}</ul>` : ''}
  </div>`;
}

// Choix d'un nouveau mot de passe : après le lien « mot de passe oublié », ou depuis Profil.
function viewNewPassword() {
  if (!Auth.user()) {
    return `<div class="auth">
      <div class="auth-head">${logo('big')}<h1>Lien expiré</h1>
        <p class="muted">Ce lien n’est plus valable. Demande un nouveau lien pour choisir ton mot de passe.</p></div>
      <a class="btn primary block" href="#/account/reset">Recevoir un nouveau lien</a>
    </div>`;
  }
  const fromEmail = Auth.isRecovery();
  return `<div class="auth">
    ${fromEmail ? '' : `<button class="icon-btn" data-action="back" aria-label="Retour">${icon('back')}</button>`}
    <div class="auth-head">${logo('big')}<h1>Nouveau mot de passe</h1>
      <p class="muted">${fromEmail ? 'Choisis ton nouveau mot de passe pour' : 'Compte'} ${esc(Auth.user().email)}</p></div>
    <form class="auth-form" data-form="newpass" novalidate>
      <label class="field"><span>Nouveau mot de passe</span><input name="password" type="password" minlength="6" autocomplete="new-password" required><small>6 caractères minimum</small></label>
      <label class="field"><span>Confirme le mot de passe</span><input name="confirm" type="password" minlength="6" autocomplete="new-password" required></label>
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Enregistrer le mot de passe</button>
    </form>
  </div>`;
}

// ——— Feuille d'ajout / de position ———

function openAddSheet(title) {
  const existing = S.get(title.id);
  ui.sheet = { mode: 'add', title, platform: null, status: 'watching', s: 1, e: 1, minutes: 0, providers: title.providers || null, loading: title.source === 'tmdb', existing: Boolean(existing) };
  ui.sheet.platform = preferredPlatform(ui.sheet.providers);
  renderSheet();
  if (title.source === 'tmdb') {
    const s = S.settings();
    Promise.all([C.details(title, s), C.providers(title, s).catch(() => null)])
      .then(([full, prov]) => {
        if (ui.sheet?.title.id !== title.id) return;
        Object.assign(ui.sheet, { title: full, providers: prov?.included ?? null, paid: prov?.paid ?? [], loading: false });
        if (prov) ui.sheet.platform = preferredPlatform(prov.included, prov.paid);
        renderSheet();
      })
      .catch(() => {
        if (ui.sheet) Object.assign(ui.sheet, { loading: false, error: 'Impossible de charger les détails (clé TMDB ?).' });
        renderSheet();
      });
  }
}

// Plateforme proposée : disponible ET dans les abonnements, sinon disponible, sinon un abonnement.
function preferredPlatform(providers, paid = []) {
  const subs = subscriptions();
  return providers?.find((p) => subs.includes(p)) || providers?.[0]
    || paid.find((p) => subs.includes(p)) || paid[0] || subs[0] || 'netflix';
}

function openPositionSheet(entry) {
  const p = S.progress(entry);
  const next = p.next || p.last || { s: 1, e: 1 };
  ui.sheet = { mode: 'position', title: entry.title, entryId: entry.id, s: next.s, e: next.e, minutes: p.nextMinutes || 0 };
  renderSheet();
}

// Confirmation dans le style de l'app (les fenêtres confirm() du navigateur sont bloquées dans certaines apps).
function askConfirm({ title, text, confirm, danger = false }) {
  return new Promise((resolve) => {
    ui.sheet = { mode: 'confirm', title, text, confirm, danger, resolve };
    renderSheet();
  });
}

function closeSheet() {
  ui.sheet?.resolve?.(false);
  const root = $('#sheet');
  root.classList.remove('open');
  ui.sheet = null;
  setTimeout(() => { if (!ui.sheet) root.innerHTML = ''; }, 250);
}

function stepper(field, value, label) {
  return `<div class="stepper"><span>${label}</span>
    <div class="stepper-ctl">
      <button data-action="step" data-f="${field}" data-d="-1" aria-label="Moins">${icon('minus')}</button>
      <b>${value}</b>
      <button data-action="step" data-f="${field}" data-d="1" aria-label="Plus">${icon('plus')}</button>
    </div></div>`;
}

function positionPicker(sh) {
  if (sh.loading) return `<div class="spinner"></div>`;
  const seasons = sh.title.seasons || [];
  if (!seasons.length) return `<p class="muted">Épisodes indisponibles pour ce titre.</p>`;
  const season = seasons.find((x) => x.n === sh.s) || seasons[0];
  return `<div class="steppers">${stepper('s', season.n, 'Saison')}${stepper('e', sh.e, `Épisode <small>/ ${season.count}</small>`)}</div>
    <p class="hint">${sh.s === seasons[0].n && sh.e === 1 ? 'Tu commences au tout début.' : `Les épisodes avant ${epLabel(sh)} seront marqués comme vus.`}</p>`;
}

function openManualSheet(entry) {
  const t = entry?.title;
  ui.sheet = {
    mode: 'manual',
    editId: entry?.id || null,
    form: {
      type: t?.type || 'tv',
      name: t?.name || ui.query.trim(),
      year: t?.year || '',
      seasons: t?.seasons?.map((s) => s.count) || [10],
      ended: Boolean(t?.ended),
      runtime: t?.runtime || '',
    },
  };
  renderSheet();
  setTimeout(() => $('[data-mf=name]')?.focus(), 350);
}

function manualForm(sh) {
  const f = sh.form;
  const tv = f.type === 'tv';
  return `<h3 class="sheet-title">${sh.editId ? 'Modifier le titre' : 'Ajouter manuellement'}</h3>
    <p class="muted">${sh.editId ? 'Ta progression est conservée.' : 'Pour un titre absent du catalogue.'}</p>
    <div class="sheet-sec"><h4>Type</h4>
      <div class="seg">${[['tv', 'Série'], ['movie', 'Film']].map(([k, l]) =>
        `<button class="${f.type === k ? 'on' : ''}" data-action="mfType" data-type="${k}" ${sh.editId ? 'disabled' : ''}>${l}</button>`).join('')}</div>
    </div>
    <div class="mf-grid">
      <label class="field"><span>Titre</span><input data-mf="name" value="${esc(f.name)}" maxlength="80" placeholder="${tv ? 'Ma série' : 'Mon film'}" autocomplete="off"></label>
      <label class="field mf-year"><span>Année</span><input data-mf="year" value="${esc(f.year)}" inputmode="numeric" maxlength="4" placeholder="2024"></label>
    </div>
    ${tv ? `<div class="sheet-sec"><h4>Saisons et épisodes</h4>
      <div class="mf-seasons">${f.seasons.map((count, i) => `<div class="mf-season">
        <span>Saison ${i + 1}</span>
        <div class="stepper-ctl">
          <button data-action="mfEp" data-i="${i}" data-d="-1" aria-label="Moins d’épisodes">${icon('minus')}</button>
          <b>${count}</b><small>ép.</small>
          <button data-action="mfEp" data-i="${i}" data-d="1" aria-label="Plus d’épisodes">${icon('plus')}</button>
        </div>
        ${f.seasons.length > 1 && i === f.seasons.length - 1 ? `<button class="icon-btn mf-remove" data-action="mfRemoveSeason" aria-label="Retirer la saison">${icon('x')}</button>` : '<span class="mf-remove"></span>'}
      </div>`).join('')}</div>
      <button class="btn ghost small mf-add" data-action="mfAddSeason">${icon('plus')} Ajouter une saison</button>
      <label class="toggle"><input type="checkbox" data-mf="ended" ${f.ended ? 'checked' : ''}><span></span>Série terminée (plus de nouvelle saison)</label>
    </div>` : `<label class="field"><span>Durée (minutes)</span><input data-mf="runtime" value="${esc(f.runtime)}" inputmode="numeric" maxlength="3" placeholder="120"></label>`}
    <p class="form-error" hidden></p>
    <button class="btn primary block" data-action="mfSubmit">${sh.editId ? 'Enregistrer' : 'Continuer'}</button>`;
}

function renderSheet() {
  const root = $('#sheet');
  const sh = ui.sheet;
  if (!sh) return;
  if (sh.mode === 'manual') return showSheet(root, manualForm(sh), sh.editId ? 'Modifier le titre' : 'Ajouter manuellement');
  if (sh.mode === 'confirm') {
    return showSheet(root, `<div class="confirm-box">
        <h3 class="sheet-title">${esc(sh.title)}</h3>
        <p class="muted">${esc(sh.text)}</p></div>
      <button class="btn ${sh.danger ? 'danger-solid' : 'primary'} block" data-action="confirmYes">${esc(sh.confirm)}</button>
      <button class="btn ghost block" data-action="closeSheet">Annuler</button>`, sh.title);
  }
  if (sh.mode === 'with') {
    const used = S.entries().flatMap((x) => x.watchedWith || []);
    const options = [...new Set([...COMPANIONS.map(([n]) => n), ...used, ...sh.people])];
    return showSheet(root, `<h3 class="sheet-title">Tu regardes avec qui ?</h3>
      <p class="muted">Pratique si tu suis la même série avec différentes personnes. Tu peux en choisir plusieurs.</p>
      <div class="with-grid">
        <button class="with-chip ${sh.people.length ? '' : 'on'}" data-action="withAlone"><span>🙋</span>Juste moi</button>
        ${options.map((n) => `<button class="with-chip ${sh.people.includes(n) ? 'on' : ''}" data-action="withToggle" data-v="${esc(n)}"><span>${companionEmoji(n)}</span>${esc(n)}</button>`).join('')}
      </div>
      <form class="with-add" data-form="withAdd">
        <input name="who" maxlength="24" placeholder="Autre : un prénom, un groupe…" autocomplete="off">
        <button class="btn" type="submit">${icon('plus')} Ajouter</button>
      </form>
      <button class="btn primary block" data-action="withSave">Enregistrer</button>`, 'Regardé avec');
  }
  if (sh.mode === 'delete') {
    return showSheet(root, `<div class="delete-head"><span class="delete-icon">${icon('trash')}</span>
        <h3 class="sheet-title">Supprimer ton compte ?</h3>
        <p class="muted">C’est définitif : ton compte <b>${esc(Auth.user()?.email || '')}</b>, ta bibliothèque, ta progression et tes abonnements seront effacés. Impossible de revenir en arrière.</p></div>
      <label class="field"><span>Pour confirmer, tape <b>SUPPRIMER</b></span>
        <input data-input="deleteConfirm" value="${esc(sh.confirm || '')}" autocomplete="off" autocapitalize="characters" placeholder="SUPPRIMER"></label>
      <p class="form-error" ${sh.error ? '' : 'hidden'}>${esc(sh.error || '')}</p>
      <button class="btn danger-solid block" data-action="confirmDelete" ${sh.confirm?.trim().toUpperCase() === 'SUPPRIMER' && !sh.busy ? '' : 'disabled'}>${sh.busy ? 'Suppression…' : 'Supprimer définitivement'}</button>
      <button class="btn ghost block" data-action="closeSheet">Annuler</button>`, 'Supprimer mon compte');
  }
  const t = sh.title;
  let body;

  if (sh.mode === 'position') {
    body = `<h3 class="sheet-title">Où en es-tu ?</h3>
      <p class="muted">Indique le prochain épisode que tu vas regarder.</p>
      ${positionPicker(sh)}
      <div class="sheet-sec"><h4>Déjà regardé de cet épisode : <b data-out="posmin">${sh.minutes}</b> min · <span class="left" data-out="posleft">${leftText(sh.minutes, t.runtime || 60)}</span></h4>
        <input class="range" type="range" min="0" max="${t.runtime || 60}" value="${sh.minutes}" data-input="posMinutes"
          style="--v:${(sh.minutes / (t.runtime || 60)) * 100}%"></div>
      <button class="btn primary block" data-action="savePosition">Enregistrer</button>`;
  } else if (sh.existing) {
    body = `${sheetHead(t)}<p class="muted">Ce titre est déjà dans ta bibliothèque.</p>
      <a class="btn primary block" href="#/title/${encodeURIComponent(t.id)}" data-action="closeSheet">Ouvrir la fiche</a>`;
  } else {
    const statuses = t.type === 'tv'
      ? [['watching', 'Je regarde'], ['planned', 'À voir'], ['completed', 'Déjà vue']]
      : [['planned', 'À voir'], ['watching', 'En cours'], ['completed', 'Déjà vu']];
    body = `${sheetHead(t)}
      ${sh.error ? `<p class="hint warn">${esc(sh.error)}</p>` : ''}
      <div class="sheet-sec"><h4>Tu regardes sur</h4>
        <div class="pick-grid">${PLATFORMS.map((pl) => `<button class="pick ${sh.platform === pl.id ? 'on' : ''}" style="--pc:${pl.color}" data-action="sheetPlatform" data-p="${pl.id}">
          <i></i>${esc(pl.name)}${sh.providers?.includes(pl.id) ? '<small>inclus</small>' : sh.paid?.includes(pl.id) ? '<small class="paid">achat</small>' : ''}</button>`).join('')}</div>
        ${sh.paid?.includes(sh.platform) && !sh.providers?.includes(sh.platform) ? `<p class="hint warn">Sur ${esc(platform(sh.platform).name)}, ce titre n’est pas inclus dans l’abonnement : seulement à l’achat ou en location.</p>` : ''}
      </div>
      <div class="sheet-sec"><h4>Statut</h4>
        <div class="seg">${statuses.map(([k, l]) => `<button class="${sh.status === k ? 'on' : ''}" data-action="sheetStatus" data-status="${k}">${l}</button>`).join('')}</div>
      </div>
      ${sh.status === 'watching' && t.type === 'tv' ? `<div class="sheet-sec"><h4>Prochain épisode à voir</h4>${positionPicker(sh)}</div>` : ''}
      ${sh.status === 'watching' && t.type === 'movie' ? `<div class="sheet-sec"><h4>Déjà regardé : <b data-out="minutes">${sh.minutes}</b> min${t.runtime ? ` · <span class="left" data-out="sheetleft">${leftText(sh.minutes, t.runtime)}</span>` : ''}</h4>
        <input class="range" type="range" min="0" max="${t.runtime || 180}" value="${sh.minutes}" data-input="sheetMinutes" style="--v:${(sh.minutes / (t.runtime || 180)) * 100}%"></div>` : ''}
      <button class="btn primary block" data-action="sheetSave" ${sh.loading ? 'disabled' : ''}>Ajouter à ma bibliothèque</button>`;
  }

  showSheet(root, body, t.name);
}

function showSheet(root, body, label) {
  const scroll = root.querySelector('.sheet')?.scrollTop || 0;
  root.innerHTML = `<div class="sheet-backdrop" data-action="closeSheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">
      <div class="grab"></div>
      <button class="icon-btn sheet-close" data-action="closeSheet" aria-label="Fermer">${icon('x')}</button>
      ${body}
    </div>`;
  root.querySelector('.sheet').scrollTop = scroll;
  requestAnimationFrame(() => root.classList.add('open'));
}

const sheetHead = (t) => `<div class="sheet-head">${poster(t, 'sheet-poster')}
  <div><span class="tag">${t.type === 'movie' ? 'Film' : 'Série'}${t.year ? ` · ${t.year}` : ''}</span>
  <h3 class="sheet-title">${esc(t.name)}</h3>
  ${t.overview ? `<p class="muted clamp">${esc(t.overview)}</p>` : ''}</div></div>`;

// ——— Notifications ———

let toastTimer;
function toast(message, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${message}</span>${undo ? '<button type="button">Annuler</button>' : ''}`;
  el.classList.add('show');
  if (undo) el.querySelector('button').onclick = () => { undo(); hideToast(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4500);
}
const hideToast = () => $('#toast').classList.remove('show');

// ——— Actions ———

const actions = {
  plus({ id }) {
    ui.bumped = id;
    const r = S.plusOne(id);
    if (!r) return;
    navigator.vibrate?.(12);
    const name = esc(r.before.title.name);
    toast(r.completed ? `🎉 <b>${name}</b> terminée !` : `<b>${epLabel(r.ep)}</b> vu · ${name}`, () => S.restore(r.before));
    setTimeout(() => { ui.bumped = null; }, 600);
  },
  movieDone({ id }) {
    const before = JSON.parse(JSON.stringify(S.get(id)));
    S.setStatus(id, 'completed');
    toast(`<b>${esc(before.title.name)}</b> marqué comme vu`, () => S.restore(before));
  },
  toggleEp({ id, s, e }) { S.toggleEpisode(id, +s, +e); },
  season({ id, s }) { ui.season[id] = +s; render(); loadEpisodeNames(S.get(id), +s); },
  seasonAll({ id, s, v }) { S.setSeason(id, +s, v === '1'); },
  editPlatform() { ui.editPlatform = !ui.editPlatform; render(); },
  setPlatform({ id, p }) {
    const prev = S.get(id).platform;
    ui.editPlatform = false;
    S.setPlatform(id, p);
    if (prev !== p) toast(`Désormais sur <b>${esc(platform(p).name)}</b> · progression conservée`);
  },
  switchPlatform({ id, p }) { actions.setPlatform({ id, p }); },
  ackAlert({ id }) { S.ackAlert(id); },
  status({ id, status }) { S.setStatus(id, status); },
  remove({ id }) {
    const before = JSON.parse(JSON.stringify(S.get(id)));
    location.hash = '#/library';
    S.remove(id);
    toast(`<b>${esc(before.title.name)}</b> retiré`, () => S.restore(before));
  },
  position({ id }) { openPositionSheet(S.get(id)); },
  libFilter({ f }) { ui.libFilter = f; render(); },
  back() { if (history.length > 1) history.back(); else location.hash = '#/'; },
  pick({ id }) { openAddSheet(ui.resultsById[id]); },
  closeSheet() { closeSheet(); },
  sheetPlatform({ p }) { ui.sheet.platform = p; renderSheet(); },
  sheetStatus({ status }) { ui.sheet.status = status; renderSheet(); },
  step({ f, d }) {
    const sh = ui.sheet;
    const seasons = sh.title.seasons || [];
    const idx = seasons.findIndex((x) => x.n === sh.s);
    if (f === 's') {
      const next = seasons[Math.min(Math.max(idx + +d, 0), seasons.length - 1)];
      sh.s = next.n;
      sh.e = Math.min(sh.e, next.count);
    } else {
      const count = seasons[idx]?.count || 1;
      const e = sh.e + +d;
      if (e > count && idx < seasons.length - 1) { sh.s = seasons[idx + 1].n; sh.e = 1; }
      else if (e < 1 && idx > 0) { sh.s = seasons[idx - 1].n; sh.e = seasons[idx - 1].count; }
      else sh.e = Math.min(Math.max(e, 1), count);
    }
    renderSheet();
  },
  sheetSave() {
    const sh = ui.sheet;
    S.add(sh.title, { platform: sh.platform, status: sh.status, next: { s: sh.s, e: sh.e }, minutes: sh.minutes });
    if (sh.providers && sh.title.source === 'tmdb') {
      S.setProviders(sh.title.id, sh.providers, sh.paid || []);
      // Disponibilité connue au moment de l'ajout : on n'alertera que si elle change ensuite.
      S.ackAlert(sh.title.id);
    }
    closeSheet();
    toast(`<b>${esc(sh.title.name)}</b> ajouté`);
    location.hash = `#/title/${encodeURIComponent(sh.title.id)}`;
  },
  savePosition() {
    const sh = ui.sheet;
    S.setPosition(sh.entryId, { s: sh.s, e: sh.e }, sh.minutes);
    closeSheet();
    toast(`Position mise à jour · ${sh.minutes ? `reprise de <b>${epLabel(sh)}</b> à ${sh.minutes} min` : `prochain <b>${epLabel(sh)}</b>`}`);
  },
  export() {
    const blob = new Blob([S.exportData()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `next-up-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  editWith({ id }) {
    ui.sheet = { mode: 'with', entryId: id, people: [...(S.get(id).watchedWith || [])] };
    renderSheet();
  },
  withAlone() { ui.sheet.people = []; renderSheet(); },
  withToggle({ v }) {
    const people = ui.sheet.people;
    ui.sheet.people = people.includes(v) ? people.filter((x) => x !== v) : [...people, v];
    renderSheet();
  },
  withSave() {
    const { entryId, people } = ui.sheet;
    S.setWatchedWith(entryId, people);
    closeSheet();
    toast(people.length ? `Regardé avec <b>${esc(withText(people))}</b>` : 'Regardé <b>juste par toi</b>');
  },
  askDelete() {
    ui.sheet = { mode: 'delete', confirm: '' };
    renderSheet();
    setTimeout(() => $('[data-input=deleteConfirm]')?.focus(), 350);
  },
  async confirmDelete() {
    const sh = ui.sheet;
    if (sh.confirm.trim().toUpperCase() !== 'SUPPRIMER') return;
    sh.busy = true;
    sh.error = null;
    renderSheet();
    try {
      await Auth.deleteAccount();
      closeSheet();
      S.updateSettings({ subscriptions: [] });
      location.hash = '#/';
      toast('Ton compte a été supprimé');
    } catch (e) {
      sh.busy = false;
      sh.error = e.message;
      renderSheet();
    }
  },
  toggleSub({ p }) {
    const subs = subscriptions();
    const next = subs.includes(p) ? subs.filter((x) => x !== p) : [...subs, p];
    S.updateSettings({ subscriptions: next });
    if (Auth.user()) Auth.updateMeta({ subscriptions: next }).catch(() => toast('Abonnements enregistrés sur cet appareil seulement'));
  },
  manual() { openManualSheet(null); },
  openSearch() { openFinder(); },
  closeFinder() { closeFinder(); },
  finderOpen({ id }) { closeFinder(); location.hash = `#/title/${encodeURIComponent(id)}`; },
  finderAdd({ id }) { closeFinder(); openAddSheet(finder.byId[id]); },
  finderManual() { closeFinder(); ui.query = finder.q; openManualSheet(null); },
  editCustom({ id }) { openManualSheet(S.get(id)); },
  mfType({ type }) { ui.sheet.form.type = type; renderSheet(); },
  mfEp({ i, d }) {
    const s = ui.sheet.form.seasons;
    s[i] = Math.min(Math.max(s[i] + +d, 1), 99);
    renderSheet();
  },
  mfAddSeason() {
    const s = ui.sheet.form.seasons;
    s.push(s[s.length - 1] || 10);
    renderSheet();
  },
  mfRemoveSeason() { ui.sheet.form.seasons.pop(); renderSheet(); },
  mfSubmit() {
    const sh = ui.sheet;
    const f = sh.form;
    const name = f.name.trim();
    const error = $('.sheet .form-error');
    if (!name) {
      error.textContent = 'Indique le titre.';
      error.hidden = false;
      return;
    }
    const year = parseInt(f.year, 10);
    const patch = {
      name, original: name,
      year: year >= 1888 && year <= 2100 ? year : null,
      palette: C.paletteFor(name),
    };
    if (f.type === 'tv') {
      patch.seasons = f.seasons.map((count, i) => ({ n: i + 1, count }));
      patch.ended = f.ended;
    } else {
      patch.runtime = parseInt(f.runtime, 10) || null;
    }
    if (sh.editId) {
      S.editTitle(sh.editId, patch);
      closeSheet();
      toast(`<b>${esc(name)}</b> mis à jour`);
      return;
    }
    const id = `custom-${f.type}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    openAddSheet({ id, source: 'custom', type: f.type, overview: '', genres: [], ...patch });
  },
  editName() {
    ui.editName = !ui.editName;
    render();
    if (ui.editName) $('[data-form=name] input')?.select();
  },
  async signOut() {
    const ok = await askConfirm({ title: 'Te déconnecter ?', text: 'Ta bibliothèque reste sauvegardée dans ton compte. Tu la retrouveras en te reconnectant.', confirm: 'Me déconnecter' });
    if (!ok) return;
    await Auth.signOut();
    location.hash = '#/';
    toast('Tu es déconnecté');
  },
  async resetDemo() {
    if (await askConfirm({ title: 'Recharger la démo ?', text: 'Ta bibliothèque sur cet appareil sera remplacée par les titres de démonstration.', confirm: 'Recharger' })) {
      S.resetDemo();
      toast('Démo rechargée');
    }
  },
  async clearAll() {
    if (await askConfirm({ title: 'Tout effacer ?', text: 'Toute ta bibliothèque et ta progression seront effacées. Cette action est définitive.', confirm: 'Tout effacer', danger: true })) {
      S.clearLibrary();
      toast('Bibliothèque vidée');
    }
  },
  confirmYes() { const r = ui.sheet.resolve; ui.sheet.resolve = null; closeSheet(); r?.(true); },
};

document.addEventListener('click', (ev) => {
  const a = ev.target.closest('[data-action]');
  if (a) {
    if (a.tagName !== 'A') ev.preventDefault();
    ev.stopPropagation();
    actions[a.dataset.action]?.(a.dataset, a);
    return;
  }
  const go = ev.target.closest('[data-go]');
  if (go) location.hash = go.dataset.go;
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.id === 'q') {
    ui.query = el.value;
    runSearch();
    return;
  }
  if (el.id === 'finder-q') {
    finder.q = el.value;
    runFinder();
    return;
  }
  if (el.dataset.input === 'deleteConfirm' && ui.sheet?.mode === 'delete') {
    ui.sheet.confirm = el.value;
    const ok = el.value.trim().toUpperCase() === 'SUPPRIMER';
    $('[data-action=confirmDelete]').disabled = !ok;
    return;
  }
  if (el.dataset.mf && ui.sheet?.form) {
    ui.sheet.form[el.dataset.mf] = el.type === 'checkbox' ? el.checked : el.value;
    return;
  }
  const kind = el.dataset.input;
  const setOut = (name, text) => { const out = $(`[data-out="${name}"]`); if (out) out.textContent = text; };
  if (kind === 'epMinutes') {
    setOut('epmin', `${el.value} min`);
    setOut('epleft', leftText(+el.value, +el.max));
  }
  if (kind === 'minutes') {
    setOut('mvmin', fmtDur(+el.value));
    setOut('mvleft', leftText(+el.value, +el.max));
  }
  if (kind === 'posMinutes') {
    ui.sheet.minutes = +el.value;
    $('[data-out="posmin"]').textContent = el.value;
    setOut('posleft', leftText(+el.value, +el.max));
  }
  if (kind === 'minutes' || kind === 'sheetMinutes' || kind === 'epMinutes' || kind === 'posMinutes') el.style.setProperty('--v', `${(el.value / el.max) * 100}%`);
  if (kind === 'sheetMinutes') {
    ui.sheet.minutes = +el.value;
    $('[data-out="minutes"]').textContent = el.value;
    setOut('sheetleft', leftText(+el.value, +el.max));
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  const kind = el.dataset.input;
  if (kind === 'minutes') S.setMinutes(el.dataset.id, +el.value);
  if (kind === 'epMinutes') S.setEpisodeMinutes(el.dataset.id, +el.value);
  if (kind === 'region') {
    S.updateSettings({ region: el.value });
    refreshLibrary(true);
  }
  if (kind === 'import' && el.files[0]) {
    el.files[0].text().then((txt) => {
      try { S.importData(txt); toast('Bibliothèque importée'); } catch { toast('Fichier invalide'); }
    });
  }
});

document.addEventListener('submit', (ev) => {
  const form = ev.target;
  if (form.dataset.form !== 'withAdd') return;
  ev.preventDefault();
  const raw = String(new FormData(form).get('who') || '').trim();
  if (!raw || !ui.sheet) return;
  const name = raw.charAt(0).toUpperCase() + raw.slice(1);
  if (!ui.sheet.people.includes(name)) ui.sheet.people.push(name);
  renderSheet();
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target;
  if (form.dataset.form !== 'newpass') return;
  ev.preventDefault();
  const data = new FormData(form);
  const password = String(data.get('password') || '');
  const error = form.querySelector('.form-error');
  const fail = (message) => { error.textContent = message; error.hidden = false; };
  error.hidden = true;
  if (password.length < 6) return fail('Le mot de passe doit faire au moins 6 caractères.');
  if (password !== data.get('confirm')) return fail('Les deux mots de passe ne sont pas identiques.');
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  try {
    await Auth.updatePassword(password);
    location.hash = '#/';
    toast('Mot de passe enregistré');
  } catch (e) {
    fail(e.message);
    button.disabled = false;
  }
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target;
  if (form.dataset.form !== 'name') return;
  ev.preventDefault();
  const name = String(new FormData(form).get('name') || '').trim();
  const error = form.querySelector('.form-error');
  if (!name) {
    error.textContent = 'Indique ton prénom.';
    error.hidden = false;
    return;
  }
  form.querySelector('[type=submit]').disabled = true;
  try {
    await Auth.updateName(name);
    ui.editName = false;
    render();
    toast(`Prénom mis à jour · <b>${esc(name)}</b>`);
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
    form.querySelector('[type=submit]').disabled = false;
  }
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target;
  if (form.dataset.form !== 'auth') return;
  ev.preventDefault();
  const mode = form.dataset.mode;
  const data = new FormData(form);
  const email = String(data.get('email') || '').trim();
  const password = String(data.get('password') || '');
  const name = String(data.get('name') || '').trim();
  const error = form.querySelector('.form-error');
  const button = form.querySelector('[type=submit]');
  const fail = (message) => { error.textContent = message; error.hidden = false; };

  error.hidden = true;
  if (mode === 'signup' && !name) return fail('Indique ton prénom.');
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail('Cette adresse e-mail n’est pas valide.');
  if (mode !== 'reset' && password.length < 6) return fail('Le mot de passe doit faire au moins 6 caractères.');

  button.disabled = true;
  try {
    if (mode === 'login') await Auth.signIn(email, password);
    else if (mode === 'signup') {
      if ((await Auth.signUp(email, password, name)) === 'confirm-email') {
        ui.authNotice = `Presque fini ! Clique sur le lien envoyé à ${email}, puis connecte-toi.`;
        location.hash = '#/account/login';
      }
    } else {
      await Auth.resetPassword(email);
      ui.authNotice = `Si un compte existe pour ${email}, un e-mail vient d’être envoyé. Ouvre le lien qu’il contient pour choisir un nouveau mot de passe.`;
      ui.authWarn = false;
      location.hash = '#/account/login';
    }
  } catch (e) {
    fail(e.message);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && ui.sheet) closeSheet();
  else if (ev.key === 'Escape' && !$('#finder').hidden) closeFinder();
  else if (ev.key === '/' && !/input|textarea|select/i.test(ev.target.tagName) && !ui.sheet) {
    ev.preventDefault();
    openFinder();
  }
});

// ——— Recherche ———

let searchTimer;
let searchSeq = 0;
let searchAbort = null;

function showResults(res) {
  ui.results = res;
  ui.resultsById = Object.fromEntries(res.map((t) => [t.id, t]));
  const box = $('#results');
  if (box) {
    box.innerHTML = resultsHTML();
    box.classList.remove('loading');
  }
}

function runSearch() {
  clearTimeout(searchTimer);
  const q = ui.query.trim();
  const s = S.settings();
  // Déjà cherché : affichage immédiat, sans attendre.
  const cached = q && C.cachedSearch(q, s);
  if (cached) {
    searchAbort?.abort();
    ui.searchError = null;
    showResults(cached);
    return;
  }
  // Les anciens résultats restent visibles (atténués) pendant la recherche.
  $('#results')?.classList.toggle('loading', Boolean(ui.results));
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    searchAbort?.abort();
    searchAbort = new AbortController();
    ui.searchError = null;
    try {
      const res = q ? await C.search(q, s, searchAbort.signal) : await C.suggestions(s);
      if (seq === searchSeq) showResults(res);
    } catch (e) {
      if (e.name === 'AbortError' || seq !== searchSeq) return;
      ui.searchError = 'La recherche a échoué. Réessaie dans un instant.';
      showResults([]);
    }
  }, q ? 150 : 0);
}

// ——— Données TMDB en arrière-plan ———

async function loadEpisodeNames(entry, season) {
  if (!entry || entry.title.source !== 'tmdb') return;
  const key = `${entry.id}|${season}`;
  if (ui.epNames[key] || ui.loading.has(key)) return;
  ui.loading.add(key);
  try {
    ui.epNames[key] = await C.seasonEpisodes(entry.title, season, S.settings());
    render();
  } catch { /* noms d'épisodes facultatifs */ }
  ui.loading.delete(key);
}

// Toutes les saisons à l'ouverture de la fiche (au plus toutes les 12 h).
async function loadSeasonAvail(entry, onlySeason = null) {
  const t = entry.title;
  if (t.source !== 'tmdb' || t.type !== 'tv' || !C.live() || !t.seasons?.length) return;
  const key = `avail|${entry.id}|${onlySeason ?? 'all'}`;
  if (ui.loading.has(key)) return;
  if (onlySeason == null && entry.seasonAvailAt && Date.now() - entry.seasonAvailAt < 12 * 3600000
    && t.seasons.every((s) => entry.seasonAvail?.[s.n])) return;
  if (onlySeason != null && entry.seasonAvail?.[onlySeason] && Date.now() - (entry.seasonAvailAt || 0) < 12 * 3600000) return;
  ui.loading.add(key);
  try {
    const s = S.settings();
    const list = onlySeason != null ? [onlySeason] : t.seasons.map((x) => x.n);
    const results = await Promise.all(list.map((n) => C.seasonProviders(t, n, s).then((a) => [n, a]).catch(() => [n, null])));
    S.setSeasonAvail(entry.id, Object.fromEntries(results.filter(([, a]) => a)));
  } finally {
    ui.loading.delete(key);
  }
}

async function refreshEntry(entry, force = false) {
  if (entry.title.source !== 'tmdb' || ui.loading.has(entry.id)) return;
  const stale = !entry.title.refreshedAt || Date.now() - entry.title.refreshedAt > 12 * 3600000;
  if (!stale && !force) return;
  ui.loading.add(entry.id);
  try {
    const s = S.settings();
    const [title, avail] = await Promise.all([C.details(entry.title, s), C.providers(entry.title, s)]);
    if (avail) S.setProviders(entry.id, avail.included, avail.paid);
    // Liens directs vers le titre sur chaque plateforme (une fois par semaine suffit).
    if (title.wikidataId && (!entry.title.watchLinks || Date.now() - (entry.title.watchLinksAt || 0) > 7 * 86400000)) {
      C.watchIds(title).then((watchLinks) => S.updateTitle(entry.id, { watchLinks, watchLinksAt: Date.now() })).catch(() => {});
    }
    const { next } = S.progress(entry);
    if (next) loadSeasonAvail(S.get(entry.id), next.s);
    S.updateTitle(entry.id, title);
  } catch { /* hors ligne ou clé absente : on garde les données en cache */ }
  ui.loading.delete(entry.id);
}

// « À venir » : on rafraîchit les séries en cours de diffusion et les films pas encore vus.
async function refreshUpcoming() {
  if (!C.live() || ui.upcomingLoading) return;
  const targets = S.entries().filter((e) => e.title.source === 'tmdb'
    && (e.title.type === 'tv' ? !e.title.ended : e.status !== 'completed'));
  const stale = (e) => !('nextAir' in e.title || 'releaseDate' in e.title) || Date.now() - (e.title.refreshedAt || 0) > 6 * 3600000;
  const todo = targets.filter(stale);
  if (!todo.length) return;
  ui.upcomingLoading = true;
  if (route().name === 'upcoming') render();
  await Promise.all(todo.map((e) => refreshEntry(e, true)));
  ui.upcomingLoading = false;
  render();
}

function refreshLibrary(force = false) {
  S.entries().filter((e) => e.status !== 'completed').forEach((e) => refreshEntry(e, force));
}

// ——— Rendu ———

function route() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'home', arg: decodeURIComponent(rest.join('/')) };
}

function render() {
  const r = route();
  const view = $('#view');
  if (r.name === 'library') view.innerHTML = viewLibrary();
  else if (r.name === 'add') view.innerHTML = viewAdd();
  else if (r.name === 'profile') view.innerHTML = viewProfile();
  else if (r.name === 'title') view.innerHTML = viewTitle(r.arg);
  else if (r.name === 'account') view.innerHTML = viewAccount(r.arg);
  else if (r.name === 'upcoming') view.innerHTML = viewUpcoming();
  else view.innerHTML = viewHome();
  view.dataset.route = r.name;

  const TITLES = { home: '', library: 'Bibliothèque', add: 'Ajouter', profile: 'Profil', account: 'Compte', upcoming: 'À venir' };
  const pageTitle = r.name === 'title' ? S.get(r.arg)?.title.name : TITLES[r.name];
  document.title = pageTitle ? `${pageTitle} · Next Up` : 'Next Up';

  const avatar = $('#top-avatar');
  const user = Auth.user();
  avatar.classList.toggle('on', Boolean(user));
  avatar.innerHTML = user ? esc(Auth.displayName().slice(0, 1).toUpperCase()) : icon('user');

  const navRoute = r.name === 'account' ? 'profile' : r.name;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === navRoute));
}

window.addEventListener('hashchange', () => {
  const r = route();
  ui.editPlatform = false;
  ui.editName = false;
  render();
  window.scrollTo(0, 0);
  if (r.name === 'upcoming') refreshUpcoming();
  if (r.name === 'profile' && r.arg === 'abonnements') setTimeout(() => $('#abonnements')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  if (r.name === 'add') {
    if (!ui.results) runSearch();
    if (matchMedia('(hover: hover)').matches) $('#q')?.focus();
  }
  if (r.name === 'title') {
    const e = S.get(r.arg);
    if (e) {
      refreshEntry(e);
      loadSeasonAvail(e);
      const p = S.progress(e);
      if (!p.movie) loadEpisodeNames(e, ui.season[e.id] ?? p.next?.s ?? 1);
    }
  }
});

// Connexion / déconnexion d'un compte Next Up.
Auth.onChange(async (user) => {
  ui.results = null;
  ui.epNames = {};
  if (!user) {
    S.stopSync();
    return;
  }
  try {
    await S.startSync(Auth.db(), user.id);
  } catch {
    toast('Synchronisation impossible pour le moment');
  }
  syncSubscriptions();
  if (route().name === 'account') location.hash = '#/';
  toast(`Bienvenue ${esc(Auth.displayName())} !`);
  refreshLibrary(true);
  refreshUpcoming();
});

// Bordure de la barre du haut dès qu'on fait défiler.
window.addEventListener('scroll', () => $('.topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });

// En revenant sur l'app, on récupère les changements faits sur les autres appareils.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.syncing()) S.pull().catch(() => {});
});

async function boot() {
  S.init({ demo: !Auth.enabled });
  S.subscribe(render);
  render();
  try {
    await Auth.init();
    if (Auth.user()) {
      syncSubscriptions();
      await S.startSync(Auth.db(), Auth.user().id);
    }
  } catch {
    // Hors ligne : on continue avec la bibliothèque enregistrée sur l'appareil.
  }
  const linkError = Auth.takeLinkError();
  if (Auth.isRecovery() && Auth.user()) {
    location.hash = '#/account/new-password';
  } else if (linkError) {
    ui.authNotice = 'Ce lien a expiré ou a déjà été utilisé. Demande un nouveau lien ci-dessous.';
    ui.authWarn = true;
    location.hash = '#/account/reset';
  } else if (/access_token|type=/.test(location.hash)) {
    location.hash = '#/';
  }
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  refreshLibrary();
  refreshUpcoming();
}

boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // Nouvelle version publiée : l'app se recharge une fois d'elle-même pour l'utiliser.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => reg.update()).catch(() => {});
}
