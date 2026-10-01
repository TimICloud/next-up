import * as S from './store.js';
import * as C from './catalog.js';
import * as Auth from './auth.js';
import { PLATFORMS, platform } from './platforms.js';
import { icon } from './icons.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const epLabel = (ep) => `S${ep.s} · É${ep.e}`;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

const STATUS = {
  watching: 'En cours',
  paused: 'En pause',
  planned: 'À voir',
  completed: 'Terminé',
};

// État d'interface (non sauvegardé).
const ui = {
  bumped: null,
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

function nextLine(entry, p) {
  if (p.movie) {
    if (p.done) return 'Vu';
    return entry.minutes ? `${entry.minutes} / ${entry.title.runtime || '?'} min` : 'Pas encore commencé';
  }
  if (p.finished) return 'Série terminée';
  if (p.upToDate) return 'À jour · en attente de la suite';
  if (p.next) return `Prochain · <b>${epLabel(p.next)}</b>`;
  return '';
}

// ——— Vues ———

function viewHome() {
  const list = S.entries();
  const hour = new Date().getHours();
  const hello = hour < 6 ? 'Bonne nuit' : hour < 18 ? 'Bonjour' : 'Bonsoir';

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
  const alerts = list.map((e) => ({ e, to: S.platformAlert(e) })).filter((a) => a.to);
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

    ${Auth.enabled && !Auth.user() ? accountBanner() : ''}
    ${alerts.map(({ e, to }) => alertCard(e, to)).join('')}

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
    <span class="logo-mark">+1</span>
    <span><b>Crée ton compte Next Up</b><small>Tout le catalogue films et séries, et ta progression sur tous tes appareils.</small></span>
    ${icon('back', 'flip')}
  </a>`;

function resumeCard(e, p) {
  const t = e.title;
  return `<article class="rcard" data-go="#/title/${encodeURIComponent(e.id)}">
    <div class="rcard-bg">${backdrop(t)}</div>
    ${poster(t, 'rcard-poster')}
    <div class="rcard-body">
      <div class="rcard-top">${chip(e.platform)}${t.type === 'movie' ? '<span class="tag">Film</span>' : ''}</div>
      <h3>${esc(t.name)}</h3>
      <p class="next">${nextLine(e, p)}</p>
      ${bar(p.pct)}
      <p class="meta">${p.movie ? `${Math.round(p.pct * 100)} %` : `${p.watched} / ${p.total} épisodes`}</p>
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

function alertCard(e, to) {
  const from = platform(e.platform).name;
  const target = to[0];
  return `<div class="alert">
    <div class="alert-icon">${icon('swap')}</div>
    <div class="alert-body">
      <p><b>${esc(e.title.name)}</b> n’est plus sur ${esc(from)}.</p>
      <p class="muted">Disponible sur ${to.map((pid) => esc(platform(pid).name)).join(', ')}. Ta progression est conservée.</p>
      <div class="alert-actions">
        <button class="btn small primary" data-action="switchPlatform" data-id="${esc(e.id)}" data-p="${target}">Passer sur ${esc(platform(target).name)}</button>
        <button class="btn small ghost" data-action="ackAlert" data-id="${esc(e.id)}">Ignorer</button>
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
];

function viewLibrary() {
  const f = ui.libFilter;
  const list = S.entries()
    .filter((e) => f === 'all' || (f === 'movie' || f === 'tv' ? e.title.type === f : f === 'watching' ? e.status === 'watching' || e.status === 'paused' : e.status === f))
    .sort((a, b) => (b.lastWatchedAt || b.addedAt) - (a.lastWatchedAt || a.addedAt));

  return `<header class="page-head compact"><h1>Bibliothèque</h1>
      <p class="muted">${plural(S.entries().length, 'titre', 'titres')}</p></header>
    <div class="filters">${LIB_FILTERS.map(([k, label]) =>
      `<button class="fchip ${f === k ? 'on' : ''}" data-action="libFilter" data-f="${k}">${label}</button>`).join('')}</div>
    ${list.length ? `<div class="grid">${list.map(tile).join('')}</div>`
      : `<div class="empty small"><p>Rien ici pour l’instant.</p><a class="btn" href="#/add">${icon('plus')} Ajouter</a></div>`}`;
}

function tile(e) {
  const p = S.progress(e);
  const canPlus = !p.movie && e.status === 'watching' && p.next && p.nextAired;
  return `<div class="tile" data-go="#/title/${encodeURIComponent(e.id)}">
    <div class="tile-poster">${poster(e.title)}
      ${e.status === 'completed' ? `<span class="tile-done">${icon('check')}</span>` : ''}
      ${canPlus ? plusButton(e, p, 'sm') : ''}
    </div>
    ${bar(p.pct)}
    <b class="tile-name">${esc(e.title.name)}</b>
    <span class="tile-sub"><i style="--pc:${platform(e.platform).color}"></i>${p.movie ? STATUS[e.status] : p.next && e.status !== 'planned' ? epLabel(p.next) : STATUS[e.status]}</span>
  </div>`;
}

function viewAdd() {
  return `<header class="page-head compact"><h1>Ajouter</h1>
      <p class="muted">Cherche un film ou une série${C.live() ? '' : ' (catalogue de démo)'}.</p></header>
    ${Auth.enabled && !Auth.user() ? `<p class="hint-card">${icon('search')}<span><a href="#/account/login">Connecte-toi</a> pour chercher dans tous les films et séries.</span></p>` : ''}
    <label class="search">
      ${icon('search')}
      <input id="q" type="search" placeholder="Suits, Dune, The Bear…" value="${esc(ui.query)}" autocomplete="off" enterkeyhint="search">
    </label>
    <div id="results">${resultsHTML()}</div>`;
}

function resultsHTML() {
  if (ui.searchError) return `<p class="muted pad">${esc(ui.searchError)}</p>`;
  if (!ui.results) return `<div class="spinner"></div>`;
  if (!ui.results.length) return `<p class="muted pad">Aucun résultat pour « ${esc(ui.query)} ».</p>`;
  return `${ui.query ? '' : '<h2 class="sub-title">Suggestions</h2>'}
    <div class="grid">${ui.results.map((t) => `
      <button class="tile result" data-action="pick" data-id="${esc(t.id)}">
        <div class="tile-poster">${poster(t)}${S.has(t.id) ? `<span class="tile-done">${icon('check')}</span>` : ''}</div>
        <b class="tile-name">${esc(t.name)}</b>
        <span class="tile-sub">${t.type === 'movie' ? 'Film' : 'Série'}${t.year ? ` · ${t.year}` : ''}</span>
      </button>`).join('')}</div>`;
}

function viewTitle(id) {
  const e = S.get(id);
  if (!e) return `<div class="empty"><h2>Titre introuvable</h2><a class="btn" href="#/">Retour à l’accueil</a></div>`;
  const t = e.title;
  const p = S.progress(e);
  const alertTo = S.platformAlert(e);
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
      </div>
    </div>
    ${t.overview ? `<p class="overview">${esc(t.overview)}</p>` : ''}

    ${alertTo ? alertCard(e, alertTo) : ''}

    ${t.type === 'tv' ? progressCardTV(e, p) : progressCardMovie(e, p)}
    ${platformCard(e)}
    ${t.type === 'tv' ? episodesSection(e, p) : ''}

    <section class="card">
      <span class="label">Statut</span>
      <div class="seg">${Object.entries(STATUS).map(([k, label]) =>
        `<button class="${e.status === k ? 'on' : ''}" data-action="status" data-id="${esc(e.id)}" data-status="${k}">${label}</button>`).join('')}</div>
    </section>
    <button class="btn ghost danger block" data-action="remove" data-id="${esc(e.id)}">${icon('trash')} Retirer de ma bibliothèque</button>
  </div>`;
}

function progressCardTV(e, p) {
  const names = p.next ? ui.epNames[`${e.id}|${p.next.s}`] : null;
  const epName = p.next && names ? names[p.next.e] : null;
  let head;
  if (p.finished) head = `<span class="label">Bravo</span><div class="big">Série terminée</div>`;
  else if (p.upToDate) head = `<span class="label">Tu es à jour</span><div class="big">${p.next ? `${epLabel(p.next)} bientôt` : 'Suite à venir'}</div>`;
  else head = `<span class="label">${p.watched ? 'Prochain épisode' : 'Pour commencer'}</span><div class="big">${epLabel(p.next)}</div>${epName ? `<span class="epname">${esc(epName)}</span>` : ''}`;

  return `<section class="card progress-card">
    <div class="pc-top"><div>${head}</div>${plusButton(e, p, 'xl')}</div>
    ${bar(p.pct)}
    <div class="pc-meta"><span>${p.watched} / ${p.total} épisodes</span><span>${Math.round(p.pct * 100)} %</span></div>
    <button class="link" data-action="position" data-id="${esc(e.id)}">Modifier où j’en suis</button>
  </section>`;
}

function progressCardMovie(e, p) {
  const runtime = e.title.runtime || 180;
  return `<section class="card progress-card">
    <div class="pc-top">
      <div><span class="label">${p.done ? 'Film vu' : 'Progression'}</span>
        <div class="big">${p.done ? 'Terminé' : `${e.minutes || 0} min`}</div>
        ${!p.done && e.title.runtime ? `<span class="epname">sur ${e.title.runtime} min</span>` : ''}</div>
      ${p.done ? '' : `<button class="plus xl done-btn" data-action="movieDone" data-id="${esc(e.id)}" aria-label="Marquer comme vu">${icon('check')}</button>`}
    </div>
    ${p.done ? bar(1) : `<input class="range" type="range" min="0" max="${runtime}" step="1" value="${e.minutes || 0}"
      data-input="minutes" data-id="${esc(e.id)}" aria-label="Minutes regardées" style="--v:${Math.round(p.pct * 100)}%">`}
  </section>`;
}

function platformCard(e) {
  const history = e.platformHistory || [];
  const date = (ts) => new Date(ts).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' });
  const avail = e.providers;
  return `<section class="card">
    <div class="card-row">
      <div><span class="label">Regardé sur</span><div class="platform-now">${chip(e.platform)}</div></div>
      <button class="btn small ghost" data-action="editPlatform">${ui.editPlatform ? 'Fermer' : 'Changer'}</button>
    </div>
    ${ui.editPlatform ? `<div class="pick-grid">${PLATFORMS.map((pl) =>
      `<button class="pick ${pl.id === e.platform ? 'on' : ''}" style="--pc:${pl.color}" data-action="setPlatform" data-id="${esc(e.id)}" data-p="${pl.id}"><i></i>${esc(pl.name)}${avail?.includes(pl.id) ? '<small>dispo</small>' : ''}</button>`).join('')}</div>
      <p class="hint">Changer de plateforme ne modifie pas ta progression.</p>` : ''}
    ${history.length > 1 ? `<ol class="timeline">${history.map((h) =>
      `<li><i style="--pc:${platform(h.platform).color}"></i><b>${esc(platform(h.platform).name)}</b><span>depuis le ${date(h.at)}</span></li>`).join('')}</ol>` : ''}
    <div class="avail"><span class="label">Disponible en ${esc(S.settings().region)}${e.title.source === 'demo' ? ' (démo)' : ''}</span>
      ${avail == null ? `<p class="muted">${C.live() ? 'Recherche…' : 'Disponible avec un compte Next Up.'}</p>`
        : avail.length ? `<div class="chips">${avail.map(chip).join('')}</div>` : '<p class="muted">Aucune plateforme d’abonnement trouvée.</p>'}
    </div>
  </section>`;
}

function episodesSection(e, p) {
  const seasons = e.title.seasons || [];
  if (!seasons.length) return '';
  const current = ui.season[e.id] ?? p.next?.s ?? p.last?.s ?? seasons[0].n;
  const season = seasons.find((s) => s.n === current) || seasons[0];
  const names = ui.epNames[`${e.id}|${season.n}`];
  const seenIn = (s) => e.watched.filter((k) => k.startsWith(`${s.n}:`)).length;
  const allSeen = seenIn(season) === season.count;

  return `<section class="block">
    <div class="block-head"><h2>Épisodes</h2></div>
    <div class="season-tabs">${seasons.map((s) => {
      const pct = seenIn(s) / s.count;
      return `<button class="stab ${s.n === season.n ? 'on' : ''} ${pct === 1 ? 'full' : ''}" data-action="season" data-id="${esc(e.id)}" data-s="${s.n}">
        S${s.n}<span class="stab-bar"><span style="width:${pct * 100}%"></span></span></button>`;
    }).join('')}</div>
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
        <span class="ep-c">${on ? icon('check') : isNext ? '<em>Prochain</em>' : aired ? '' : '<em>À venir</em>'}</span>
      </button>`;
    }).join('')}</div>
  </section>`;
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
        ${S.syncing() ? '' : '<button class="btn ghost" data-action="resetDemo">Recharger la démo</button>'}
        <button class="btn ghost danger" data-action="clearAll">Tout effacer</button>
      </div>
    </section>
    <p class="credit muted">Next Up utilise l’API TMDB mais n’est ni approuvé ni certifié par TMDB.</p>`;
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
  return `<section class="card account">
    <span class="avatar">${esc(name.slice(0, 1).toUpperCase())}</span>
    <div class="account-info"><b>${esc(name)}</b><span class="muted">${esc(u.email)}</span>
      <span class="hint ok">${icon('check')} Catalogue complet · bibliothèque synchronisée</span></div>
    <button class="btn small ghost" data-action="signOut">Déconnexion</button>
  </section>`;
}

