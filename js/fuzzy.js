// Comparaison tolérante aux fautes, la même que celle du serveur (supabase/functions/tmdb).
export const norm = (s) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const STOP = new Set(['the', 'le', 'la', 'les', 'de', 'des', 'du', 'a', 'an', 'of', 'et', 'and', 'un', 'une']);

function levenshtein(a, b) {
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

const ratio = (a, b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

// Ressemblance entre une saisie et un titre, de 0 à 1 (les deux déjà normalisés).
export function similarity(q, title) {
  if (!q || !title) return 0;
  if (title === q) return 1;
  if (title.startsWith(q) || title.includes(` ${q}`)) return 0.95;
  const tw = title.split(' ');
  let total = 0;
  let bestWord = 0;
  const qw = q.split(' ');
  for (const w of qw) {
    let best = 0;
    for (const t of tw) best = Math.max(best, ratio(w, t), w.length >= 3 && t.startsWith(w) ? 0.9 : 0);
    total += best;
    if (w.length >= 3 && !STOP.has(w)) bestWord = Math.max(bestWord, best);
  }
  const compactQ = q.replace(/ /g, '');
  const whole = ratio(compactQ, title.replace(/ /g, '').slice(0, compactQ.length + 2));
  return Math.max((total / qw.length) * 0.8 + whole * 0.2, bestWord * 0.7);
}
