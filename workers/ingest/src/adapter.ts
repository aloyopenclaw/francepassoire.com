// workers/ingest/src/adapter.ts — contrat des adapters sources du pipeline (T13).
// Les tâches 14-18 (ransomware.live, RSS médias, CERT-FR, CNIL, fuitesinfos)
// implémentent SourceAdapter et s'enregistrent dans `adapters`.

import { ransomwareLiveAdapter } from '../adapters/ransomware-live';
import { rssAdapters } from '../adapters/rss';
import { certFrAvisAdapter, certFrAlertesAdapter } from '../adapters/cert-fr';
import { cnilSanctionsAdapter } from '../adapters/cnil';
import { hibpDiffAdapter } from '../adapters/hibp';

export type CandidateStatus = 'NEW' | 'DRAFT' | 'PUBLISHED' | 'REJECTED';

/**
 * Candidat normalisé, calqué sur les colonnes de la table D1 `candidates`
 * (migrations/0001_init.sql).
 *
 * L'adapter fournit la partie métier (source, source_url, raw, entity_name) ;
 * le runner (index.ts) assigne id = crypto.randomUUID(), status = 'NEW' et
 * dedup_score = null au moment de l'insertion — ces trois champs restent
 * optionnels dans le contrat.
 *
 * INVARIANT : raw ne contient que des métadonnées publiques, jamais de
 * données personnelles de victimes.
 */
export interface Candidate {
  id?: string;
  source: string;
  source_url: string | null;
  /** Payload normalisé sérialisé en JSON. */
  raw: string;
  entity_name: string | null;
  dedup_score?: number | null;
  status?: CandidateStatus;
}

/**
 * Adapter source : fetch via la fonction injectée (testable avec un mock),
 * normalisation, retourne des candidats. Ne touche ni D1 ni KV — le runner
 * (index.ts) s'en charge, y compris retries et circuit breaker.
 */
export interface SourceAdapter {
  id: string;
  fetchCandidates(fetchFn: typeof fetch): Promise<Candidate[]>;
}

/**
 * Registre des adapters actifs — câblé en T19 (9 sources). Déclaratif :
 * l'ordre du tableau est l'ordre d'exécution du run.
 *
 * cnilDataGouvAdapter (stats /chiffres) n'est PAS enregistré : il ne produit
 * aucun candidat (statistiques agrégées, câblage T36) — l'enregistrer ne
 * ferait que consommer le quota data.gouv.
 *
 * hibpDiffAdapter() est instancié sans snapshot précédent : chaque run fetch
 * le catalogue (amorçage de l'état) et renvoie [] — le premier diff réel
 * exigera la persistance du snapshot par le runner (T47). Idem pour les
 * gardes guid_set (RSS) et cadence CNIL (isDailyRateOk) : à câbler au runner.
 */
export const adapters: SourceAdapter[] = [
  ransomwareLiveAdapter,
  ...rssAdapters,
  certFrAvisAdapter,
  certFrAlertesAdapter,
  cnilSanctionsAdapter,
  hibpDiffAdapter(),
];
