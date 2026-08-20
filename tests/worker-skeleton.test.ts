import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Squelette du worker d'ingestion (T13) : fakes D1/KV en mémoire + fetch
// mocké — aucune dépendance runtime Cloudflare.
import worker, {
  runScheduled,
  type D1Database,
  type D1PreparedStatement,
  type Env,
  type KVNamespace,
} from '../workers/ingest/src/index';
import { adapters, type SourceAdapter } from '../workers/ingest/src/adapter';

interface ExecutedStatement {
  sql: string;
  params: unknown[];
}

function makeEnv(): { env: Env; executed: ExecutedStatement[]; store: Map<string, string> } {
  const executed: ExecutedStatement[] = [];
  const store = new Map<string, string>();
  const db: D1Database = {
    prepare(sql: string) {
      let params: unknown[] = [];
      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]) {
          params = params.concat(values);
          return stmt;
        },
        async run() {
          executed.push({ sql, params: [...params] });
          return { success: true };
        },
      };
      return stmt;
    },
  };
  const runState: KVNamespace = {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
  return { env: { DB: db, RUN_STATE: runState }, executed, store };
}

const okResponse = (): Response => new Response('{}', { status: 200 });
const noSleep = async (): Promise<void> => {};
const runOpts = { fetchFn: async () => okResponse(), sleep: noSleep };

