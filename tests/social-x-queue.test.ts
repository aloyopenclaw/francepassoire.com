import { afterEach, describe, expect, it, vi } from 'vitest';
// File sociale (T39) + drain via le client X Make (T51) : les cassettes de
// l'ancienne API directe POST /2/tweets ont disparu avec clients/x.ts — le
// client X (webhook Make) est testé à part dans tests/social-make-x.test.ts ;
// ici on épingle la MÉCANIQUE de file (intake, retries, lettre morte, garde
// éditoriale) sur la voie X d'aujourd'hui. Fake D1 en mémoire qui APPLIQUE
// les UPDATE — le drain rejoue plusieurs crons et le compteur de tentatives
// doit survivre entre crons.
import worker, { enqueuePost, runDrain } from '../workers/social/src/index';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  Env,
  PostPayload,
  SocialPlatform,
} from '../workers/social/src/types';

// Épingle indépendante (doublée volontairement depuis social-templates.ts) :
// la mention exacte que TOUTE ligne « revendiquée » doit porter — aucune
// allégation non vérifiée ne se présente comme un fait.
const MENTION_EXACTE = 'revendication non confirmée par l’entité';

// ---------------------------------------------------------------------------
// Fake D1 : lignes en mémoire, les UPDATE status/payload sont APPLIQUÉS.
// ---------------------------------------------------------------------------

interface LigneOutbox {
  id: string;
  platform: string;
  payload: string;
  status: string;
  scheduled_at: string | null;
}

interface StatementExecute {
  sql: string;
  params: unknown[];
}

function makeDb(seed: LigneOutbox[] = []) {
  const lignes = [...seed];
  const executed: StatementExecute[] = [];
  const db: D1Database = {
    prepare(sql: string) {
      let params: unknown[] = [];
      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]) {
          params = params.concat(values);
          return stmt;
        },
        async all<T = unknown>(): Promise<D1Result<T>> {
          executed.push({ sql, params: [...params] });
          // Fidèle au WHERE du drain côté statuts ; les tests sèment
          // scheduled_at NULL (toujours dû).
          const results = lignes.filter(
            (l) => l.status === 'PENDING' || l.status === 'PENDING_KEYS',
          ) as T[];
          return { results, success: true };
        },
        async run() {
          executed.push({ sql, params: [...params] });
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
          executed.push({ sql, params: [...params] });
          return null;
        },
      };
      return stmt;
    },
  };
  return { db, lignes, executed };
}

function makeEnv(db: D1Database, secrets: Partial<Env> = {}): Env {
  return { DB: db, ...secrets };
}

// ---------------------------------------------------------------------------
// Webhook Make factice : même statut pour chaque appel, corps capturé.
// ---------------------------------------------------------------------------

function fetchWebhook(status: number): { fetchFn: typeof fetch; nbAppels: () => number } {
  let appels = 0;
  const fetchFn = (async (
    _u: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    appels += 1;
    return new Response('{"status":"ok"}', { status });
  }) as typeof fetch;
  return { fetchFn, nbAppels: () => appels };
}

// ---------------------------------------------------------------------------
// Payloads réalistes (textes conformes aux rendus de social-templates.ts).
// ---------------------------------------------------------------------------

const URL_FICHE = 'https://francepassoire.com/f/alaxione-20260820';

function ficheRevendiqueeAvecMention(): PostPayload {
  return {
    text: `Nouvelle fiche revendiquée : Alaxione — 1,2 million de comptes (${MENTION_EXACTE}). Détails : ${URL_FICHE}`,
    url: URL_FICHE,
    statut: 'revendiquee',
  };
}

function ficheConfirmee(): PostPayload {
  return {
    text: `Nouvelle fiche confirmée : Alaxione — 900 000 patients. Sources et détails : ${URL_FICHE}`,
    url: URL_FICHE,
    statut: 'confirmee',
  };
}

function changementStatut(): PostPayload {
  return {
    text: `Mise à jour : la fiche Alaxione passe de « revendiquée » à « confirmée » après vérification d’une source officielle. ${URL_FICHE}`,
    url: URL_FICHE,
    statut: 'confirmee',
  };
}

