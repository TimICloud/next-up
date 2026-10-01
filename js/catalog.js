// Catalogue des films et séries.
// - Sans clé TMDB : un petit catalogue de démonstration intégré (données illustratives).
// - Avec une clé TMDB : recherche dans tout le catalogue mondial, affiches, épisodes et plateformes réelles.
import { matchProvider } from './platforms.js';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';

export const img = (path, size = 'w342') => IMG + size + path;

const tv = (slug, name, original, year, seasons, runtime, ended, genres, providers, palette, overview) => ({
  id: `demo-tv-${slug}`, source: 'demo', type: 'tv', name, original, year,
  seasons: seasons.map((count, i) => ({ n: i + 1, count })),
  runtime, ended, genres, providers, palette, overview,
});

const movie = (slug, name, original, year, runtime, genres, providers, palette, overview) => ({
  id: `demo-movie-${slug}`, source: 'demo', type: 'movie', name, original, year,
  runtime, genres, providers, palette, overview,
});

// Les plateformes indiquées ici sont des exemples pour la démo, pas des disponibilités réelles.
export const DEMO = [
  tv('suits', 'Suits : Avocats sur mesure', 'Suits', 2011, [12, 16, 16, 16, 16, 16, 16, 16, 10], 43, true,
    ['Drame', 'Juridique'], ['prime'], ['#1E3A8A', '#0B1020'],
    'Un jeune surdoué sans diplôme se fait embaucher par le meilleur avocat de New York. Leur secret pourrait tout faire tomber.'),
  tv('breaking-bad', 'Breaking Bad', 'Breaking Bad', 2008, [7, 13, 13, 13, 16], 47, true,
    ['Drame', 'Crime'], ['netflix'], ['#3F6212', '#0C1406'],
    'Un professeur de chimie atteint d’un cancer bascule dans la fabrication de méthamphétamine pour assurer l’avenir de sa famille.'),
  tv('stranger-things', 'Stranger Things', 'Stranger Things', 2016, [8, 9, 8, 9, 8], 55, true,
    ['Science-fiction', 'Mystère'], ['netflix'], ['#9F1239', '#12040A'],
    'Dans une petite ville des années 80, la disparition d’un enfant révèle des expériences secrètes et un monde parallèle.'),
  tv('the-bear', 'The Bear', 'The Bear', 2022, [8, 10, 10, 10], 32, false,
    ['Drame', 'Comédie'], ['disney'], ['#9A3412', '#160A04'],
    'Un chef étoilé revient à Chicago reprendre la sandwicherie familiale, au bord de la faillite et du chaos.'),
  tv('severance', 'Severance', 'Severance', 2022, [9, 10], 52, false,
    ['Thriller', 'Science-fiction'], ['apple'], ['#0E7490', '#03121A'],
    'Des employés acceptent une procédure qui sépare leurs souvenirs de travail de leur vie privée. Jusqu’à ce que des questions émergent.'),
  tv('the-last-of-us', 'The Last of Us', 'The Last of Us', 2023, [9, 7], 55, false,
    ['Drame', 'Post-apo'], ['max'], ['#4D7C0F', '#0A1004'],
    'Vingt ans après l’effondrement de la civilisation, un contrebandier escorte une adolescente à travers des États-Unis dévastés.'),
  tv('wednesday', 'Mercredi', 'Wednesday', 2022, [8, 8], 50, false,
    ['Mystère', 'Comédie'], ['netflix'], ['#3B0764', '#0B0414'],
    'Mercredi Addams enquête sur une série de meurtres dans son nouvel internat pour élèves hors du commun.'),
  tv('lupin', 'Lupin', 'Lupin', 2021, [5, 5, 7], 47, false,
    ['Thriller', 'Crime'], ['netflix'], ['#1D4ED8', '#050B1E'],
    'Inspiré par Arsène Lupin, Assane Diop veut venger son père, accusé à tort d’un vol par une riche famille.'),
  tv('the-mandalorian', 'The Mandalorian', 'The Mandalorian', 2019, [8, 8, 8], 38, false,
    ['Science-fiction', 'Aventure'], ['disney'], ['#78716C', '#0F0D0C'],
    'Un chasseur de primes solitaire parcourt les confins de la galaxie, loin de l’autorité de la Nouvelle République.'),
  tv('ted-lasso', 'Ted Lasso', 'Ted Lasso', 2020, [10, 12, 12], 40, false,
    ['Comédie', 'Sport'], ['apple'], ['#B45309', '#140B02'],
    'Un entraîneur de football américain sans expérience prend la tête d’un club de football anglais. Avec beaucoup d’optimisme.'),
  tv('got', 'Game of Thrones', 'Game of Thrones', 2011, [10, 10, 10, 10, 10, 10, 7, 6], 57, true,
    ['Fantastique', 'Drame'], ['max'], ['#57534E', '#0C0A09'],
    'Les grandes familles de Westeros se disputent le Trône de fer, tandis qu’une menace ancienne se réveille au nord.'),
  tv('friends', 'Friends', 'Friends', 1994, [24, 24, 25, 24, 24, 25, 24, 24, 24, 18], 22, true,
    ['Comédie'], ['max'], ['#7C3AED', '#12061F'],
    'Six amis new-yorkais partagent appartements, cafés et histoires de cœur pendant dix saisons.'),
  movie('dune-2', 'Dune : Deuxième partie', 'Dune: Part Two', 2024, 166,
    ['Science-fiction'], ['max'], ['#C2410C', '#1A0A03'],
    'Paul Atréides s’allie aux Fremen pour venger sa famille, tout en redoutant l’avenir qu’il entrevoit.'),
  movie('oppenheimer', 'Oppenheimer', 'Oppenheimer', 2023, 180,
    ['Drame', 'Histoire'], ['prime'], ['#B45309', '#120802'],
    'Le portrait du physicien qui a dirigé la mise au point de la première bombe atomique.'),
  movie('top-gun-maverick', 'Top Gun : Maverick', 'Top Gun: Maverick', 2022, 131,
    ['Action'], ['paramount'], ['#0369A1', '#020D16'],
    'Trente ans après, Maverick doit former une nouvelle génération de pilotes pour une mission presque impossible.'),
  movie('inception', 'Inception', 'Inception', 2010, 148,
    ['Science-fiction', 'Thriller'], ['netflix'], ['#334155', '#06090F'],
    'Un voleur spécialisé dans l’extraction de secrets à travers les rêves se voit confier l’inverse : implanter une idée.'),
  movie('interstellar', 'Interstellar', 'Interstellar', 2014, 169,
    ['Science-fiction', 'Drame'], ['prime'], ['#1E40AF', '#030716'],
    'Alors que la Terre se meurt, un groupe d’explorateurs traverse un trou de ver à la recherche d’un nouveau foyer.'),
  movie('barbie', 'Barbie', 'Barbie', 2023, 114,
    ['Comédie'], ['max'], ['#DB2777', '#1C0410'],
    'Barbie quitte Barbieland pour le monde réel et découvre que la perfection a ses limites.'),
  movie('monte-cristo', 'Le Comte de Monte-Cristo', 'Le Comte de Monte-Cristo', 2024, 178,
    ['Aventure', 'Drame'], ['canal'], ['#854D0E', '#140C02'],
    'Emprisonné à tort le jour de son mariage, Edmond Dantès s’évade et prépare une vengeance implacable.'),
];

