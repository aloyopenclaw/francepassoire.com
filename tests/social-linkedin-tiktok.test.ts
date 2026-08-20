import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Clients LinkedIn + TikTok (T40) et drain multi-plateformes : mêmes
// disciplines que tests/social-x-queue.test.ts — cassettes à la main, fake
// D1 qui applique les UPDATE, aucun réseau.
import { runDrain } from '../workers/social/src/index';
import { send as sendLinkedIn } from '../workers/social/clients/linkedin';
import { send as sendTikTok } from '../workers/social/clients/tiktok';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  Env,
  PostPayload,
} from '../workers/social/src/types';

const fixturesDir = fileURLToPath(new URL('./fixtures/social/', import.meta.url));

interface Cassette {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
  };
  response: { status: number; body: unknown };
}

function cassette(nom: string): Cassette {
  return JSON.parse(readFileSync(`${fixturesDir}${nom}`, 'utf8')) as Cassette;
}

// Rejoue la réponse et vérifie la requête sortante contre la forme enregistrée.
function cassetteFetch(cass: Cassette): { fetchFn: typeof fetch; nbAppels: () => number } {
  let appels = 0;
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    appels += 1;
    expect(String(url)).toBe(cass.request.url);
    expect(init?.method).toBe(cass.request.method);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    for (const [cle, valeur] of Object.entries(cass.request.headers)) {
      expect(headers[cle]).toBe(valeur);
    }
    expect(JSON.parse(String(init?.body))).toEqual(cass.request.body);
    return new Response(JSON.stringify(cass.response.body), {
      status: cass.response.status,
    });
  }) as typeof fetch;
  return { fetchFn, nbAppels: () => appels };
}

interface LigneOutbox {
  id: string;
  platform: string;
  payload: string;
  status: string;
  scheduled_at: string | null;
}

function makeDb(seed: LigneOutbox[] = []) {
  const lignes = [...seed];
  const db: D1Database = {
    prepare(sql: string) {
      let params: unknown[] = [];
      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]) {
          params = params.concat(values);
          return stmt;
        },
        async all<T = unknown>(): Promise<D1Result<T>> {
          const results = lignes.filter(
            (l) => l.status === 'PENDING' || l.status === 'PENDING_KEYS',
          ) as T[];
          return { results, success: true };
        },
        async run() {
          if (sql.startsWith('INSERT INTO social_outbox')) {
            lignes.push({
              id: String(params[0]),
              platform: String(params[1]),
              payload: String(params[2]),
              status: String(params[3]),
              scheduled_at: params[4] == null ? null : String(params[4]),
            });
          } else if (/SET status = \?/.test(sql)) {
            const ligne = lignes.find((l) => l.id === params[1]);
            if (ligne) ligne.status = String(params[0]);
          } else if (/SET payload = \?/.test(sql)) {
            const ligne = lignes.find((l) => l.id === params[1]);
            if (ligne) ligne.payload = String(params[0]);
          }
          return { success: true };
        },
        async first() {
          return null;
        },
      };
      return stmt;
    },
  };
  return { db, lignes };
}

function makeEnv(db: D1Database, secrets: Partial<Env> = {}): Env {
  return { DB: db, ...secrets };
}

const URL_FICHE = 'https://francepassoire.com/f/alaxione-20260820';

function ficheConfirmee(): PostPayload {
  return {
    text: `Nouvelle fiche confirmée : Alaxione — 900 000 patients. Sources et détails : ${URL_FICHE}`,
    url: URL_FICHE,
    statut: 'confirmee',
  };
}

function ficheRevendiqueeAvecMention(): PostPayload {
  return {
    text: `Nouvelle fiche revendiquée : Alaxione — 1,2 million de comptes (revendication non confirmée par l’entité). Détails : ${URL_FICHE}`,
    url: URL_FICHE,
    statut: 'revendiquee',
  };
}

