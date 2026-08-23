// workers/ingest/src/adapter.ts — contrat des adapters sources du pipeline (T13).
// Les tâches 14-18 (ransomware.live, RSS médias, CERT-FR, CNIL, fuitesinfos)
// implémentent SourceAdapter et s'enregistrent dans `adapters`.

import { ransomwareLiveAdapter } from '../adapters/ransomware-live';
import { ransomlookAdapter } from '../adapters/ransomlook';
import { rssAdapters } from '../adapters/rss';
import { certFrAvisAdapter, certFrAlertesAdapter } from '../adapters/cert-fr';
import { cnilSanctionsAdapter } from '../adapters/cnil';
import { hibpDiffAdapter } from '../adapters/hibp';

export type CandidateStatus = 'NEW' | 'DRAFT' | 'PUBLISHED' | 'REJECTED';

/**
 * Format de corps attendu d'un adapter (détection de mort d'endpoint, T54c).
 * Déclaratif : l'adapter n'implémente rien, c'est la sonde transport du
 * runner (transport-health.ts) qui renifle chaque réponse pour tout le
 * registre.
 */
export type FormatAttendu = 'xml' | 'json';

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
  /**
   * Guid stable de dédup calculé par l'adapter (jointure déterministe des
   * champs identifiants de la source, cf. guidSanction dans cnil.ts). Le
   * runner l'enregistre dans guid_set (KV RUN_STATE) et filtre les candidats
   * déjà vus — optionnel : un candidat sans guid passe à chaque run.
   */
  guid?: string;
}

/**
 * Adapter source : fetch via la fonction injectée (testable avec un mock),
 * normalisation, retourne des candidats. Ne touche ni D1 ni KV — le runner
 * (index.ts) s'en charge, y compris retries et circuit breaker.
 *
 * @param knownGuids Optionnel : guids déjà vus (guid_set KV persisté par le
 *        runner) — un adapter cooperatif filtre lui-même les candidats
 *        correspondants ; le runner applique de toute façon un filet
 *        équivalent après le fetch (les adapters qui ignorent le paramètre
 *        restent conformes au contrat).
 */
export interface SourceAdapter {
  id: string;
  /**
   * Format de corps attendu (T54c) : un HTML servi là où 'xml'/'json' était
   * attendu pose le drapeau KV source_dead:<id>. Absent (ex. cnil-sanctions,
   * dont la page est en HTML par design) : seule la santé du statut HTTP est
   * contrôlée.
   */
  formatAttendu?: FormatAttendu;
  fetchCandidates(fetchFn: typeof fetch, knownGuids?: Set<string>): Promise<Candidate[]>;
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
 * exigera la persistance du snapshot par le runner (T47). Les gardes guid_set
 * (dédup guid systémique) et cadence CNIL (isDailyRateOk) sont câblées au
 * runner depuis le fix soak de la tâche 20.
 */
export const adapters: SourceAdapter[] = [
  // T54b : instancié SANS clé ici (registre statique) ; le runner injecte le
  // secret env.RANSOMWARE_LIVE_API_KEY à chaque run (index.ts, motif HIBP) —
  // l'instance keyless ne fetch JAMAIS (log fort + []).
  ransomwareLiveAdapter(undefined),
  ransomlookAdapter(),
  ...rssAdapters,
  certFrAvisAdapter,
  certFrAlertesAdapter,
  cnilSanctionsAdapter,
  hibpDiffAdapter(),
];
