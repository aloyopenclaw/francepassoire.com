// workers/ingest/src/index.ts — worker d'ingestion planifié (T13, Wave 2).
//
// Parcourt les adapters enregistrés (adapter.ts), insère les candidats dans
// D1 (status NEW, id = crypto.randomUUID()) et maintient l'état par source
// dans KV (RUN_STATE) : last_run / last_success / guid_set (dédup guid
// systémique : les guids vus sont repassés à l'adapter ET filtrés par le
// runner lui-même) / circuit breaker (3 échecs consécutifs → disabled +
// alerte console.error).
//
// Accès D1/KV uniquement via l'env injecté — interfaces structurelles
// minimales (pas de dépendance @cloudflare/workers-types), donc testable
// par vitest avec des fakes en mémoire.

import { adapters, type Candidate, type SourceAdapter } from './adapter';
import { isDailyRateOk } from '../adapters/cnil';

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<{ success: boolean }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface Env {
  DB: D1Database;
  RUN_STATE: KVNamespace;
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
/** Taille max de guid_set par source (FIFO : les plus anciens sont évincés) —
 *  borne la taille de la valeur KV sans jamais dépasser le volume d'un flux
 *  complet (CNIL : 390 sanctions distinctes). */
const GUID_SET_MAX = 500;

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

interface SourceState {
  last_run: string | null;
  last_success: string | null;
  consecutive_failures: number;
  disabled: boolean;
  /** Guids des candidats déjà insérés (≤ GUID_SET_MAX, FIFO) — dédup guid. */
  guid_set: string[];
}

const stateKey = (adapterId: string): string => `ingest:state:${adapterId}`;

async function readState(kv: KVNamespace, adapterId: string): Promise<SourceState> {
  const raw = await kv.get(stateKey(adapterId));
  return raw === null
    ? {
        last_run: null,
        last_success: null,
        consecutive_failures: 0,
        disabled: false,
        guid_set: [],
      }
    : (JSON.parse(raw) as SourceState);
}

const writeState = (kv: KVNamespace, adapterId: string, state: SourceState): Promise<void> =>
  kv.put(stateKey(adapterId), JSON.stringify(state));

async function insertCandidates(db: D1Database, candidates: Candidate[]): Promise<number> {
  for (const candidate of candidates) {
    await db
      .prepare(
        'INSERT INTO candidates (id, source, source_url, raw, entity_name, dedup_score, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        crypto.randomUUID(),
        candidate.source,
        candidate.source_url,
        candidate.raw,
        candidate.entity_name,
        candidate.dedup_score ?? null,
        'NEW',
      )
      .run();
  }
  return candidates.length;
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

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const knownGuids = new Set(state.guid_set);
      const fetched = await adapter.fetchCandidates(fetchFn, knownGuids);
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
      });
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
