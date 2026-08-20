import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Suite d'intégration pipeline (tâche 20, Wave 2) — la chaîne COMPLÈTE sur un
// corpus de 20 candidats : adapters réels (cassettes fixture enregistrées)
// → runner T13 (D1 + KV, fakes en mémoire) → synthétiseur T18 (+ dedup T11)
// → décision PR (seuil dedup_score + repli slug T8→T19) → openDraftPr T19
// (GithubClient fake). Aucun réseau réel, aucun jeton.
//
// Fakes réutilisés depuis les motifs établis de tests/worker-skeleton.test.ts
// (makeEnv : D1/KV en mémoire) et tests/pr-automation.test.ts (FakeGithub).
//
// NOTE DE CÂBLAGE (T47) : la colle ci-dessous (décision PR + pont slug) vit
// aujourd'hui dans ce test car le worker déployé n'exécute volontairement que
// la phase ingestion (cron → D1, status NEW) : l'ouverture des PR attend le
// secret FRANCEPASSOIRE_GH_TOKEN (chemin PENDING_KEYS — jamais de PR sans
// jeton, zéro erreur sans jeton, cf. test « doré » ci-dessous).

import {
  runScheduled,
  type D1Database,
  type D1PreparedStatement,
  type Env,
  type KVNamespace,
} from '../workers/ingest/src/index';
import { adapters, type Candidate, type SourceAdapter } from '../workers/ingest/src/adapter';
import { ransomwareLiveAdapter } from '../workers/ingest/adapters/ransomware-live';
import { makeRssAdapter } from '../workers/ingest/adapters/rss';
import { hibpDiffAdapter } from '../workers/ingest/adapters/hibp';
import { CNIL_SANCTIONS_URL, cnilSanctionsAdapter } from '../workers/ingest/adapters/cnil';
import { openDraftPr, type GithubClient } from '../workers/ingest/src/pr-automation';
import { synthesizeDraft, type FicheDraft } from '../src/lib/synthesize';
import type { EntityRecord } from '../src/lib/entities';

// ---------------------------------------------------------------------------
// Fakes D1/KV en mémoire — même motif que tests/worker-skeleton.test.ts,
// augmenté : les lignes insérées sont lisibles en retour (SELECT simulé) pour
// piloter la phase de décision sur les lignes D1 réellement écrites.
// ---------------------------------------------------------------------------

interface InsertedRow {
  id: string;
  source: string;
  source_url: string | null;
  raw: string;
  entity_name: string | null;
  dedup_score: number | null;
  status: string;
}

function makeEnv(): { env: Env; rows: InsertedRow[]; store: Map<string, string> } {
  const rows: InsertedRow[] = [];
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
          if (sql.startsWith('INSERT INTO candidates')) {
            const [id, source, source_url, raw, entity_name, dedup_score, status] = params as [
              string,
              string,
              string | null,
              string,
              string | null,
              number | null,
              string,
            ];
            rows.push({ id, source, source_url, raw, entity_name, dedup_score, status });
          }
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
  return { env: { DB: db, RUN_STATE: runState }, rows, store };
}

// ---------------------------------------------------------------------------
// Fake GithubClient — même motif que tests/pr-automation.test.ts, augmenté :
// un PR créé devient un head OUVERT (comportement réel de GitHub), ce qui fait
// replier les doublons de slug sur UN seul PR via la garde findOpenPullByHead.
// ---------------------------------------------------------------------------

class FakeGithub implements GithubClient {
  mainSha = 'a1b2c3d4e5f6';
  nextPrNumber = 42;

  createdRefs: { ref: string; sha: string }[] = [];
  putFiles: { path: string; branch: string }[] = [];
  pulls: { number: number; title: string; head: string; base: string; body: string }[] = [];
  openHeads = new Set<string>();

  async getMainSha(): Promise<string> {
    return this.mainSha;
  }
  async createRef(ref: string, sha: string): Promise<void> {
    this.createdRefs.push({ ref, sha });
  }
  async putFile(input: { path: string; branch: string }): Promise<void> {
    this.putFiles.push({ path: input.path, branch: input.branch });
  }
  async createPullRequest(input: {
    title: string;
    head: string;
    base: string;
    body: string;
  }): Promise<{ number: number }> {
    const number = this.nextPrNumber++;
    this.pulls.push({ number, ...input });
    this.openHeads.add(input.head);
    return { number };
  }
  async findOpenPullByHead(head: string): Promise<{ number: number } | null> {
    return this.openHeads.has(head) ? { number: 7 } : null;
  }
}

