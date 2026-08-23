// workers/ingest/src/index.ts — worker d'ingestion planifié (T13, Wave 2).
//
// Parcourt les adapters enregistrés (adapter.ts), insère les candidats dans
// D1 (status NEW, id = crypto.randomUUID()) et maintient l'état par source
// dans KV (RUN_STATE) : last_run / last_success / guid_set (dédup guid
// systémique : les guids vus sont repassés à l'adapter ET filtrés par le
// runner lui-même) / circuit breaker (3 échecs consécutifs → disabled +
// alerte console.error).
//
// Détection de mort d'endpoint (T54c, transport-health.ts) : un non-200, un
// 202 ou un HTML là où du XML/JSON était attendu pose le drapeau KV
// source_dead:<id> (contrat du rapport quotidien workers/api) et
// n'enregistre JAMAIS de succès — distinct du circuit breaker, réservé aux
// exceptions : un mensonge HTTP ne doit pas passer pour un jour calme
// (leçons hackmanac 202 / gnews 503 des 22-23/08).
//
// Accès D1/KV uniquement via l'env injecté — interfaces structurelles
// minimales (pas de dépendance @cloudflare/workers-types), donc testable
// par vitest avec des fakes en mémoire.

import { adapters, type Candidate, type SourceAdapter } from './adapter';
import { isDailyRateOk } from '../adapters/cnil';
import { hibpDiffAdapter, HIBP_BREACHES_URL } from '../adapters/hibp';
import { ransomwareLiveAdapter } from '../adapters/ransomware-live';
// Internes du runner (extraction de index.ts — refactor pur, cf. runner-core.ts).
import {
  GUID_SET_MAX,
  insertCandidates,
  readState,
  writeState,
  type D1Database,
  type D1PreparedStatement,
  type KVNamespace,
} from './runner-core';
import { appliquerVerdict, sondeTransport, type VerdictTransport } from './transport-health';

export type { D1Database, D1PreparedStatement, KVNamespace };

