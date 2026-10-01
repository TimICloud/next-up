// Plateformes de streaming connues. `match` sert à reconnaître les noms renvoyés par TMDB.
export const PLATFORMS = [
  { id: 'netflix', name: 'Netflix', color: '#E50914', match: ['netflix'] },
  { id: 'prime', name: 'Prime Video', color: '#1A98FF', match: ['prime video', 'amazon prime', 'amazon video'] },
  { id: 'disney', name: 'Disney+', color: '#2D6BFF', match: ['disney'] },
  { id: 'apple', name: 'Apple TV', color: '#C9C9D1', match: ['apple tv'] },
  { id: 'max', name: 'HBO Max', color: '#5B6CFF', match: ['hbo max', 'max'] },
  { id: 'paramount', name: 'Paramount+', color: '#0A7BFF', match: ['paramount'] },
  { id: 'canal', name: 'Canal+', color: '#EDEDED', match: ['canal'] },
  { id: 'other', name: 'Autre', color: '#7C7C8A', match: [] },
];

const byId = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]));

export const platform = (id) => byId[id] || byId.other;

// "Netflix Standard with Ads" → netflix, "Max" → max, etc.
export function matchProvider(providerName) {
  const n = providerName.toLowerCase().trim();
  for (const p of PLATFORMS) {
    if (p.match.some((m) => (m === 'max' ? n === 'max' || n.startsWith('max ') : n.includes(m)))) return p.id;
  }
  return null;
}