// Affiches de la démo, hébergées par Wikipédia (images non libres, réduites, à usage d'illustration).
// Severance, Mercredi, Lupin et Ted Lasso n'ont qu'un logo sur Wikipédia : ils gardent une affiche générée.
const WIKI = 'https://upload.wikimedia.org/wikipedia/en';
const COVERS = {
  'demo-tv-suits': '/2/2c/SuitsSeasn1DVDCover.jpg',
  'demo-tv-breaking-bad': '/6/61/BreakingBadS1DVD.jpg',
  'demo-tv-stranger-things': '/b/b1/Stranger_Things_season_1.jpg',
  'demo-tv-the-bear': '/7/74/The_Bear_2022_FX.png',
  'demo-tv-the-last-of-us': '/3/3e/The_Last_of_Us_season_1_Blu-ray.png',
  'demo-tv-the-mandalorian': '/0/04/The_Mandalorian_season_1_poster.jpg',
  'demo-tv-got': '/e/e8/Game_of_Thrones_Season_1.jpg',
  'demo-tv-friends': '/1/1c/Friends_Season_1_DVD.jpg',
  'demo-movie-dune-2': '/5/52/Dune_Part_Two_poster.jpeg',
  'demo-movie-oppenheimer': '/4/4a/Oppenheimer_%28film%29.jpg',
  'demo-movie-top-gun-maverick': '/1/13/Top_Gun_Maverick_Poster.jpg',
  'demo-movie-inception': '/2/2e/Inception_%282010%29_theatrical_poster.jpg',
  'demo-movie-interstellar': '/b/bc/Interstellar_film_poster.jpg',
  'demo-movie-barbie': '/0/0b/Barbie_2023_poster.jpg',
  'demo-movie-monte-cristo': '/d/d0/Le_Comte_de_Monte-Cristo_2024_film_poster.jpg',
};
for (const t of DEMO) if (COVERS[t.id]) t.posterUrl = WIKI + COVERS[t.id];