// ---------------------------------------------------------------------------
// Cassettes fixture réelles + fetch injecté qui route par URL.
// ---------------------------------------------------------------------------

const fixturesDir = fileURLToPath(new URL('./fixtures/adapters/', import.meta.url));
const loadFixture = (name: string): string => readFileSync(`${fixturesDir}${name}`, 'utf-8');

const ROUTES: Record<string, string> = {
  'https://api.ransomware.live/v2/recentvictims': loadFixture('ransomware-live-recent.json'),
  'https://www.zataz.com/feed/': loadFixture('rss-zataz.xml'),
  // Flux malformé servi au flux ZDNet : 0 candidat, la chaîne continue.
  'https://www.zdnet.fr/feed': loadFixture('rss-malformed.xml'),
  'https://haveibeenpwned.com/api/v3/breaches': loadFixture('hibp-snapshot-b.json'),
};

const fixtureFetch: typeof fetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  const body = ROUTES[url];
  return new Response(body ?? '', { status: body === undefined ? 404 : 200 });
}) as typeof fetch;

// ---------------------------------------------------------------------------
// Corpus synthétique (10 candidats, façonnés au format adapter) : chaque cas
// de figure de la décision PR que les cassettes seules ne produisent pas.
// ---------------------------------------------------------------------------

const syntheticCandidate = (
  source: string,
  entity_name: string | null,
  payload: unknown,
  source_url: string | null = null,
): Candidate => ({
  source,
  source_url,
  raw: typeof payload === 'string' ? payload : JSON.stringify(payload),
  entity_name,
});

const SYNTHETIC_CORPUS: Candidate[] = [
  // Doublon exact du catalogue (score 1.0 ≥ seuil) → PAS de PR.
  syntheticCandidate('rss', 'Alaxione', {
    claim_date: '2026-02-11',
    volume: 1250000,
    siren: '811197557',
  }),
  // Fuite FR fraîche, hors catalogue (score 0) → PR #1.
  syntheticCandidate('rss', 'VitteAuto', {
    claim_date: '2026-07-30',
    volume: 4210,
    volume_unit: 'personnes',
    siren: '123456789',
    secteur: 'services',
  }),
  // Même fuite vue d'une 2e source : même slug → repli duplicate, PAS de 2e PR.
  syntheticCandidate('ransomware.live', 'VitteAuto', {
    claim_date: '2026-07-30',
    volume: '4210', // chaîne de chiffres : volume crédible au sens T18
  }),
  // Presque-catalogue SOUS le seuil (0.4) → PR #2 (le seuil ne jette pas tout).
  syntheticCandidate('rss', 'Alaxio', {
    claim_date: '2026-02-11',
    volume: 1250000,
  }),
  // Frontière juste AU-DESSUS du seuil (0.85) → PAS de PR.
  syntheticCandidate('rss', 'Alaxione Conseil', {
    claim_date: '2026-02-11',
    volume: 1250000,
  }),
  // Entité inconnue → rejet T18 (candidat sans entity_name exploitable).
  syntheticCandidate('rss', null, { claim_date: '2026-08-01', volume: 100 }),
  // Payload malformé → rejet T18 (raw non parsable).
  syntheticCandidate('rss', 'EntitéXML', '<html>pas du JSON</html>'),
  // Payload JSON valide mais non-objet → rejet T18.
  syntheticCandidate('rss', 'EntitéTableau', '[1, 2, 3]'),
  // Entité + raw valides mais sans date parsable ni volume → slug null → pas
  // de PR ouvrable (dedup 0.6 < seuil : c'est bien le slug qui bloque).
  syntheticCandidate('rss', 'IRD', { secteur: 'recherche' }),
  // 3e occurrence de VitteAuto (source hibp, volume différent) → toujours UN PR.
  syntheticCandidate('hibp', 'VitteAuto', {
    claim_date: '2026-07-30',
    volume: 5000,
  }),
];

const corpusAdapter: SourceAdapter = {
  id: 'corpus-t20',
  async fetchCandidates(): Promise<Candidate[]> {
    return SYNTHETIC_CORPUS;
  },
};

// Catalogue de dédup T11 : les 2 fiches ancrages de la tâche 12.
const CATALOG: EntityRecord[] = [
  { entity: 'Alaxione', date: '2026-02-11', volume: 1250000 },
  { entity: 'IRD', date: '2026-08-17', volume: 7500 },
];

