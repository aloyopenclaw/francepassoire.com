import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
// T54c — détection de mort d'endpoint (workers/ingest/src/transport-health.ts).
// Leçons verrouillées (2026-08-22/23) : hackmanac 202 + HTML anti-bot et
// gnews 503 moissonnaient « rien » en silence, comme des jours calmes.
// Ici : un non-200 / 202 / HTML-là-où-du-XML-JSON-était-attendu pose le
// drapeau KV source_dead:<id> (contrat du rapport quotidien workers/api),
// journal fort en TRANSITION seule, drapeau retiré au premier 2xx sain —
// le circuit breaker (exceptions) reste intouché.
// Fakes D1/KV + manipulation du registre : motifs de worker-skeleton.test.ts
// et pipeline-integration.test.ts.
import {
  runScheduled,
  type D1Database,
  type D1PreparedStatement,
  type Env,
  type KVNamespace,
} from '../workers/ingest/src/index';
import { adapters } from '../workers/ingest/src/adapter';
import { makeRssAdapter } from '../workers/ingest/adapters/rss';
import { ransomwareLiveAdapter } from '../workers/ingest/adapters/ransomware-live';
import { ransomlookAdapter, RANSOMLOOK_RECENT_URL } from '../workers/ingest/adapters/ransomlook';
import {
  sondeTransport,
  sourceDeadKey,
  verdictCorps,
  verdictStatut,
  type SourceDeadFlag,
} from '../workers/ingest/src/transport-health';

// ---------------------------------------------------------------------------
// Fakes D1/KV en mémoire (même motif que tests/worker-skeleton.test.ts).
// ---------------------------------------------------------------------------

function makeEnv(): { env: Env; executed: string[]; store: Map<string, string> } {
  const executed: string[] = [];
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
          if (sql.startsWith('INSERT INTO candidates') && params.length === 7) executed.push('INSERT');
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
    async delete(key) {
      store.delete(key);
    },
  };
  return { env: { DB: db, RUN_STATE: runState }, executed, store };
}

const fixturesDir = fileURLToPath(new URL('./fixtures/adapters/', import.meta.url));
const loadFixture = (name: string): string => readFileSync(`${fixturesDir}${name}`, 'utf-8');

const noSleep = async (): Promise<void> => {};

/** fetch injecté qui sert une fixture avec un statut donné, quelle que soit l'URL. */
const fetchServing = (body: string, status: number): typeof fetch =>
  (async () => new Response(body, { status })) as typeof fetch;

/** fetch injecté qui route par URL : Record<url, [corps, statut]> + repli 404. */
const fetchRouting = (routes: Record<string, [string, number]>): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const route = routes[url];
    return new Response(route === undefined ? '' : route[0], {
      status: route === undefined ? 404 : route[1],
    });
  }) as typeof fetch;

const adapterMort = makeRssAdapter({ id: 'rss:morte', name: 'Morte', url: 'https://mort.example/feed' });
const adapterZataz = makeRssAdapter({
  id: 'rss:zataz',
  name: 'Zataz',
  url: 'https://www.zataz.com/feed/',
});

// ---------------------------------------------------------------------------
// Registre + espions console — repartir d'un registre nettoyé puis restaurer
// le registre câblé T19 (motif pipeline-integration.test.ts).
// ---------------------------------------------------------------------------

const originalAdapters = [...adapters];
let errorSpy: MockInstance<(...data: unknown[]) => void>;
let logSpy: MockInstance<(...data: unknown[]) => void>;

