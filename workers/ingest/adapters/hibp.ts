// workers/ingest/adapters/hibp.ts — adapter source HIBP (T17, Wave 2).
//
// Catalogue keyless GET /api/v3/breaches (~1,1 Mo, 200 vérifié en session,
// aucune clé requise) ; DIFF contre le snapshot précédent (clé = Name,
// identifiant stable HIBP) ; filtre de pertinence France conservateur ;
// candidats basse priorité source 'hibp'.
//
// L'adapter reste PUR : ni D1, ni KV, ni horloge. Sans snapshot précédent il
// renvoie [] — le premier run ne fait qu'amorcer l'état ; c'est le runner
// (T19) qui persiste chaque catalogue fraîchement fetché dans RUN_STATE (KV)
// et le repasse ici au run suivant via previousCatalog.
//
// POLITIQUE de priorité : les candidats HIBP sont basse priorité — le
// catalogue est mondial, la fiche qu'il décrit est une métadonnée publique
// (jamais de données de victimes), et la pertinence France est heuristique.
// Ils alimentent la file de relecture éditoriale, jamais une publication
// automatique.
//
// Dates : BreachDate (YYYY-MM-DD) et AddedDate (ISO 8601) sont transportées
// telles quelles dans raw — leur formalisation relève du synthétiseur (T18).
// Règle : jamais perdre un candidat pour une métadonnée non essentielle.

import type { Candidate, SourceAdapter } from '../src/adapter';

export const HIBP_BREACHES_URL = 'https://haveibeenpwned.com/api/v3/breaches';

const USER_AGENT = 'FrancePassoire-Ingest/1.0 (+https://francepassoire.com)';

/** Entrée du catalogue /breaches. Champs utilisés explicitement + transport
 * intégral du reste (Description, DataClasses, IsVerified…) via index. */
export interface BreachSummary {
  Name: string;
  Title?: string;
  Domain?: string;
  BreachDate?: string;
  AddedDate?: string;
  ModifiedDate?: string;
  PwnCount?: number;
  [champ: string]: unknown;
}

export interface HibpDiffOptions {
  /** Catalogue précédent : tableau parsé, ou string JSON telle que stockée en
   * KV par le runner. Absent/illisible → traité comme premier run → []. */
  previousCatalog?: BreachSummary[] | string;
}

/**
 * RÈGLE DE PERTINENCE FRANCE (conservatrice, documentée) — une fuite est
 * gardée SI :
 *   1. son Domain se termine exactement par « .fr » (le suffixe .frl, TLD
 *      réel, ne matche pas), OU
 *   2. son Name normalisé (minuscules, alphanumérique seul) contient un jeton
 *      de FRENCH_ORG_TOKENS — liste CURÉE d'organisations françaises peu
 *      ambiguës. Les jetons ambigus (« orange », « free »…) sont
 *      volontairement ABSENTS : un faux négatif (fuite française manquée,
 *      rattrapée par les autres sources du pipeline) est préféré à un faux
 *      positif. Étendre la liste = édit ici + test.
 */
const FRENCH_ORG_TOKENS: readonly string[] = [
  'alaxione',
  'deezer',
  'doctolib',
  'leboncoin',
  'blablacar',
  'ovh',
  'laposte',
  'sncf',
  'ratp',
  'ameli',
  'engie',
  'carrefour',
  'auchan',
  'fnac',
  'darty',
  'ldlc',
  'leclerc',
  'boulanger',
  'societegenerale',
  'creditagricole',
  'caissedepargne',
  'banquepopulaire',
  'mgen',
];

const normalizeName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function isFranceRelevant(breach: BreachSummary): boolean {
  const domain = typeof breach.Domain === 'string' ? breach.Domain.toLowerCase() : '';
  if (domain.endsWith('.fr')) return true;
  const normalise = normalizeName(breach.Name);
  return FRENCH_ORG_TOKENS.some((token) => normalise.includes(token));
}

/** Entrée exploitable : objet avec un Name non vide (clé de diff). Tout le
 * reste est optionnel et transporté tel quel. */
function isBreachEntry(entry: unknown): entry is BreachSummary {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    !Array.isArray(entry) &&
    typeof (entry as BreachSummary).Name === 'string' &&
    (entry as BreachSummary).Name.length > 0
  );
}

/** Retourne le catalogue précédent utilisable, ou null si absent/illisible
 * (premier run ou snapshot corrompu — dans les deux cas, aucun candidat :
 * on ne génère pas 900 fuites sur une amnésie d'état). */
function parsePreviousCatalog(previous: BreachSummary[] | string | undefined): BreachSummary[] | null {
  if (previous === undefined) return null;
  if (typeof previous === 'string') {
    try {
      const parsed: unknown = JSON.parse(previous);
      return Array.isArray(parsed) ? (parsed.filter(isBreachEntry) as BreachSummary[]) : null;
    } catch {
      return null;
    }
  }
  return previous.filter(isBreachEntry);
}

/** Adapter HIBP : diff du catalogue /breaches contre previousCatalog.
 * Factory — le runner (T19) instancie avec l'état KV du run précédent. */
export function hibpDiffAdapter(options: HibpDiffOptions = {}): SourceAdapter {
  return {
    id: 'hibp',
    // T54c : catalogue JSON attendu.
    formatAttendu: 'json',
    async fetchCandidates(fetchFn: typeof fetch): Promise<Candidate[]> {
      // Le catalogue courant est TOUJOURS fetché — premier run compris : cet
      // appel unique amorce l'état (le runner T19 tee la réponse via son
      // fetchFn enveloppant et persiste le snapshot dans RUN_STATE/KV).
      let currentBody: unknown;
      try {
        const response = await fetchFn(HIBP_BREACHES_URL, {
          headers: { 'User-Agent': USER_AGENT },
        });
        if (!response.ok) return [];
        currentBody = (await response.json()) as unknown;
      } catch {
        return []; // réseau/parse en échec → aucun candidat, jamais d'exception
      }
      if (!Array.isArray(currentBody)) return [];

      const previous = parsePreviousCatalog(options.previousCatalog);
      if (previous === null) return []; // premier run/snapshot illisible : amorçage uniquement

      const previousNames = new Set(previous.map((breach) => breach.Name));
      const candidates: Candidate[] = [];
      for (const entry of currentBody) {
        if (!isBreachEntry(entry)) continue; // entrée non exploitable → ignorée
        if (previousNames.has(entry.Name)) continue; // déjà connue : modifiée ≠ nouvelle
        if (!isFranceRelevant(entry)) continue; // hors périmètre France
        candidates.push({
          source: 'hibp',
          source_url: null,
          entity_name: entry.Name,
          raw: JSON.stringify(entry), // JSON complet de la fuite, tel que servi
        });
      }
      return candidates;
    },
  };
}
