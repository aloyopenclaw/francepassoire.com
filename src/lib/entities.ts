// Résolution d'entités et score de déduplication — tâche 11 (Wave 1).
// Fonctions pures et déterministes, aucune dépendance externe.
//
// IMPORTANT : le score de déduplication alimente UNIQUEMENT des brouillons
// de pull-requests à validation humaine. Aucune fusion automatique de
// fiches ne doit découler de ce module (aucune sémantique d'auto-merge).

// ---------------------------------------------------------------------------
// Types exportés
// ---------------------------------------------------------------------------

/** Candidat renvoyé par l'API recherche-entreprises.api.gouv.fr. */
export interface SirenCandidate {
  siren?: string;
  denomination?: string;
  /** Pertinence calculée localement : similarity(nom demandé, dénomination). */
  score?: number;
}

/** Fonction de récupération injectable (tests → fixture enregistrée). */
export type FetchFn = (url: string) => Promise<Response>;

/** Entrée candidate ou du catalogue pour le score de déduplication. */
export interface EntityRecord {
  /** Nom brut de l'entité (normalisé en interne par normalizeName). */
  entity: string;
  /** Date ISO AAAA-MM-JJ de l'incident / revendication, si connue. */
  date?: string;
  /** Volume de données concerné (personnes, comptes, lignes…), si connu. */
  volume?: number;
}

// ---------------------------------------------------------------------------
// 1. Normalisation de noms français
// ---------------------------------------------------------------------------

// Formes juridiques retirées UNIQUEMENT en fin de nom (convention française :
// « Alaxione SAS », « Foo SARL »). Un token en tête de dénomination est
// conservé (« SAS Services » = dénomination propre). Liste documentée :
export const LEGAL_FORM_TOKENS: ReadonlySet<string> = new Set([
  'sas',
  'sasu',
  'sarl',
  'sa',
  'eurl',
  'ei',
  'scm',
  'snc',
  'gie',
  'association',
  'asso',
]);

/**
 * Normalisation déterministe d'un nom d'entité française :
 *  1. repli des accents (NFKD + retrait des signes diacritiques : é → e)
 *  2. minuscules
 *  3. apostrophes (ASCII, typographiques U+2018/U+2019, accents graves)
 *     supprimées avec jointure de l'élision : « d'Épargne » → « depargne »
 *  4. tirets et slash → espaces (« Pôle-Emploi » → « pole emploi »)
 *  5. ponctuation restante supprimée, espaces multiples collés
 *  6. tokens de forme juridique retirés en fin de nom (tant qu'il reste
 *     plus d'un token — « SAS » seul reste « sas », jamais chaîne vide)
 *
 * Limitation documentée : les formes ponctuées « S.A.S. » ne sont pas
 * repliées en « SAS » (tokens « s a s » distincts).
 */