const PERKS = ['Tous les films et séries, avec leurs affiches', 'Ta progression sur téléphone et ordinateur', 'Une alerte quand une série change de plateforme'];

function viewAccount(mode) {
  if (!Auth.enabled) {
    return `<div class="empty"><h2>Comptes pas encore activés</h2><p>Le serveur Next Up n’est pas encore configuré. L’app fonctionne en mode démo.</p><a class="btn" href="#/">Retour à l’accueil</a></div>`;
  }
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
    <div class="auth-head"><span class="logo-mark big">+1</span><h1>${title}</h1><p class="muted">${sub}</p></div>
    ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
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

// ——— Feuille d'ajout / de position ———

function openAddSheet(title) {
  const existing = S.get(title.id);
  ui.sheet = { mode: 'add', title, platform: null, status: 'watching', s: 1, e: 1, minutes: 0, providers: title.providers || null, loading: title.source === 'tmdb', existing: Boolean(existing) };
  if (!ui.sheet.providers?.length) ui.sheet.platform = 'netflix';
  else ui.sheet.platform = ui.sheet.providers[0];
  renderSheet();
  if (title.source === 'tmdb') {
    const s = S.settings();
    Promise.all([C.details(title, s), C.providers(title, s).catch(() => null)])
      .then(([full, prov]) => {
        if (ui.sheet?.title.id !== title.id) return;
        Object.assign(ui.sheet, { title: full, providers: prov, loading: false });
        if (prov?.length) ui.sheet.platform = prov[0];
        renderSheet();
      })
      .catch(() => {
        if (ui.sheet) Object.assign(ui.sheet, { loading: false, error: 'Impossible de charger les détails (clé TMDB ?).' });
        renderSheet();
      });
  }
}

function openPositionSheet(entry) {
  const p = S.progress(entry);
  const next = p.next || p.last || { s: 1, e: 1 };
  ui.sheet = { mode: 'position', title: entry.title, entryId: entry.id, s: next.s, e: next.e };
  renderSheet();
}

function closeSheet() {
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

function renderSheet() {
  const root = $('#sheet');
  const sh = ui.sheet;
  if (!sh) return;
  const t = sh.title;
  let body;

  if (sh.mode === 'position') {
    body = `<h3 class="sheet-title">Où en es-tu ?</h3>
      <p class="muted">Indique le prochain épisode que tu vas regarder.</p>
      ${positionPicker(sh)}
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
          <i></i>${esc(pl.name)}${sh.providers?.includes(pl.id) ? '<small>dispo</small>' : ''}</button>`).join('')}</div>
      </div>
      <div class="sheet-sec"><h4>Statut</h4>
        <div class="seg">${statuses.map(([k, l]) => `<button class="${sh.status === k ? 'on' : ''}" data-action="sheetStatus" data-status="${k}">${l}</button>`).join('')}</div>
      </div>
      ${sh.status === 'watching' && t.type === 'tv' ? `<div class="sheet-sec"><h4>Prochain épisode à voir</h4>${positionPicker(sh)}</div>` : ''}
      ${sh.status === 'watching' && t.type === 'movie' ? `<div class="sheet-sec"><h4>Déjà regardé : <b data-out="minutes">${sh.minutes}</b> min</h4>
        <input class="range" type="range" min="0" max="${t.runtime || 180}" value="${sh.minutes}" data-input="sheetMinutes" style="--v:${(sh.minutes / (t.runtime || 180)) * 100}%"></div>` : ''}
      <button class="btn primary block" data-action="sheetSave" ${sh.loading ? 'disabled' : ''}>Ajouter à ma bibliothèque</button>`;
  }

  root.innerHTML = `<div class="sheet-backdrop" data-action="closeSheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(t.name)}">
      <div class="grab"></div>
      <button class="icon-btn sheet-close" data-action="closeSheet" aria-label="Fermer">${icon('x')}</button>
      ${body}
    </div>`;
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
    if (sh.providers && sh.title.source === 'tmdb') S.setProviders(sh.title.id, sh.providers);
    closeSheet();
    toast(`<b>${esc(sh.title.name)}</b> ajouté`);
    location.hash = `#/title/${encodeURIComponent(sh.title.id)}`;
  },
  savePosition() {
    const sh = ui.sheet;
    S.setPosition(sh.entryId, { s: sh.s, e: sh.e });
    closeSheet();
    toast(`Position mise à jour · prochain <b>${epLabel(sh)}</b>`);
  },
  export() {
    const blob = new Blob([S.exportData()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `next-up-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  async signOut() {
    if (confirm('Te déconnecter ? Ta bibliothèque reste sauvegardée dans ton compte.')) await Auth.signOut();
  },
  resetDemo() { if (confirm('Remplacer ta bibliothèque par la démo ?')) { S.resetDemo(); toast('Démo rechargée'); } },
  clearAll() { if (confirm('Effacer toute ta bibliothèque ? Cette action est définitive.')) { S.clearLibrary(); toast('Bibliothèque vidée'); } },
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
  const kind = el.dataset.input;
  if (kind === 'minutes' || kind === 'sheetMinutes') el.style.setProperty('--v', `${(el.value / el.max) * 100}%`);
  if (kind === 'sheetMinutes') {
    ui.sheet.minutes = +el.value;
    $('[data-out="minutes"]').textContent = el.value;
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  const kind = el.dataset.input;
  if (kind === 'minutes') S.setMinutes(el.dataset.id, +el.value);
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
      ui.authNotice = `Si un compte existe pour ${email}, un e-mail vient d’être envoyé.`;
      location.hash = '#/account/login';
    }
  } catch (e) {
    fail(e.message);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ui.sheet) closeSheet(); });

// ——— Recherche ———

let searchTimer;
let searchSeq = 0;
function runSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    const q = ui.query.trim();
    const s = S.settings();
    ui.searchError = null;
    try {
      const res = q ? await C.search(q, s) : await C.suggestions(s);
      if (seq !== searchSeq) return;
      ui.results = res;
      ui.resultsById = Object.fromEntries(res.map((t) => [t.id, t]));
    } catch {
      if (seq !== searchSeq) return;
      ui.searchError = 'La recherche a échoué. Réessaie dans un instant.';
    }
    const box = $('#results');
    if (box) box.innerHTML = resultsHTML();
  }, ui.query ? 220 : 0);
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

async function refreshEntry(entry, force = false) {
  if (entry.title.source !== 'tmdb' || ui.loading.has(entry.id)) return;
  const stale = !entry.title.refreshedAt || Date.now() - entry.title.refreshedAt > 12 * 3600000;
  if (!stale && !force) return;
  ui.loading.add(entry.id);
  try {
    const s = S.settings();
    const [title, providers] = await Promise.all([C.details(entry.title, s), C.providers(entry.title, s)]);
    S.setProviders(entry.id, providers);
    S.updateTitle(entry.id, title);
  } catch { /* hors ligne ou clé absente : on garde les données en cache */ }
  ui.loading.delete(entry.id);
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
  else view.innerHTML = viewHome();
  view.dataset.route = r.name;

  const navRoute = r.name === 'account' ? 'profile' : r.name;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === navRoute));
}

window.addEventListener('hashchange', () => {
  const r = route();
  ui.editPlatform = false;
  render();
  window.scrollTo(0, 0);
  if (r.name === 'add') {
    if (!ui.results) runSearch();
    if (matchMedia('(hover: hover)').matches) $('#q')?.focus();
  }
  if (r.name === 'title') {
    const e = S.get(r.arg);
    if (e) {
      refreshEntry(e);
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
  if (route().name === 'account') location.hash = '#/';
  toast(`Bienvenue ${esc(Auth.displayName())} !`);
  refreshLibrary(true);
});

// En revenant sur l'app, on récupère les changements faits sur les autres appareils.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.syncing()) S.pull().catch(() => {});
});

async function boot() {
  S.init();
  S.subscribe(render);
  render();
  try {
    await Auth.init();
    if (Auth.user()) await S.startSync(Auth.db(), Auth.user().id);
  } catch {
    // Hors ligne : on continue avec la bibliothèque enregistrée sur l'appareil.
  }
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  refreshLibrary();
}

boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