function ligneX(payload: PostPayload, id = 'ligne-x-1'): LigneOutbox {
  return {
    id,
    platform: 'x',
    payload: JSON.stringify(payload),
    status: 'PENDING',
    scheduled_at: null,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('file social_outbox — intake enqueuePost (T39)', () => {
  it('insère une ligne PENDING avec payload JSON intact et id UUID', async () => {
    const { db, lignes, executed } = makeDb();
    await enqueuePost(db, 'x', ficheConfirmee());
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.platform).toBe('x');
    expect(lignes[0]?.status).toBe('PENDING');
    expect(lignes[0]?.scheduled_at).toBeNull();
    expect(JSON.parse(lignes[0]?.payload ?? '{}')).toEqual(ficheConfirmee());
    expect(lignes[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(executed[0]?.sql).toMatch(/^INSERT INTO social_outbox/);
  });

  it('accepte facebook et instagram (T51), refuse plateforme inconnue et payloads vides', async () => {
    const { db, lignes } = makeDb();
    await enqueuePost(db, 'facebook', ficheConfirmee());
    await enqueuePost(db, 'instagram', ficheConfirmee());
    expect(lignes.map((l) => l.platform)).toEqual(['facebook', 'instagram']);
    // Délibéré : forcer une valeur hors union pour prouver le rejet runtime.
    const tiktok = 'tiktok' as unknown as SocialPlatform;
    await expect(enqueuePost(db, tiktok, ficheConfirmee())).rejects.toThrow(
      /Plateforme « tiktok » inconnue/,
    );
    await expect(
      enqueuePost(db, 'x', { ...ficheConfirmee(), text: '   ' }),
    ).rejects.toThrow(/sans texte/);
    await expect(
      enqueuePost(db, 'x', { ...ficheConfirmee(), url: '' }),
    ).rejects.toThrow(/sans URL/);
  });
});

describe('drain cron — voie X = webhook Make (T51)', () => {
  it('ligne envoyable (revendiquée AVEC mention) → SENT via le webhook', async () => {
    const { db, lignes } = makeDb([ligneX(ficheRevendiqueeAvecMention())]);
    const { fetchFn, nbAppels } = fetchWebhook(200);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = makeEnv(db, { MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/test-x' });

    const outcomes = await runDrain(env, { fetchFn });

    expect(outcomes).toEqual([{ id: 'ligne-x-1', platform: 'x', status: 'SENT' }]);
    expect(lignes[0]?.status).toBe('SENT');
    expect(nbAppels()).toBe(1);
  });

  it('webhook 410 (scénario éteint) → lettre morte IMMÉDIATE, sans consumer 3 crons', async () => {
    const { db, lignes } = makeDb([ligneX(changementStatut())]);
    const { fetchFn, nbAppels } = fetchWebhook(410);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = makeEnv(db, { MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/test-x' });

    const outcomes = await runDrain(env, { fetchFn });

    expect(outcomes).toEqual([{ id: 'ligne-x-1', platform: 'x', status: 'DEAD' }]);
    expect(lignes[0]?.status).toBe('DEAD');
    expect(nbAppels()).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('DEAD après 1 tentative(s)'),
    );
  });

  it('webhook 500 transitoire : 3 crons d’échec → PENDING, PENDING puis DEAD à la 3e tentative', async () => {
    const { db, lignes } = makeDb([ligneX(ficheConfirmee())]);
    const { fetchFn, nbAppels } = fetchWebhook(500);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = makeEnv(db, { MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/test-x' });

    // Cron 1 : échec 1/3 — la ligne reste PENDING, compteur persisté dans
    // le payload (le fake D1 applique l'UPDATE, comme la vraie base).
    let outcomes = await runDrain(env, { fetchFn });
    expect(outcomes[0]?.status).toBe('PENDING');
    expect(lignes[0]?.status).toBe('PENDING');
    expect((JSON.parse(lignes[0]?.payload ?? '{}') as PostPayload).metadata?.attempts).toBe(1);

    // Cron 2 : échec 2/3 — toujours en file.
    outcomes = await runDrain(env, { fetchFn });
    expect(outcomes[0]?.status).toBe('PENDING');
    expect((JSON.parse(lignes[0]?.payload ?? '{}') as PostPayload).metadata?.attempts).toBe(2);

    // Cron 3 : échec 3/3 — lettre morte.
    outcomes = await runDrain(env, { fetchFn });
    expect(outcomes[0]?.status).toBe('DEAD');
    expect(lignes[0]?.status).toBe('DEAD');
    expect(nbAppels()).toBe(3);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('DEAD après 3 tentative(s)'),
    );
  });

  it('garde éditoriale : revendiquée SANS la mention → INVALID, jamais d’appel réseau', async () => {
    const sansMention: PostPayload = {
      text: `Nouvelle fiche revendiquée : Alaxione — 1,2 million de comptes. Détails : ${URL_FICHE}`,
      url: URL_FICHE,
      statut: 'revendiquee',
    };
    const { db, lignes } = makeDb([ligneX(sansMention)]);
    const fetchExplosif = vi.fn(async () => {
      throw new Error('AUCUN APPEL RÉSEAU ATTENDU');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = makeEnv(db, { MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/test-x' });

    const outcomes = await runDrain(env, { fetchFn: fetchExplosif as typeof fetch });

    expect(outcomes).toEqual([{ id: 'ligne-x-1', platform: 'x', status: 'INVALID' }]);
    expect(lignes[0]?.status).toBe('INVALID');
    expect(fetchExplosif).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`CAVEAT ligne ligne-x-1 (x) : statut « revendiquée » sans la mention « ${MENTION_EXACTE} »`),
    );
  });
});

describe('drain cron — robustesse (T39)', () => {
  it('le handler scheduled par défaut complète sans crash sur file vide', async () => {
    const { db, executed } = makeDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(
      worker.scheduled(
        { scheduledTime: Date.now(), cron: '*/5 * * * *' },
        makeEnv(db),
        { waitUntil: () => {}, passThroughOnException: () => {} },
      ),
    ).resolves.toBeUndefined();
    expect(executed).toHaveLength(1); // le SELECT du drain, aucune écriture
  });
});