export function normalizeName(raw: string): string {
  const folded = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc\u2032'`´]/g, '')
    .replace(/[-–—/]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (folded === '') return '';
  const tokens = folded.split(' ');
  while (tokens.length > 1 && LEGAL_FORM_TOKENS.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(' ');
}

// ---------------------------------------------------------------------------
// 2. Similarité token-set ratio (sans dépendance)
// ---------------------------------------------------------------------------

function tokenSet(name: string): Set<string> {
  const n = normalizeName(name);
  return n === '' ? new Set() : new Set(n.split(' '));
}

/**
 * Similarité ∈ [0, 1] entre deux noms, sur les ensembles de tokens
 * normalisés. Formule documentée :
 *
 *   jaccard     = |A ∩ B| / |A ∪ B|            (recouvrement global)
 *   containment = |A ∩ B| / min(|A|, |B|)      (bonus d'inclusion)
 *   similarity  = 0,5 · jaccard + 0,5 · containment
 *
 * Identiques → 1 ; disjoints → 0 ; sous-ensemble strict → ≥ 0,5
 * (ex. « alaxione » ⊂ « alaxione consultants europe » → 2/3).
 * Deux chaînes vides → 1 ; une seule vide → 0.
 */
export function similarity(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const jaccard = inter / (setA.size + setB.size - inter);
  const containment = inter / Math.min(setA.size, setB.size);
  return 0.5 * jaccard + 0.5 * containment;
}

// ---------------------------------------------------------------------------
// 3. Adaptateur SIREN (recherche-entreprises.api.gouv.fr)
// ---------------------------------------------------------------------------

const API_SEARCH_URL = 'https://recherche-entreprises.api.gouv.fr/search';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Recherche le SIREN d'une entité via l'API gouvernementale (gratuite,
 * sans clé). Toute erreur — HTTP non 2xx, JSON malformé, réseau — renvoie
 * un tableau vide : cet adaptateur ne lève jamais.
 *
 * `fetchFn` est injectable ; par défaut `globalThis.fetch`.
 */
export async function resolveSiren(
  name: string,
  fetchFn: FetchFn = (url) => globalThis.fetch(url),
): Promise<SirenCandidate[]> {
  try {
    const res = await fetchFn(
      `${API_SEARCH_URL}?q=${encodeURIComponent(name)}`,
    );
    if (!res.ok) return [];
    const payload: unknown = await res.json();
    if (!isRecord(payload) || !Array.isArray(payload.results)) return [];
    const mapped: SirenCandidate[] = [];
    for (const result of payload.results) {
      if (!isRecord(result)) continue;
      const candidate: SirenCandidate = {};
      if (typeof result.siren === 'string') candidate.siren = result.siren;
      if (typeof result.nom_complet === 'string') {
        candidate.denomination = result.nom_complet;
        candidate.score = similarity(name, result.nom_complet);
      }
      mapped.push(candidate);
    }
    return mapped;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 4. Score de déduplication
// ---------------------------------------------------------------------------

// Pondérations documentées — la sortie ne nourrit que des brouillons de PR.
const WEIGHT_ENTITY = 0.6;
const WEIGHT_DATE = 0.2;
const WEIGHT_VOLUME = 0.2;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Jour julien (nombre de jours UTC) d'une date ISO, ou null si invalide. */
function parseDayNumber(iso: string | undefined): number | null {
  if (typeof iso !== 'string' || !ISO_DATE_RE.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 86_400_000);
}

/**
 * Composante date : |Δ| ≤ 30 j → 1 ; décroissance linéaire jusqu'à 0 à 180 j.
 * Date absente ou invalide d'un côté → 0 (on ne peut pas confirmer).
 */
function dateComponent(a: string | undefined, b: string | undefined): number {
  const dayA = parseDayNumber(a);
  const dayB = parseDayNumber(b);
  if (dayA === null || dayB === null) return 0;
  const diff = Math.abs(dayA - dayB);
  if (diff <= 30) return 1;
  if (diff >= 180) return 0;
  return (180 - diff) / 150;
}

/**
 * Composante volume en échelle logarithmique :
 *   1 − |ln a − ln b| / ln 100
 * → identiques = 1, écart de deux ordres de grandeur (×100) = 0.
 * Volume absent ou ≤ 0 d'un côté → 0.
 */
function volumeComponent(a: number | undefined, b: number | undefined): number {
  if (typeof a !== 'number' || typeof b !== 'number') return 0;
  if (a <= 0 || b <= 0) return 0;
  return Math.max(0, 1 - Math.abs(Math.log(a) - Math.log(b)) / Math.log(100));
}

/**
 * Score de déduplication ∈ [0, 1] :
 *
 *   0,6 · similarity(entités) + 0,2 · (fenêtre de date ±30 j pleine,
 *   décroissant à 0 à 180 j) + 0,2 · (ratio de volume en échelle log)
 *
 * Pur et déterministe (aucun Date.now / aléatoire). Alimente des brouillons
 * de PR uniquement — jamais de fusion automatique.
 */
export function dedupScore(candidate: EntityRecord, entry: EntityRecord): number {
  const total =
    WEIGHT_ENTITY * similarity(candidate.entity, entry.entity) +
    WEIGHT_DATE * dateComponent(candidate.date, entry.date) +
    WEIGHT_VOLUME * volumeComponent(candidate.volume, entry.volume);
  return Math.min(1, Math.max(0, total));
}