beforeEach(() => {
  adapters.length = 0;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  adapters.length = 0;
  adapters.push(...originalAdapters);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Verdicts purs.
// ---------------------------------------------------------------------------

describe('T54c · verdicts transport (purs)', () => {
  it('sourceDeadKey : préfixe exact du contrat rapport quotidien', () => {
    expect(sourceDeadKey('rss:01net')).toBe('source_dead:rss:01net');
  });

  it('tout non-2xx est mort, avec la raison http-<code>', () => {
    expect(verdictStatut(404)).toEqual({ ok: false, reason: 'http-404' });
    expect(verdictStatut(503)).toEqual({ ok: false, reason: 'http-503' });
    expect(verdictStatut(401)).toEqual({ ok: false, reason: 'http-401' });
    expect(verdictStatut(301)).toEqual({ ok: false, reason: 'http-301' });
  });

  it('202 est mort malgré res.ok (leçon hackmanac : 202 + anti-bot = moisson vide)', () => {
    expect(verdictStatut(202)).toEqual({ ok: false, reason: 'http-202' });
  });

  it('200/201/204 sont sains au niveau statut', () => {
    expect(verdictStatut(200)).toEqual({ ok: true });
    expect(verdictStatut(201)).toEqual({ ok: true });
    expect(verdictStatut(204)).toEqual({ ok: true });
  });

  it('XML attendu : HTML servi (BOM + blancs de tête) => html-ou-xml-attendu', () => {
    expect(verdictCorps('xml', '\ufeff\n<!DOCTYPE html><html><body>404</body></html>')).toEqual({
      ok: false,
      reason: 'html-ou-xml-attendu',
    });
    expect(verdictCorps('xml', '  \t<HTML lang="fr"><head></head></html>')).toEqual({
      ok: false,
      reason: 'html-ou-xml-attendu',
    });
  });

  it('XML attendu : <?xml / <rss / <feed sont sains ; corps non-HTML non plus un mensonge', () => {
    expect(verdictCorps('xml', '<?xml version="1.0"?><rss/>')).toEqual({ ok: true });
    expect(verdictCorps('xml', '<rss version="2.0"><channel/></rss>')).toEqual({ ok: true });
    expect(verdictCorps('xml', '<feed xmlns="http://www.w3.org/2005/Atom"/>')).toEqual({ ok: true });
    // Texte d'erreur nu : pas une page HTML positive, la sonde ne tue pas
    // (le parseur adapter gère déjà ce cas par []).
    expect(verdictCorps('xml', 'rate limit exceeded')).toEqual({ ok: true });
    expect(verdictCorps('xml', '')).toEqual({ ok: true });
  });

  it('JSON attendu : tout corps ouvrant par < est mort ; tableau/objet/corps vide sains', () => {
    expect(verdictCorps('json', loadFixture('json-dead-html.html'))).toEqual({
      ok: false,
      reason: 'html-ou-json-attendu',
    });
    expect(verdictCorps('json', '[1, 2]')).toEqual({ ok: true });
    expect(verdictCorps('json', '{"a": 1}')).toEqual({ ok: true });
    expect(verdictCorps('json', '')).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Sonde transport (fetch enveloppé).
// ---------------------------------------------------------------------------

describe('T54c · sonde transport (fetch enveloppé)', () => {
  it('200 sain : verdict ok et corps restitué intégralement à l’adapter', async () => {
    const xml = loadFixture('rss-zataz.xml');
    const { fetchSonde, verdict } = sondeTransport(
      'xml',
      (async () => new Response(xml, { status: 200 })) as typeof fetch,
    );

    const reponse = await fetchSonde('https://www.zataz.com/feed/');

    expect(verdict()).toEqual({ ok: true });
    await expect(reponse.text()).resolves.toBe(xml);
  });

  it('réponse en erreur : verdict mort SANS consommer le corps (l’adapter peut encore le lire)', async () => {
    const { fetchSonde, verdict } = sondeTransport(
      'xml',
      (async () => new Response('<html>panne</html>', { status: 503 })) as typeof fetch,
    );

    const reponse = await fetchSonde('https://mort.example/feed');

    expect(verdict()).toEqual({ ok: false, reason: 'http-503' });
    expect(reponse.status).toBe(503);
    await expect(reponse.text()).resolves.toBe('<html>panne</html>');
  });

  it('le premier mensonge gagne sur un run multi-fetch (le 200 suivant ne réveille pas)', async () => {
    const statuts = [404, 200];
    const { fetchSonde, verdict } = sondeTransport(
      'json',
      (async () => new Response('[]', { status: statuts.shift() ?? 500 })) as typeof fetch,
    );

    await fetchSonde('https://a.example/api');
    await fetchSonde('https://b.example/api');

    expect(verdict()).toEqual({ ok: false, reason: 'http-404' });
  });

  it('un mensonge APRÈS un fetch sain fait mourir le run entier', async () => {
    const statuts = [200, 202];
    const { fetchSonde, verdict } = sondeTransport(
      'json',
      (async () => new Response('[]', { status: statuts.shift() ?? 500 })) as typeof fetch,
    );

    await fetchSonde('https://a.example/api');
    await fetchSonde('https://b.example/api');

    expect(verdict()).toEqual({ ok: false, reason: 'http-202' });
  });

  it('204 (statut sans corps) : réponse rendue telle quelle, jamais reconstruite', async () => {
    const reponseOrigine = new Response(null, { status: 204 });
    const { fetchSonde, verdict } = sondeTransport(
      'xml',
      (async () => reponseOrigine) as typeof fetch,
    );

    const reponse = await fetchSonde('https://example.fr/feed');

    expect(verdict()).toEqual({ ok: true });
    expect(reponse).toBe(reponseOrigine);
  });
});

// ---------------------------------------------------------------------------
// Intégration runner — les cinq scénarios verrouillés + isolation.
// ---------------------------------------------------------------------------

describe('T54c · run — mort d’endpoint via runScheduled', () => {
  it('(a) 404-HTML sur flux RSS : drapeau posé, console.error fort, jamais un succès silencieux', async () => {
    adapters.push(adapterMort);
    const { env, executed, store } = makeEnv();

    const results = await runScheduled(env, {
      fetchFn: fetchServing(loadFixture('rss-dead-404.html'), 404),
      sleep: noSleep,
    });

    // Pas de jour calme : la moisson vide de l'adapter n'est PAS un succès.
    expect(results).toEqual([{ adapter: 'rss:morte', inserted: 0, failed: true, skipped: false }]);
    expect(executed).toHaveLength(0);
    const etat = JSON.parse(store.get('ingest:state:rss:morte') ?? '{}');
    expect(etat.last_run).toBeTruthy();
    expect(etat.last_success).toBeNull();
    // Breaker intouché : il ne compte que les exceptions.
    expect(etat.consecutive_failures).toBe(0);
    expect(etat.disabled).toBe(false);

    // Drapeau : forme EXACTE du contrat {since ISO, reason} (rapport workers/api).
    const drapeau = JSON.parse(store.get('source_dead:rss:morte') ?? 'null') as SourceDeadFlag;
    expect(drapeau).toEqual({ since: expect.any(String), reason: 'http-404' });
    expect(new Date(drapeau.since).toISOString()).toBe(drapeau.since);

    // Journal fort de transition : id de la source + raison.
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('rss:morte'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('http-404'));
  });

  it('(b) 202 + interstitiel anti-bot (hackmanac) : morte http-202 bien que res.ok soit vrai', async () => {
    adapters.push(adapterMort);
    const { env, store } = makeEnv();

    const results = await runScheduled(env, {
      fetchFn: fetchServing(loadFixture('rss-dead-202-antibot.html'), 202),
      sleep: noSleep,
    });

    expect(results).toEqual([{ adapter: 'rss:morte', inserted: 0, failed: true, skipped: false }]);
    const drapeau = JSON.parse(store.get('source_dead:rss:morte') ?? 'null') as SourceDeadFlag;
    expect(drapeau).toEqual({ since: expect.any(String), reason: 'http-202' });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('http-202'));
  });

  it('(c) HTML servi à une API JSON : html-ou-json-attendu, l’exception de parsing est dévancée (breaker intouché)', async () => {
    // ransomlook lève sur json() d'un corps HTML : sans la sonde, ce cas
    // armait le breaker comme une exception de run. La détection T54c
    // devance : mort d'endpoint, compteur intact.
    adapters.push(ransomlookAdapter());
    const { env, store } = makeEnv();

    const results = await runScheduled(env, {
      fetchFn: fetchRouting({ [RANSOMLOOK_RECENT_URL]: [loadFixture('json-dead-html.html'), 200] }),
      sleep: noSleep,
    });

    expect(results).toEqual([{ adapter: 'ransomlook', inserted: 0, failed: true, skipped: false }]);
    const drapeau = JSON.parse(store.get('source_dead:ransomlook') ?? 'null') as SourceDeadFlag;
    expect(drapeau).toEqual({ since: expect.any(String), reason: 'html-ou-json-attendu' });
    const etat = JSON.parse(store.get('ingest:state:ransomlook') ?? '{}');
    expect(etat.consecutive_failures).toBe(0);
    expect(etat.disabled).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ransomlook'));
  });

  it('(d) flux sain : aucun drapeau posé ; un drapeau existant est retiré au 2xx sain', async () => {
    adapters.push(adapterZataz);
    const { env, store } = makeEnv();
    store.set(
      'source_dead:rss:zataz',
      JSON.stringify({ since: '2026-08-22T10:00:00.000Z', reason: 'http-503' }),
    );

    const results = await runScheduled(env, {
      fetchFn: fetchRouting({ 'https://www.zataz.com/feed/': [loadFixture('rss-zataz.xml'), 200] }),
      sleep: noSleep,
    });

    expect(results).toEqual([{ adapter: 'rss:zataz', inserted: 6, failed: false, skipped: false }]);
    expect(store.has('source_dead:rss:zataz')).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('de nouveau joignable'));
  });

  it('(d bis) flux sain jamais mort : aucune clé source_dead n’apparaît', async () => {
    adapters.push(adapterZataz);
    const { env, store } = makeEnv();

    await runScheduled(env, {
      fetchFn: fetchRouting({ 'https://www.zataz.com/feed/': [loadFixture('rss-zataz.xml'), 200] }),
      sleep: noSleep,
    });

    expect([...store.keys()].filter((cle) => cle.startsWith('source_dead:'))).toEqual([]);
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('de nouveau joignable'));
  });

  it('(e) 2e run toujours morte : UN SEUL journal de transition, since jamais réécrit', async () => {
    adapters.push(adapterMort);
    const { env, store } = makeEnv();
    const fetchFn = fetchServing(loadFixture('rss-dead-404.html'), 404);

    await runScheduled(env, { fetchFn, sleep: noSleep });
    const sinceRun1 = (JSON.parse(store.get('source_dead:rss:morte') ?? 'null') as SourceDeadFlag).since;
    await runScheduled(env, { fetchFn, sleep: noSleep });
    const drapeau2 = JSON.parse(store.get('source_dead:rss:morte') ?? 'null') as SourceDeadFlag;

    // Transition unique : la 2e alerte est un console.log discret.
    const alertesFortes = errorSpy.mock.calls.filter(([message]) =>
      String(message).includes('source morte'),
    );
    expect(alertesFortes).toHaveLength(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('toujours morte'));
    // La date de première mort est stable (le rapport quotidien n'est pas
    // trompé sur l'ancienneté de la panne).
    expect(drapeau2.reason).toBe('http-404');
    expect(drapeau2.since).toBe(sinceRun1);
  });

  it('isolation : ransomware.live en 401 (clé PRO rejetée) ne perturbe pas le flux sain suivant', async () => {
    adapters.push(ransomwareLiveAdapter('cle-test'), adapterZataz);
    const { env, store } = makeEnv();
    env.RANSOMWARE_LIVE_API_KEY = 'cle-test';

    const results = await runScheduled(env, {
      fetchFn: fetchRouting({
        'https://api-pro.ransomware.live/victims/recent': ['', 401],
        'https://www.zataz.com/feed/': [loadFixture('rss-zataz.xml'), 200],
      }),
      sleep: noSleep,
    });

    expect(results).toEqual([
      { adapter: 'ransomware.live', inserted: 0, failed: true, skipped: false },
      { adapter: 'rss:zataz', inserted: 6, failed: false, skipped: false },
    ]);
    expect(JSON.parse(store.get('source_dead:ransomware.live') ?? 'null')).toEqual({
      since: expect.any(String),
      reason: 'http-401',
    });
    expect(store.has('source_dead:rss:zataz')).toBe(false);
  });

  it('T54b : clé PRO absente — source ignorée sans fetch ni écriture (last_success vieillira, aucun drapeau)', async () => {
    // Même instance keyless que le registre statique (adapter.ts) — le runner
    // instancie avec la clé de l'env ; ici env n'en a PAS.
    adapters.push(ransomwareLiveAdapter(undefined), adapterZataz);
    const { env, store } = makeEnv();
    const appels: string[] = [];
    const fetchCompteur: typeof fetch = (async (input: RequestInfo | URL) => {
      appels.push(String(input instanceof Request ? input.url : input));
      return fetchRouting({ 'https://www.zataz.com/feed/': [loadFixture('rss-zataz.xml'), 200] })(input);
    }) as typeof fetch;

    const results = await runScheduled(env, { fetchFn: fetchCompteur, sleep: noSleep });

    // Config, pas un jour calme : skipped avec log fort — mais PAS failed
    // (aucun mensonge de transport) et le flux suivant reste sain.
    expect(results).toEqual([
      { adapter: 'ransomware.live', inserted: 0, failed: false, skipped: true },
      { adapter: 'rss:zataz', inserted: 6, failed: false, skipped: false },
    ]);
    // Le PRO n'a JAMAIS été contacté (un appel keyless aurait répondu 401 et
    // brouillé la détection de mort en source_dead:http-401).
    expect(appels).toEqual(['https://www.zataz.com/feed/']);
    // Aucun drapeau de mort ET aucun état écrit : sans succès enregistré,
    // last_success vieillit — le signal honnête du rapport quotidien.
    expect(store.has('source_dead:ransomware.live')).toBe(false);
    expect(store.has('ingest:state:ransomware.live')).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('RANSOMWARE_LIVE_API_KEY'));
  });

  it('adapter sans fetch (corpus synthétique) : run sain, zéro drapeau', async () => {
    adapters.push({
      id: 'corpus-sans-fetch',
      async fetchCandidates() {
        return [
          {
            source: 'corpus',
            source_url: null,
            raw: JSON.stringify({ titre: 'Alerte' }),
            entity_name: 'Entité SAS',
          },
        ];
      },
    });
    const { env, executed, store } = makeEnv();

    const results = await runScheduled(env, { fetchFn: fetchServing('{}', 200), sleep: noSleep });

    expect(results).toEqual([
      { adapter: 'corpus-sans-fetch', inserted: 1, failed: false, skipped: false },
    ]);
    expect(executed).toHaveLength(1);
    expect([...store.keys()].filter((cle) => cle.startsWith('source_dead:'))).toEqual([]);
  });
});
