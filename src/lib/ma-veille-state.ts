// src/lib/ma-veille-state.ts — cœur pur de la page « Ma veille » (/ma-veille/).
//
// Source de vérité des énumérations : workers/api/src/watchlist.ts
// (constantes SECTEURS / DATA_TYPES / FREQS, type Freq). Frontière worker ↔
// site : aucun import d'un côté à l'autre — toute extension d'une énumération
// (contrat public) doit être répliquée ici, même convention que la copie
// locale du worker (commentaire « COPIE LOCALE (T30) » dans watchlist.ts).
//
// Libellés alignés sur le site : secteurs = SECTEUR_LABELS (src/lib/opendata.ts,
// identiques au SECTEUR_LIBELLES du worker) ; types de données = DATA_TYPE_META
// (src/lib/hub-view.ts).

export const SECTEURS = [
  'sante', 'finance', 'retail', 'recherche', 'public',
  'industrie', 'services', 'media', 'autre',
] as const;

export const DATA_TYPES = [
  'identite', 'coordonnees', 'sante', 'financier', 'credentials',
  'biometrique', 'documents', 'geolocalisation', 'autre',
] as const;

export const FREQS = ['quotidien', 'hebdo'] as const;

export type Freq = (typeof FREQS)[number];

/** Puces « 1. Secteurs d'activité » (id = valeur du worker, libellé = site). */
export const SECTEURS_VEILLE: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'sante', label: 'Santé' },
  { id: 'finance', label: 'Finance' },
  { id: 'retail', label: 'Retail' },
  { id: 'recherche', label: 'Recherche' },
  { id: 'public', label: 'Secteur public' },
  { id: 'industrie', label: 'Industrie' },
  { id: 'services', label: 'Services' },
  { id: 'media', label: 'Médias' },
  { id: 'autre', label: 'Autre' },
];

/** Puces « 2. Types de données ». */
export const DONNEES_VEILLE: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'identite', label: 'Identité' },
  { id: 'coordonnees', label: 'Coordonnées' },
  { id: 'sante', label: 'Données de santé' },
  { id: 'financier', label: 'Données financières' },
  { id: 'credentials', label: 'Mots de passe' },
  { id: 'biometrique', label: 'Données biométriques' },
  { id: 'documents', label: 'Documents' },
  { id: 'geolocalisation', label: 'Géolocalisation' },
  { id: 'autre', label: 'Autres données' },
];

/** Préférences éditables sur la page (entités : conservées telles quelles,
 *  la page n'offre pas d'UI pour les modifier — on ne perd jamais la
 *  souscription « par entité » d'un abonné en enregistrant). */
export interface PrefsVeille {
  sectors: string[];
  data_types: string[];
  freq: Freq;
}

function filtrerConnus(brut: unknown, permis: readonly string[]): string[] {
  if (!Array.isArray(brut)) return [];
  return [...new Set(brut.filter((v): v is string => typeof v === 'string' && permis.includes(v)))].sort();
}

/** Réponse GET /api/watchlist/prefs (ou saisie en cours) → PrefsVeille
 *  propres : valeurs inconnues jetées (défense contre un prefs_json ancien),
 *  listes triées pour une comparaison stable, freq hors contrat → « hebdo »
 *  (même défaut que parsePrefs côté worker). */
export function normaliserPrefs(brut: {
  sectors?: unknown;
  data_types?: unknown;
  freq?: unknown;
}): PrefsVeille {
  let freq: Freq = 'hebdo';
  if (brut.freq === 'quotidien' || brut.freq === 'hebdo') freq = brut.freq;
  return {
    sectors: filtrerConnus(brut.sectors, SECTEURS),
    data_types: filtrerConnus(brut.data_types, DATA_TYPES),
    freq,
  };
}

/** Égalité indépendante de l'ordre des puces (listes toujours triées via
 *  normaliserPrefs / getCurrentFormData). */
export function prefsEgales(a: PrefsVeille, b: PrefsVeille): boolean {
  return (
    a.freq === b.freq &&
    a.sectors.length === b.sectors.length &&
    a.data_types.length === b.data_types.length &&
    a.sectors.every((v, i) => v === b.sectors[i]) &&
    a.data_types.every((v, i) => v === b.data_types[i])
  );
}

/** « Vous ne suivez plus rien. » — aucun secteur ET aucun type coché
 *  (sémantique du gabarit : bandeau d'avertissement + bouton « Enregistrer
 *  quand même » ; fréquence seule, jamais comptée comme critère). */
export function prefsVides(p: PrefsVeille): boolean {
  return p.sectors.length === 0 && p.data_types.length === 0;
}