export interface Env {
  DB: D1Database;
  RUN_STATE: KVNamespace;
  /**
   * Clé PRO ransomware.live (T54b) — PREMIER secret du worker ingest, passé
   * en en-tête X-API-KEY à api-pro.ransomware.live/victims/recent. Clé
   * maître quarantinée hors dépôt (~/.config/francepassoire/ransomware-live
   * .token) ; création au déploiement :
   *   npx wrangler secret put RANSOMWARE_LIVE_API_KEY --config workers/ingest/wrangler.jsonc
   * Absente : la source est ignorée avec un log fort (problème de
   * configuration, pas un jour calme), sans fetch — last_success vieillit,
   * signal honnête lu par le rapport quotidien workers/api.
   */
  RANSOMWARE_LIVE_API_KEY?: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

/** Tentatives max par source et par run (1 initiale + 2 retries — pas de tempête de retries). */
const MAX_ATTEMPTS = 3;
/** Runs consécutifs en échec avant ouverture du circuit breaker. */
const BREAKER_THRESHOLD = 3;
const BACKOFF_BASE_MS = 200;

export interface SourceRunResult {
  adapter: string;
  inserted: number;
  failed: boolean;
  skipped: boolean;
}

export interface RunOptions {
  fetchFn?: typeof fetch;
  /** Attente entre tentatives — injectable pour des tests rapides. */
  sleep?: (attempt: number) => Promise<void>;
}

function backoffSleep(attempt: number): Promise<void> {
  const delay = BACKOFF_BASE_MS * 2 ** (attempt - 1);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function runSource(
  adapter: SourceAdapter,
  env: Env,
  fetchFn: typeof fetch,
  sleep: (attempt: number) => Promise<void>,
): Promise<SourceRunResult> {
  const state = await readState(env.RUN_STATE, adapter.id);
  if (state.disabled) {
    console.log(`[ingest] source ${adapter.id} désactivée (circuit breaker) — ignorée`);
    return { adapter: adapter.id, inserted: 0, failed: false, skipped: true };
  }

  // Garde de cadence CNIL (contrat T16 : la page sanctions ne doit pas être
  // requêtée plus d'une fois par jour UTC — c'est le runner qui porte la garde).
  if (adapter.id === 'cnil-sanctions' && !isDailyRateOk(state.last_run, new Date())) {
    console.log(`[ingest] source ${adapter.id} déjà requêtée aujourd'hui (cadence quotidienne) — ignorée`);
    return { adapter: adapter.id, inserted: 0, failed: false, skipped: true };
  }

  // T54b : clé PRO ransomware.live absente = problème de configuration, PAS
  // un jour calme — log fort, source ignorée SANS fetch ni écriture d'état.
  // Un appel keyless au PRO répondrait 401 et brouillerait la détection de
  // mort T54c ; enregistrer un succès mentirait au rapport quotidien. En
  // n'écrivant rien, last_success vieillit : c'est le signal honnête.
  if (adapter.id === 'ransomware.live' && !env.RANSOMWARE_LIVE_API_KEY) {
    console.error(
      '[ingest] ALERTE config : secret RANSOMWARE_LIVE_API_KEY absent — source ransomware.live ignorée (aucun fetch). Créer le secret : npx wrangler secret put RANSOMWARE_LIVE_API_KEY --config workers/ingest/wrangler.jsonc',
    );
    return { adapter: adapter.id, inserted: 0, failed: false, skipped: true };
  }

  /**
   * Sortie de run pour mort d'endpoint (T54c) : drapeau KV posé (transition
   * seule, cf. appliquerVerdict), journal fort, last_run mis à jour — mais
   * NI succès enregistré NI circuit breaker armé (le breaker reste réservé
   * aux exceptions). Un mensonge HTTP ne doit jamais passer pour un jour
   * calme, et ne se re-tente pas : il est déterministe.
   */
  const mortTransport = async (v: VerdictTransport): Promise<SourceRunResult> => {
    const maintenant = new Date();
    await writeState(env.RUN_STATE, adapter.id, { ...state, last_run: maintenant.toISOString() });
    await appliquerVerdict(env.RUN_STATE, adapter.id, v, maintenant);
    return { adapter: adapter.id, inserted: 0, failed: true, skipped: false };
  };

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const knownGuids = new Set(state.guid_set);
      // HIBP (fix 23/08) : diff contre le catalogue précédent persisté en KV
      // par ce runner (hibp_catalog) — avant ce fix, l'adapter était amorcé à
      // chaque run et ne produisait JAMAIS de candidat.
      // Si un snapshot KV existe, c'est LA vérité du runner (elle écrase tout
      // previousCatalog d'amorçage). Sinon on garde l'adapter du registre
      // tel quel (permet les tests qui injectent leur propre snapshot).
      // T54b : ransomware.live est réinstancié avec la clé PRO de l'env
      // (factory, même motif que le diff HIBP) — la garde keyless ci-dessus
      // garantit que la clé est présente ici.
      const adapterEffectif =
        adapter.id === 'ransomware.live'
          ? ransomwareLiveAdapter(env.RANSOMWARE_LIVE_API_KEY)
          : adapter.id === 'hibp' && state.hibp_catalog !== undefined
            ? hibpDiffAdapter({ previousCatalog: state.hibp_catalog })
            : adapter;

      let hibpCatalogue: string | undefined;
      const fetchTee: typeof fetch =
        adapter.id === 'hibp'
          ? (async (input: RequestInfo | URL, init?: RequestInit) => {
              const reponse = await fetchFn(input, init);
              if (String(input).startsWith(HIBP_BREACHES_URL) && reponse.ok) {
                hibpCatalogue = await reponse.text();
                return new Response(hibpCatalogue, {
                  status: reponse.status,
                  headers: reponse.headers,
                });
              }
              return reponse;
            }) as typeof fetch
          : fetchFn;

      // T54c : la sonde juge CHAQUE réponse passée à l'adapter (statut +
      // reniflage du format attendu) sans en modifier le comportement.
      const { fetchSonde, verdict } = sondeTransport(adapter.formatAttendu, fetchTee);

      let fetched: Candidate[];
      try {
        fetched = await adapterEffectif.fetchCandidates(fetchSonde, knownGuids);
      } catch (error) {
        // La sonde a vu la réponse mourir AVANT que l'adapter n'échoue à la
        // parser (ex. ransomlook : json() lève sur le HTML servi) : mort
        // d'endpoint T54c, pas une exception de run.
        if (!verdict().ok) return await mortTransport(verdict());
        throw error;
      }
      if (!verdict().ok) return await mortTransport(verdict());
      // Filet runner : les adapters qui ignorent knownGuids (paramètre
      // optionnel du contrat) voient leurs candidats déjà vus filtrés ici
      // aussi — le dédup est systémique, pas seulement par adapter.
      const nouveaux = fetched.filter(
        (candidate) => candidate.guid === undefined || !knownGuids.has(candidate.guid),
      );
      const inserted = await insertCandidates(env.DB, nouveaux);

      const guidSet = state.guid_set.slice();
      const vus = new Set(guidSet);
      for (const candidate of nouveaux) {
        if (candidate.guid !== undefined && !vus.has(candidate.guid)) {
          vus.add(candidate.guid);
          guidSet.push(candidate.guid);
        }
      }

      await writeState(env.RUN_STATE, adapter.id, {
        ...state,
        last_run: new Date().toISOString(),
        last_success: new Date().toISOString(),
        consecutive_failures: 0,
        guid_set: guidSet.slice(-GUID_SET_MAX),
        ...(hibpCatalogue !== undefined ? { hibp_catalog: hibpCatalogue } : {}),
      });
      // T54c : réponse saine → le drapeau de mort éventuel est retiré.
      await appliquerVerdict(env.RUN_STATE, adapter.id, { ok: true }, new Date());
      return { adapter: adapter.id, inserted, failed: false, skipped: false };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await sleep(attempt);
    }
  }

  const consecutive = state.consecutive_failures + 1;
  const disabled = consecutive >= BREAKER_THRESHOLD;
  await writeState(env.RUN_STATE, adapter.id, {
    ...state,
    last_run: new Date().toISOString(),
    consecutive_failures: consecutive,
    disabled,
  });
  if (disabled) {
    console.error(
      `[ingest] ALERTE circuit breaker : ${consecutive} échecs consécutifs, source ${adapter.id} désactivée`,
      lastError,
    );
  } else {
    console.error(
      `[ingest] source ${adapter.id} en échec de run (${consecutive}/${BREAKER_THRESHOLD})`,
      lastError,
    );
  }
  return { adapter: adapter.id, inserted: 0, failed: true, skipped: false };
}

export async function runScheduled(env: Env, options: RunOptions = {}): Promise<SourceRunResult[]> {
  const fetchFn = options.fetchFn ?? fetch;
  const sleep = options.sleep ?? backoffSleep;
  const results: SourceRunResult[] = [];
  for (const adapter of adapters) {
    try {
      results.push(await runSource(adapter, env, fetchFn, sleep));
    } catch (error) {
      // Isolation : une erreur d'infrastructure sur une source n'arrête pas les autres.
      console.error(`[ingest] erreur inattendue pour la source ${adapter.id}`, error);
      results.push({ adapter: adapter.id, inserted: 0, failed: true, skipped: false });
    }
  }
  return results;
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await runScheduled(env);
  },
};