function ligne(platform: string, payload: PostPayload, id: string): LigneOutbox {
  return { id, platform, payload: JSON.stringify(payload), status: 'PENDING', scheduled_at: null };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('client LinkedIn — cassette POST /v2/ugcPosts (T40)', () => {
  it('201 → SENT avec l’URN du post, requête shareContent conforme (auteur, texte, média ARTICLE)', async () => {
    const { fetchFn, nbAppels } = cassetteFetch(cassette('linkedin-ugcposts-201.json'));
    const env = makeEnv(makeDb().db, {
      LINKEDIN_ACCESS_TOKEN: 'test-linkedin-token',
      LINKEDIN_MEMBER_URN: 'urn:li:person:TEST_MEMBRE',
    });

    const result = await sendLinkedIn(ficheConfirmee(), env, fetchFn);

    expect(result).toEqual({
      status: 'SENT',
      externalId: 'urn:li:share:7123456789012345678901',
    });
    expect(nbAppels()).toBe(1);
  });

  it('LINKEDIN_ACCESS_TOKEN absent → PENDING_KEYS, aucun appel réseau', async () => {
    const { fetchFn, nbAppels } = cassetteFetch(cassette('linkedin-ugcposts-201.json'));
    const result = await sendLinkedIn(
      ficheConfirmee(),
      makeEnv(makeDb().db, { LINKEDIN_MEMBER_URN: 'urn:li:person:TEST_MEMBRE' }),
      fetchFn,
    );
    expect(result.status).toBe('PENDING_KEYS');
    expect(nbAppels()).toBe(0);
  });

  it('token présent mais LINKEDIN_MEMBER_URN absente → PENDING_KEYS (l’UGC Post exige l’auteur)', async () => {
    const { fetchFn, nbAppels } = cassetteFetch(cassette('linkedin-ugcposts-201.json'));
    const result = await sendLinkedIn(
      ficheConfirmee(),
      makeEnv(makeDb().db, { LINKEDIN_ACCESS_TOKEN: 'test-linkedin-token' }),
      fetchFn,
    );
    expect(result.status).toBe('PENDING_KEYS');
    if (result.status === 'PENDING_KEYS') {
      expect(result.reason).toContain('LINKEDIN_MEMBER_URN');
      expect(result.reason).toContain('Token Generator');
    }
    expect(nbAppels()).toBe(0);
  });
});

describe('client TikTok — refus honnête vidéo-first (T40)', () => {
  it('token + payload texte → UNSUPPORTED_PAYLOAD avec la raison vidéo, AUCUN appel réseau', async () => {
    const fetchExplosif = vi.fn(async () => {
      throw new Error('AUCUN APPEL RÉSEAU ATTENDU');
    });
    const result = await sendTikTok(
      ficheConfirmee(),
      makeEnv(makeDb().db, { TIKTOK_ACCESS_TOKEN: 'act.test-token' }),
      fetchExplosif as typeof fetch,
    );
    expect(result).toEqual({
      status: 'UNSUPPORTED_PAYLOAD',
      reason: 'TikTok exige une vidéo — texte seul non postable',
    });
    expect(fetchExplosif).not.toHaveBeenCalled();
  });

  it('TIKTOK_ACCESS_TOKEN absent → PENDING_KEYS (en file, jamais un échec)', async () => {
    const result = await sendTikTok(
      ficheConfirmee(),
      makeEnv(makeDb().db),
      vi.fn() as unknown as typeof fetch,
    );
    expect(result.status).toBe('PENDING_KEYS');
    if (result.status === 'PENDING_KEYS') {
      expect(result.reason).toContain('TIKTOK_ACCESS_TOKEN');
    }
  });
});

describe('drain — plateformes T40 bout en bout', () => {
  it('2 lignes : 1 x envoyable + 1 linkedin sans token → SENT + PENDING_KEYS, statuts corrects', async () => {
    const { db, lignes } = makeDb([
      ligne('x', ficheRevendiqueeAvecMention(), 'ligne-x'),
      ligne('linkedin', ficheConfirmee(), 'ligne-li'),
    ]);
    // Le texte de la ligne x doit rester celui épinglé dans la cassette 201.
    const env = makeEnv(db, { X_USER_TOKEN: 'test-user-token-x' });
    const fetchX = cassetteFetch(cassette('x-post-create-201.json'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const outcomes = await runDrain(env, { fetchFn: fetchX.fetchFn });

    expect(outcomes).toEqual([
      { id: 'ligne-x', platform: 'x', status: 'SENT' },
      { id: 'ligne-li', platform: 'linkedin', status: 'PENDING_KEYS' },
    ]);
    expect(lignes.map((l) => l.status)).toEqual(['SENT', 'PENDING_KEYS']);
    expect(fetchX.nbAppels()).toBe(1); // linkedin sans token : zéro réseau
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('en attente de clés'));
  });

  it('drain tiktok avec token : ligne → DEAD avec la raison vidéo loguée (jamais un 500)', async () => {
    const { db, lignes } = makeDb([ligne('tiktok', ficheConfirmee(), 'ligne-tt')]);
    const fetchExplosif = vi.fn(async () => {
      throw new Error('AUCUN APPEL RÉSEAU ATTENDU');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = makeEnv(db, { TIKTOK_ACCESS_TOKEN: 'act.test-token' });

    const outcomes = await runDrain(env, { fetchFn: fetchExplosif as typeof fetch });

    expect(outcomes).toEqual([{ id: 'ligne-tt', platform: 'tiktok', status: 'DEAD' }]);
    expect(lignes[0]?.status).toBe('DEAD');
    expect(fetchExplosif).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('TikTok exige une vidéo — texte seul non postable'),
    );
  });
});