beforeEach(() => {
  // Depuis le câblage T19, le registre contient les 9 vrais adapters : ces
  // tests n'en veulent qu'à leurs fakes — on repart d'un registre vide AVANT
  // chaque test (le reset en afterEach ne suffisait plus).
  adapters.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('worker d’ingestion — contrat adapter', () => {
  it('insère chaque candidat avec status NEW, id UUID et l’état KV de succès', async () => {
    const { env, executed, store } = makeEnv();
    adapters.push({
      id: 'fake-source',
      async fetchCandidates() {
        return [
          {
            source: 'fake-source',
            source_url: 'https://example.fr/alerte-a',
            raw: JSON.stringify({ titre: 'Alerte A' }),
            entity_name: 'Alpha SAS',
          },
          {
            source: 'fake-source',
            source_url: null,
            raw: JSON.stringify({ titre: 'Alerte B' }),
            entity_name: null,
          },
        ];
      },
    });

    const results = await runScheduled(env, runOpts);

    expect(results).toEqual([{ adapter: 'fake-source', inserted: 2, failed: false, skipped: false }]);
    expect(executed).toHaveLength(2);
    for (const stmt of executed) {
      expect(stmt.sql).toMatch(/^INSERT INTO candidates/);
      expect(stmt.params[1]).toBe('fake-source');
      expect(stmt.params[6]).toBe('NEW');
    }
    expect(executed[0]?.params[0]).not.toBe(executed[1]?.params[0]); // UUID distincts
    expect(executed[0]?.params[3]).toBe(JSON.stringify({ titre: 'Alerte A' }));
    expect(executed[0]?.params[4]).toBe('Alpha SAS');
    expect(executed[1]?.params[2]).toBeNull();

    const state = JSON.parse(store.get('ingest:state:fake-source') ?? '{}');
    expect(state.last_run).toBeTruthy();
    expect(state.last_success).toBeTruthy();
    expect(state.consecutive_failures).toBe(0);
    expect(state.disabled).toBe(false);
    expect(state.guid_set).toEqual([]);
  });
});

describe('worker d’ingestion — circuit breaker', () => {
  it('désactive la source après 3 runs consécutifs en échec, la 4e run la skippe sans D1', async () => {
    const { env, executed, store } = makeEnv();
    const failing: SourceAdapter = {
      id: 'boom',
      fetchCandidates: vi.fn(async () => {
        throw new Error('source en panne');
      }),
    };
    adapters.push(failing);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    for (let run = 1; run <= 3; run++) {
      await runScheduled(env, runOpts);
    }

    const state = JSON.parse(store.get('ingest:state:boom') ?? '{}');
    expect(state.disabled).toBe(true);
    expect(state.consecutive_failures).toBe(3);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('circuit breaker'),
      expect.anything(),
    );
    expect(executed).toHaveLength(0); // aucune écriture D1 pour cette source

    // 4e run : skip — fetchCandidates (3 runs × 3 tentatives = 9) n'augmente plus.
    await runScheduled(env, runOpts);
    expect(failing.fetchCandidates).toHaveBeenCalledTimes(9);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(executed).toHaveLength(0);
  });

  it('retombe à zéro après un succès (le compteur ne fuit pas entre runs)', async () => {
    const { env, store } = makeEnv();
    let attempts = 0;
    adapters.push({
      id: 'flaky-recovered',
      async fetchCandidates() {
        attempts += 1;
        if (attempts < 4) throw new Error('échec transitoire');
        return [{ source: 'flaky-recovered', source_url: null, raw: '{}', entity_name: null }];
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Run 1 : 3 tentatives internes, toutes en échec → consecutive_failures = 1.
    await runScheduled(env, runOpts);
    let state = JSON.parse(store.get('ingest:state:flaky-recovered') ?? '{}');
    expect(state.consecutive_failures).toBe(1);
    expect(state.disabled).toBe(false);

    // Run 2 : 4e appel au global (tentative 1 du run) réussit → compteur remis à zéro.
    await runScheduled(env, runOpts);
    state = JSON.parse(store.get('ingest:state:flaky-recovered') ?? '{}');
    expect(state.consecutive_failures).toBe(0);
    expect(state.last_success).toBeTruthy();
  });
});

describe('worker d’ingestion — retries/backoff', () => {
  it('borne à 3 fetch par run, avec backoff entre tentatives et pas après la dernière', async () => {
    const { env } = makeEnv();
    const fetchCalls = vi.fn(async () => okResponse());
    const sleeps: number[] = [];
    adapters.push({
      id: 'flaky',
      async fetchCandidates(fetchFn) {
        await fetchFn('https://example.fr/feed');
        throw new Error('réponse inutilisable');
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const results = await runScheduled(env, {
      fetchFn: fetchCalls,
      sleep: async (attempt) => {
        sleeps.push(attempt);
      },
    });

    expect(fetchCalls).toHaveBeenCalledTimes(3); // 1 tentative + 2 retries max
    expect(sleeps).toEqual([1, 2]);
    expect(results[0]).toEqual({ adapter: 'flaky', inserted: 0, failed: true, skipped: false });
  });
});

describe('worker d’ingestion — isolation', () => {
  it('une source en panne n’empêche pas la suivante d’insérer', async () => {
    const { env, executed } = makeEnv();
    adapters.push(
      {
        id: 'bad',
        async fetchCandidates() {
          throw new Error('panne');
        },
      },
      {
        id: 'good',
        async fetchCandidates() {
          return [
            { source: 'good', source_url: null, raw: JSON.stringify({ ok: true }), entity_name: 'Entité B' },
          ];
        },
      },
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const results = await runScheduled(env, runOpts);

    expect(results.map((r) => r.adapter)).toEqual(['bad', 'good']);
    expect(results[0]?.failed).toBe(true);
    expect(results[1]).toEqual({ adapter: 'good', inserted: 1, failed: false, skipped: false });
    expect(executed).toHaveLength(1);
    expect(executed[0]?.params[1]).toBe('good');
  });

  it('le handler scheduled par défaut complète sans crash sur registre vide', async () => {
    const { env, executed } = makeEnv();
    await expect(
      worker.scheduled(
        { scheduledTime: Date.now(), cron: '*/15 * * * *' },
        env,
        { waitUntil: () => {}, passThroughOnException: () => {} },
      ),
    ).resolves.toBeUndefined();
    expect(executed).toHaveLength(0);
  });
});