// ---------------------------------------------------------------------------
// Colle de la phase PR — ce que le câblage runtime T47 devra reprendre.
// ---------------------------------------------------------------------------

/** Seuil documenté : dedup_score ≥ 0.8 contre le catalogue → pas de PR. */
const DEDUP_THRESHOLD = 0.8;

/**
 * Pont slug T8 → T19 : ficheSlug (T8) émet le chemin complet /fuite/<slug>/
 * (contrat épinglé par tests/synthesize.test.ts) tandis qu'openDraftPr (T19)
 * exige le slug nu [a-z0-9-]+ (contrat épinglé par tests/pr-automation.test.ts).
 * La composition doit faire le pont — noté pour le câblage T47.
 */
function bareSlug(draft: FicheDraft): string {
  const slug = draft.slug;
  if (slug === null) return '';
  return slug.replace(/^\/fuite\//, '').replace(/\/$/, '');
}

interface PrDecisionRow {
  row: InsertedRow;
  outcome:
    | { kind: 'no_entity' | 'bad_raw' | 'no_slug'; reason: string }
    | { kind: 'dedup_threshold'; dedup_score: number }
    | { kind: 'pr'; number: number }
    | { kind: 'duplicate' };
}

async function decideAndOpen(
  rows: InsertedRow[],
  gh: GithubClient,
): Promise<PrDecisionRow[]> {
  const decisions: PrDecisionRow[] = [];
  for (const row of rows) {
    const candidate: Candidate = {
      id: row.id,
      source: row.source,
      source_url: row.source_url,
      raw: row.raw,
      entity_name: row.entity_name,
    };
    const result = synthesizeDraft(candidate, { catalogEntries: CATALOG });
    if (!result.ok) {
      const kind = result.reason.includes('entité') ? 'no_entity' : 'bad_raw';
      decisions.push({ row, outcome: { kind, reason: result.reason } });
      continue;
    }
    const draft = result.draft;
    if (draft.dedup_score >= DEDUP_THRESHOLD) {
      decisions.push({ row, outcome: { kind: 'dedup_threshold', dedup_score: draft.dedup_score } });
      continue;
    }
    if (draft.slug === null) {
      decisions.push({ row, outcome: { kind: 'no_slug', reason: 'date de revendication absente' } });
      continue;
    }
    const bridged = { ...draft, slug: bareSlug(draft) };
    const opened = await openDraftPr(candidate, bridged, gh);
    decisions.push(
      'pr' in opened
        ? { row, outcome: { kind: 'pr', number: opened.pr } }
        : { row, outcome: { kind: 'duplicate' } },
    );
  }
  return decisions;
}

// ---------------------------------------------------------------------------
// Registre du run : 3 adapters réels (T14 ransomware.live, T15 RSS, T17 HIBP)
// + flux malformé + corpus synthétique. Le pattern beforeEach/afterEach de
// tests/worker-skeleton.test.ts est repris : on repart d'un registre nettoyé
// puis on restaure le registre câblé T19.
// ---------------------------------------------------------------------------

const originalAdapters = [...adapters];

beforeEach(() => {
  adapters.length = 0;
  adapters.push(
    ransomwareLiveAdapter,
    makeRssAdapter({ id: 'rss:zataz', name: 'Zataz', url: 'https://www.zataz.com/feed/' }),
    makeRssAdapter({ id: 'rss:zdnet-fr', name: 'ZDNet FR', url: 'https://www.zdnet.fr/feed' }),
    hibpDiffAdapter({ previousCatalog: loadFixture('hibp-snapshot-a.json') }),
    corpusAdapter,
  );
});

afterEach(() => {
  adapters.length = 0;
  adapters.push(...originalAdapters);
});

// ---------------------------------------------------------------------------
// Chaîne complète — comptes EXACTS.
// ---------------------------------------------------------------------------

describe('T20 · intégration pipeline — corpus de 20 candidats, chaîne complète', () => {
  it('run cron : 5 sources → exactement 20 lignes D1, toutes NEW, UUID distincts, état KV sain', async () => {
    const { env, rows, store } = makeEnv();

    const results = await runScheduled(env, { fetchFn: fixtureFetch, sleep: async () => {} });

    // Résultats par source : le flux malformé ne lève JAMAIS (isolation T15).
    expect(results).toEqual([
      { adapter: 'ransomware.live', inserted: 3, failed: false, skipped: false },
      { adapter: 'rss:zataz', inserted: 6, failed: false, skipped: false },
      { adapter: 'rss:zdnet-fr', inserted: 0, failed: false, skipped: false },
      { adapter: 'hibp', inserted: 1, failed: false, skipped: false },
      { adapter: 'corpus-t20', inserted: 10, failed: false, skipped: false },
    ]);

    // D1 : exactement 20 lignes, toutes NEW, dedup_score null à l'insertion,
    // UUID tous distincts. Répartition par source exacte — les lignes du corpus
    // synthétique portent leur source NOMINALE (8 rss, 1 ransomware.live,
    // 1 hibp), pas l'id de l'adapter qui les a servi.
    expect(rows).toHaveLength(20);
    expect(rows.every((r) => r.status === 'NEW')).toBe(true);
    expect(rows.every((r) => r.dedup_score === null)).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(20);
    const bySource = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.source] = (acc[r.source] ?? 0) + 1;
      return acc;
    }, {});
    expect(bySource).toEqual({
      'ransomware.live': 4, // 3 cassette + doublon de slug du corpus
      rss: 14, // 6 cassette Zataz + 8 corpus
      hibp: 2, // 1 diff cassette + 3e occurrence du corpus
    });

    // Non-FR et malformés sont bien SORTIS de la chaîne avant D1 : la cassette
    // ransomware.live porte 50 victimes dont 47 non-FR ; le flux ZDnet malformé
    // ne produit RIEN ; HIBP ne garde que le nouveau .fr (VitteAuto).
    const rliveCassette = rows.filter(
      (r) => r.source === 'ransomware.live' && JSON.parse(r.raw).country === 'FR',
    );
    expect(rliveCassette.map((r) => r.entity_name)).toEqual([
      'Experts Entreprendre',
      'Capgemini Engineering',
      'Philippe Hottinguer Finance',
    ]);
    const hibpCassette = rows.filter((r) => r.source === 'hibp' && 'BreachDate' in JSON.parse(r.raw));
    expect(hibpCassette.map((r) => r.entity_name)).toEqual(['VitteAuto']);
    expect(rows.some((r) => r.source_url?.includes('.onion'))).toBe(false);

    // KV : chaque source a son état de succès, aucun circuit breaker armé.
    for (const id of ['ransomware.live', 'rss:zataz', 'rss:zdnet-fr', 'hibp', 'corpus-t20']) {
      const state = JSON.parse(store.get(`ingest:state:${id}`) ?? '{}') as Record<string, unknown>;
      expect(state.last_success, `KV ${id}`).toBeTruthy();
      expect(state.disabled, `KV ${id}`).toBe(false);
      expect(state.consecutive_failures, `KV ${id}`).toBe(0);
    }
  });

  it('décision PR : les 20 lignes → exactement 2 PR, doublons repliés sur UN PR, rejets motivés', async () => {
    const { env, rows } = makeEnv();
    await runScheduled(env, { fetchFn: fixtureFetch, sleep: async () => {} });
    const gh = new FakeGithub();

    const decisions = await decideAndOpen(rows, gh);

    // Aucune ligne perdue : 20 décisions, chacune motivée.
    expect(decisions).toHaveLength(20);
    const counts = decisions.reduce<Record<string, number>>((acc, d) => {
      acc[d.outcome.kind] = (acc[d.outcome.kind] ?? 0) + 1;
      return acc;
    }, {});
    // 2 PR + 2 replis duplicate + 2 rejets de seuil + 5 sans slug (3 FR
    // ransomware.live au format attackdate non lu par T18, le VitteAuto HIBP
    // réel à BreachDate non lue, l'IRD du corpus sans date) + 7 sans entité
    // (6 RSS cassette + 1 corpus) + 2 raw malformés.
    expect(counts).toEqual({
      pr: 2,
      duplicate: 2,
      dedup_threshold: 2,
      no_slug: 5,
      no_entity: 7,
      bad_raw: 2,
    });

    // Appels GitHub EXACTS : 2 branches, 2 fichiers, 2 PR — jamais plus.
    expect(gh.createdRefs).toEqual([
      { ref: 'refs/heads/fiche/vitteauto-20260730', sha: 'a1b2c3d4e5f6' },
      { ref: 'refs/heads/fiche/alaxio-20260211', sha: 'a1b2c3d4e5f6' },
    ]);
    expect(gh.putFiles.map((f) => f.path)).toEqual([
      'data/catalog/vitteauto-20260730.json',
      'data/catalog/alaxio-20260211.json',
    ]);
    expect(gh.pulls).toHaveLength(2);
    expect(gh.pulls[0]).toMatchObject({ number: 42, head: 'fiche/vitteauto-20260730', base: 'main' });
    expect(gh.pulls[1]).toMatchObject({ number: 43, head: 'fiche/alaxio-20260211', base: 'main' });

    // Les 3 candidats VitteAuto du corpus → UN seul PR (garde findOpenPullByHead) ;
    // la ligne HIBP réelle (BreachDate non lue par T18 → pas de slug) sort avant.
    const vitte = decisions.filter(
      (d) => d.row.entity_name === 'VitteAuto' && d.outcome.kind !== 'no_slug',
    );
    expect(vitte.map((d) => d.outcome.kind)).toEqual(['pr', 'duplicate', 'duplicate']);

    // Seuil : 1.0 (Alaxione exact) et 0.85 (Alaxione Conseil) rejetés ;
    // 0.4 (Alaxio, date+volume seuls) passe — toBeCloseTo pour la demi-teinte
    // flottante des pondérations 0,6/0,2/0,2.
    const rejected = decisions
      .filter((d) => d.outcome.kind === 'dedup_threshold')
      .map((d) => (d.outcome as { dedup_score: number }).dedup_score);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]).toBeCloseTo(1);
    expect(rejected[1]).toBeCloseTo(0.85);

    // La carte de validation du PR porte entité + SIREN + sources.
    const body = gh.pulls[0]?.body ?? '';
    expect(body).toContain('VitteAuto');
    expect(body).toContain('123456789');
    expect(body).toContain('| Dédup max catalogue |');
  });

  it('chemin PENDING_KEYS : sans jeton FRANCEPASSOIRE_GH_TOKEN, la phase PR reste dormante et zéro erreur', async () => {
    const { env, rows } = makeEnv();
    // Phase ingestion seule — c'est TOUT ce que fait le worker déployé tant
    // que le secret n'existe pas (src/index.ts ne référence ni le jeton ni
    // pr-automation : aucune construction de GithubClient, aucun appel réseau
    // GitHub, aucune exception possible faute de jeton).
    await expect(
      runScheduled(env, { fetchFn: fixtureFetch, sleep: async () => {} }),
    ).resolves.toEqual([
      { adapter: 'ransomware.live', inserted: 3, failed: false, skipped: false },
      { adapter: 'rss:zataz', inserted: 6, failed: false, skipped: false },
      { adapter: 'rss:zdnet-fr', inserted: 0, failed: false, skipped: false },
      { adapter: 'hibp', inserted: 1, failed: false, skipped: false },
      { adapter: 'corpus-t20', inserted: 10, failed: false, skipped: false },
    ]);

    // La phase PR ne s'exécute pas (pas de client) : les lignes D1 restent
    // NEW, rien ne plante, la prochaine passe éditoriale les relira.
    expect(rows).toHaveLength(20);
    expect(rows.every((r) => r.status === 'NEW')).toBe(true);
  });

  it('cadence CNIL : un seul fetch de cnil.fr par jour UTC — le 2e run skippe sans requête', async () => {
    const { env, store } = makeEnv();
    const cnilFetches: string[] = [];
    const countingFetch: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === CNIL_SANCTIONS_URL) {
        cnilFetches.push(url);
        return new Response(loadFixture('cnil-sanctions.html'), { status: 200 });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    // Le registre du beforeEach est remplacé : CNIL seule pour ce test.
    adapters.length = 0;
    adapters.push(cnilSanctionsAdapter);

    const first = await runScheduled(env, { fetchFn: countingFetch, sleep: async () => {} });
    const second = await runScheduled(env, { fetchFn: countingFetch, sleep: async () => {} });

    // Run 1 : la page sanctions est parsée (candidats insérés) puis l'état
    // last_run est persisté ; run 2 (même jour UTC) : skip, zéro requête.
    expect(first).toEqual([{ adapter: 'cnil-sanctions', inserted: expect.any(Number), failed: false, skipped: false }]);
    expect((first[0] as { inserted: number }).inserted).toBeGreaterThan(0);
    expect(second).toEqual([{ adapter: 'cnil-sanctions', inserted: 0, failed: false, skipped: true }]);
    expect(cnilFetches).toHaveLength(1);

    // L'état KV du run 1 reste celui de la dernière exécution réelle.
    const state = JSON.parse(store.get('ingest:state:cnil-sanctions') ?? '{}') as Record<string, unknown>;
    expect(state.last_run).toBeTruthy();
    expect(state.consecutive_failures).toBe(0);
  });
});
