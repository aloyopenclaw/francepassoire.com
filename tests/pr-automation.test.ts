import { describe, expect, it } from 'vitest';
// File de validation éditoriale (T19) : brouillons → PR GitHub.
// GithubClient est injecté — ici un fake en mémoire qui enregistre chaque
// appel ; aucun réseau, aucun jeton réel.
import {
  createGithubClient,
  openDraftPr,
  PrAutomationError,
  type GithubClient,
} from '../workers/ingest/src/pr-automation';
import { adapters, type Candidate } from '../workers/ingest/src/adapter';
import type { FicheDraft } from '../src/lib/synthesize';

// ---------------------------------------------------------------------------
// Fake GithubClient — enregistre les appels, simule l'état du dépôt.
// ---------------------------------------------------------------------------

interface RecordedPutFile {
  path: string;
  branch: string;
  content: string;
  message: string;
}

interface RecordedPull {
  title: string;
  head: string;
  base: string;
  body: string;
}

class FakeGithub implements GithubClient {
  mainSha = 'a1b2c3d4e5f6';
  nextPrNumber = 42;
  /** PRs ouvertes pré-existantes, indexées par head. */
  existingOpenHeads = new Set<string>();
  /** Quand défini, putFile lève une PrAutomationError github_api simulée. */
  putFileStatus: number | null = null;

  createdRefs: { ref: string; sha: string }[] = [];
  putFiles: RecordedPutFile[] = [];
  pulls: RecordedPull[] = [];

  async getMainSha(): Promise<string> {
    return this.mainSha;
  }

  async createRef(ref: string, sha: string): Promise<void> {
    this.createdRefs.push({ ref, sha });
  }

  async putFile(input: {
    path: string;
    branch: string;
    content: string;
    message: string;
  }): Promise<void> {
    if (this.putFileStatus !== null) {
      throw new PrAutomationError(
        'github_api',
        `GitHub API ${this.putFileStatus} (simulé) sur PUT ${input.path}`,
        this.putFileStatus,
      );
    }
    this.putFiles.push({ ...input });
  }

  async createPullRequest(input: {
    title: string;
    head: string;
    base: string;
    body: string;
  }): Promise<{ number: number }> {
    this.pulls.push({ ...input });
    return { number: this.nextPrNumber };
  }

  async findOpenPullByHead(head: string): Promise<{ number: number } | null> {
    return this.existingOpenHeads.has(head) ? { number: 7 } : null;
  }
}

// ---------------------------------------------------------------------------
// Fabriques — brouillon minimal mais complet, calqué sur la sortie T18.
// ---------------------------------------------------------------------------

const CANDIDATE: Candidate = {
  id: 'cand-0001',
  source: 'ransomware.live',
  source_url: 'https://www.ransomware.live/group/qilin',
  raw: JSON.stringify({ claim_date: '2025-06-11', volume: 750000 }),
  entity_name: 'Alaxione',
  dedup_score: 0.1,
};