export const demoById = Object.fromEntries(DEMO.map((t) => [t.id, t]));

// Adresse de l'affiche d'un titre, quelle que soit sa source.
export const posterSrc = (t, size = 'w342') => t.posterUrl || (t.poster ? img(t.poster, size) : null);

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Couleurs d'affiche générées pour les titres sans image.
export function paletteFor(name) {
  let h = 0;
  for (const c of name || '') h = (h * 31 + c.charCodeAt(0)) % 360;
  return [`hsl(${h} 55% 32%)`, `hsl(${(h + 40) % 360} 60% 8%)`];
}

async function call(path, key, params = {}) {
  const url = new URL(API + path);
  const bearer = key.startsWith('eyJ');
  url.searchParams.set('language', 'fr-FR');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!bearer) url.searchParams.set('api_key', key);
  const res = await fetch(url, bearer ? { headers: { Authorization: `Bearer ${key}` } } : {});
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

// 'ok', 'invalid' (refusée par TMDB) ou 'offline' (impossible de vérifier).
export async function checkKey(key) {
  try {
    await call('/configuration', key);
    return 'ok';
  } catch (e) {
    return /TMDB 40[13]/.test(e.message) ? 'invalid' : 'offline';
  }
}

const fromTmdb =(r, type = r.media_type) => ({
  id: `tmdb-${type}-${r.id}`, source: 'tmdb', tmdbId: r.id, type,
  name: r.name || r.title,
  original: r.original_name || r.original_title,
  year: parseInt((r.first_air_date || r.release_date || '').slice(0, 4), 10) || null,
  poster: r.poster_path || null,
  backdrop: r.backdrop_path || null,
  overview: r.overview || '',
});

export async function search(query, settings) {
  if (!settings.tmdbKey) {
    const q = norm(query);
    return DEMO.filter((t) => norm(t.name).includes(q) || norm(t.original).includes(q));
  }
  const d = await call('/search/multi', settings.tmdbKey, { query, include_adult: 'false', region: settings.region });
  return d.results.filter((r) => r.media_type === 'tv' || r.media_type === 'movie').slice(0, 24).map((r) => fromTmdb(r));
}

export async function suggestions(settings) {
  if (!settings.tmdbKey) return DEMO;
  const d = await call('/trending/all/week', settings.tmdbKey);
  return d.results.filter((r) => r.media_type === 'tv' || r.media_type === 'movie').map((r) => fromTmdb(r));
}

// Complète un titre : saisons et nombre d'épisodes, durée, statut (terminée ou en cours de diffusion).
export async function details(title, settings) {
  if (title.source !== 'tmdb' || !settings.tmdbKey) return title;
  const d = await call(`/${title.type}/${title.tmdbId}`, settings.tmdbKey);
  const t = { ...title, ...fromTmdb(d, title.type), genres: (d.genres || []).map((g) => g.name), refreshedAt: Date.now() };
  if (!t.overview) t.overview = title.overview;
  if (title.type === 'tv') {
    t.seasons = (d.seasons || [])
      .filter((s) => s.season_number > 0 && s.episode_count > 0)
      .sort((a, b) => a.season_number - b.season_number)
      .map((s) => ({ n: s.season_number, count: s.episode_count }));
    t.runtime = d.episode_run_time?.[0] || d.last_episode_to_air?.runtime || null;
    t.ended = ['Ended', 'Canceled'].includes(d.status);
    const last = d.last_episode_to_air;
    t.lastAired = last ? { s: last.season_number, e: last.episode_number } : null;
  } else {
    t.runtime = d.runtime || null;
  }
  return t;
}

// Plateformes où le titre est disponible dans le pays choisi (abonnement, gratuit ou avec pub).
export async function providers(title, settings) {
  if (title.source !== 'tmdb') return title.providers || [];
  if (!settings.tmdbKey) return null;
  const d = await call(`/${title.type}/${title.tmdbId}/watch/providers`, settings.tmdbKey);
  const r = d.results?.[settings.region];
  const list = [...(r?.flatrate || []), ...(r?.free || []), ...(r?.ads || [])];
  return [...new Set(list.map((p) => matchProvider(p.provider_name)).filter(Boolean))];
}

export async function seasonEpisodes(title, season, settings) {
  if (title.source !== 'tmdb' || !settings.tmdbKey) return null;
  const d = await call(`/tv/${title.tmdbId}/season/${season}`, settings.tmdbKey);
  return Object.fromEntries((d.episodes || []).map((e) => [e.episode_number, e.name]));
}