function makeDraft(overrides: Partial<FicheDraft> = {}): FicheDraft {
  return {
    slug: 'alaxione-20250611',
    entity: 'Alaxione',
    siren: '811197557',
    secteur: 'sante',
    statut: 'revendiquee',
    dates: {
      revendication: '2025-06-11',
      publication: '2025-06-12',
      confirmation: null,
    },
    volume: { count: 750000, unit: 'personnes', label: '750000 personnes' },
    data_types: ['sante', 'credentials'],
    sources: [
      {
        label: 'ransomware.live',
        url: 'https://www.ransomware.live/group/qilin',
        kind: 'revendication',
      },
    ],
    description: '[BROUILLON À RÉDIGER] Fuite de données touchant « Alaxione ».',
    timeline: [{ date: '2025-06-11', event: 'Revendication de la fuite' }],
    group: 'Qilin',
    confidence: 0.9,
    checklist: {
      entite_identifiee: true,
      siren_verifie: true,
      source_primaire: true,
      volume_recoupé: false,
    },
    dedup_score: 0.35,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Chemin nominal
// ---------------------------------------------------------------------------

describe('openDraftPr — chemin nominal', () => {
  it('crée la branche au SHA de main, pose le JSON du brouillon, ouvre le PR et renvoie son numéro', async () => {
    const gh = new FakeGithub();
    const draft = makeDraft();

    const result = await openDraftPr(CANDIDATE, draft, gh);

    expect(result).toEqual({ pr: 42 });

    // Branche fiche/<slug> créée sur le SHA de tête de main.
    expect(gh.createdRefs).toEqual([{ ref: 'refs/heads/fiche/alaxione-20250611', sha: gh.mainSha }]);

    // Fichier posé : chemin catalogue, branche, contenu = brouillon JSON exact.
    expect(gh.putFiles).toHaveLength(1);
    const put = gh.putFiles[0]!;
    expect(put.path).toBe('data/catalog/alaxione-20250611.json');
    expect(put.branch).toBe('fiche/alaxione-20250611');
    expect(JSON.parse(put.content)).toEqual(draft);

    // PR : titre FR, head/base, carte de validation complète.
    expect(gh.pulls).toHaveLength(1);
    const pull = gh.pulls[0]!;
    expect(pull.title).toBe('Fiche: Alaxione (2025-06-11)');
    expect(pull.head).toBe('fiche/alaxione-20250611');
    expect(pull.base).toBe('main');

    // Carte : entité, SIREN, source avec URL, statut suggéré, confiance,
    // dedup_score, et les 4 portes Ostraca avec leurs booléens.
    expect(pull.body).toContain('Alaxione');
    expect(pull.body).toContain('811197557');
    expect(pull.body).toContain('https://www.ransomware.live/group/qilin');
    expect(pull.body).toContain('revendiquée');
    expect(pull.body).toContain('0.9');
    expect(pull.body).toContain('0.35');
    expect(pull.body).toContain('- [x] entite_identifiee');
    expect(pull.body).toContain('- [x] siren_verifie');
    expect(pull.body).toContain('- [x] source_primaire');
    expect(pull.body).toContain('- [ ] volume_recoupé');
  });
});

// ---------------------------------------------------------------------------
// Garde anti-doublon
// ---------------------------------------------------------------------------

describe('openDraftPr — garde anti-doublon', () => {
  it('renvoie {skipped:"duplicate"} et ne crée RIEN si un PR ouvert existe déjà pour ce head', async () => {
    const gh = new FakeGithub();
    gh.existingOpenHeads.add('fiche/alaxione-20250611');

    const result = await openDraftPr(CANDIDATE, makeDraft(), gh);

    expect(result).toEqual({ skipped: 'duplicate' });
    expect(gh.createdRefs).toEqual([]);
    expect(gh.putFiles).toEqual([]);
    expect(gh.pulls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Erreurs typées
// ---------------------------------------------------------------------------

describe('openDraftPr — erreurs typées', () => {
  it('brouillon sans slug → PrAutomationError missing_slug, aucun appel GitHub', async () => {
    const gh = new FakeGithub();
    const call = openDraftPr(CANDIDATE, makeDraft({ slug: null }), gh);
    await expect(call).rejects.toMatchObject({
      name: 'PrAutomationError',
      kind: 'missing_slug',
    });
    expect(gh.createdRefs).toEqual([]);
    expect(gh.putFiles).toEqual([]);
    expect(gh.pulls).toEqual([]);
  });

  it('échec de l’API GitHub sur le put (422 validation) → PrAutomationError github_api, aucun PR ouvert', async () => {
    const gh = new FakeGithub();
    gh.putFileStatus = 422;

    const call = openDraftPr(CANDIDATE, makeDraft(), gh);
    await expect(call).rejects.toMatchObject({
      name: 'PrAutomationError',
      kind: 'github_api',
      status: 422,
    });
    // La branche a été créée mais AUCUN PR ne doit être ouvert.
    expect(gh.createdRefs).toHaveLength(1);
    expect(gh.pulls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Client réel (structure seule — pas de réseau : on vérifie l'URL et les
// en-têtes via un fetch injecté qui capture puis répond 201/200).
// ---------------------------------------------------------------------------

describe('createGithubClient — requêtes réelles (fetch injecté)', () => {
  it('porte le jeton Bearer, la version d’API et le dépôt dans chaque requête', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ object: { sha: 'cafe' } }), { status: 200 });
    }) as typeof fetch;

    const client = createGithubClient({
      repo: 'aloyopenclaw/francepassoire.com',
      token: 'ghp_test-not-a-real-token',
      baseUrl: 'https://api.github.com',
      fetchFn,
    });

    await expect(client.getMainSha()).resolves.toBe('cafe');
    expect(seen[0]?.url).toBe('https://api.github.com/repos/aloyopenclaw/francepassoire.com/git/ref/heads/main');
    const headers = seen[0]?.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer ghp_test-not-a-real-token');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('HTTP 404 → PrAutomationError github_api avec le status', async () => {
    const fetchFn = (async () => new Response('{"message":"Not Found"}', { status: 404 })) as typeof fetch;
    const client = createGithubClient({
      repo: 'aloyopenclaw/francepassoire.com',
      token: 'ghp_test-not-a-real-token',
      fetchFn,
    });
    await expect(client.getMainSha()).rejects.toMatchObject({
      kind: 'github_api',
      status: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// Câblage du registre (partie A de la tâche)
// ---------------------------------------------------------------------------

describe('registre adapters (câblage T19)', () => {
  it('enregistre exactement les 9 adapters construits en T14-T17, dans l’ordre déclaré', () => {
    expect(adapters.map((a) => a.id)).toEqual([
      'ransomware.live',
      'rss:01net',
      'rss:zdnet-fr',
      'rss:jdn',
      'rss:zataz',
      'cert-fr-avis',
      'cert-fr-alertes',
      'cnil-sanctions',
      'hibp',
    ]);
  });
});
