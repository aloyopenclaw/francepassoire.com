import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateSecretKey, nip19, verifyEvent } from 'nostr-tools';
// Clients Bluesky + Nostr et file sociale (T38) : cassettes Bluesky écrites à
// la main (aucun réseau), note Nostr signée/vérifiée en pur avec une clé
// FRAÎCHE générée dans le test (jamais la clé en quarantaine), envoi relais
// rejoué par un WebSocket factice, fake D1 en mémoire qui applique les UPDATE.
import { runDrain } from '../workers/social/src/index';
import { send as sendBluesky } from '../workers/social/clients/bluesky';
import {
  RELAIS_EPINGLES,
  buildNote,
  normalizeSecret,
  reinitFabriqueWs,
  send as sendNostr,
  setFabriqueWs,
  type FabriqueWs,
  type SocketRelais,
} from '../workers/social/clients/nostr';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  Env,
  PostPayload,
} from '../workers/social/src/types';

const fixturesDir = fileURLToPath(new URL('./fixtures/social/', import.meta.url));

const MENTION_EXACTE = 'revendication non confirmée par l’entité';

// ---------------------------------------------------------------------------
// Cassettes Bluesky — comparaison de corps avec joker <DATE_ISO> (l'horodatage
// du post est « maintenant » : on épingle la forme ISO 8601, pas la valeur).
// ---------------------------------------------------------------------------

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

const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function verifierCorps(recu: unknown, attendu: unknown): void {
  if (attendu === '<DATE_ISO>') {
    expect(recu).toMatch(DATE_ISO_RE);
    return;
  }
  if (Array.isArray(attendu)) {
    expect(Array.isArray(recu)).toBe(true);
    expect(recu).toHaveLength(attendu.length);
    attendu.forEach((element, i) => verifierCorps((recu as unknown[])[i], element));
    return;
  }
  if (attendu !== null && typeof attendu === 'object') {
    expect(recu).not.toBeNull();
    expect(typeof recu).toBe('object');
    const r = recu as Record<string, unknown>;
    const a = attendu as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(Object.keys(a).sort());
    for (const cle of Object.keys(a)) {
      verifierCorps(r[cle], a[cle]);
    }
    return;
  }
  expect(recu).toEqual(attendu);
}

/** Vérifie que la requête sortante matche la forme de la cassette, puis
 * retourne SA réponse — ou une réponse de remplacement (status/body forcés)
 * tout en validant quand même la forme de requête. */
function rejouerCassette(cass: Cassette, init: RequestInit | undefined, remplacement?: { status: number; body: unknown }): Response {
  expect(init?.method).toBe(cass.request.method);
  const headers = (init?.headers ?? {}) as Record<string, string>;
  for (const [cle, valeur] of Object.entries(cass.request.headers)) {
    expect(headers[cle]).toBe(valeur);
  }
  verifierCorps(JSON.parse(String(init?.body)), cass.request.body);
  const status = remplacement?.status ?? cass.response.status;
  const body = remplacement?.body ?? cass.response.body;
  return new Response(JSON.stringify(body), { status });
}

interface EtapeScenario {
  /** URL attendue de cet appel — une étape = un appel réseau, dans l'ordre. */
  url: string;
  /** Cassette dont la forme de requête est validée. */
  cass: Cassette;
  /** Réponse de remplacement (ex. 401 injecté) — la forme reste vérifiée. */
  remplacement?: { status: number; body: unknown };
}

/** fetch rejouant un scénario ordonné : chaque appel consomme une étape et
 * doit tomber sur la bonne URL (une étape de trop ou manquante échoue). */
function fetchScenario(etapes: EtapeScenario[]): { fetchFn: typeof fetch; appels: () => number } {
  let i = 0;
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const etape = etapes[i];
    i += 1;
    expect(etape, `appel réseau n° ${String(i)} inattendu : ${String(url)}`).toBeDefined();
    expect(String(url)).toBe(etape.url);
    return rejouerCassette(etape.cass, init, etape.remplacement);
  }) as typeof fetch;
  return { fetchFn, appels: () => i };
}

// ---------------------------------------------------------------------------
// Fake D1 (même contrat que social-x-queue.test.ts : les UPDATE sont appliqués).
// ---------------------------------------------------------------------------

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

const CLE_BLUESKY = {
  BLUESKY_HANDLE: 'francepassoire.bsky.social',
  BLUESKY_APP_PASSWORD: 'test-app-password-bsky',
};

function ficheConfirmee(): PostPayload {
  return {
    text: `Nouvelle fiche confirmée : Alaxione — 900 000 patients. Sources et détails : ${URL_FICHE}`,
    url: URL_FICHE,
    statut: 'confirmee',
  };
}

function ficheRevendiqueeAvecMention(): PostPayload {
  return {
    text: `Nouvelle fiche revendiquée : Alaxione — 1,2 million de comptes (${MENTION_EXACTE}). Détails : ${URL_FICHE}`,
    url: URL_FICHE,
    statut: 'revendiquee',
  };
}

// ---------------------------------------------------------------------------
// WebSocket factice — collecte les trames envoyées, répond par OK/OK:false,
// erreur de transport ou fermeture avant OK, tout en microtask.
// ---------------------------------------------------------------------------

type ModeRelais = 'ok' | 'refus' | 'ferme' | 'erreur';

class WsFactice implements SocketRelais {
  readonly envoyes: string[] = [];
  private ecouteurs = new Map<string, Array<(ev?: { data?: unknown }) => void>>();

  constructor(
    readonly url: string,
    private readonly mode: ModeRelais,
  ) {}

  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    ecouteur: (ev?: { data?: unknown }) => void,
  ): void {
    this.ecouteurs.set(type, [...(this.ecouteurs.get(type) ?? []), ecouteur]);
    if (type === 'open') {
      queueMicrotask(() => this.emettre('open'));
    }
    if (type === 'close' && this.mode === 'ferme') {
      queueMicrotask(() => this.emettre('close'));
    }
    if (type === 'error' && this.mode === 'erreur') {
      queueMicrotask(() => this.emettre('error'));
    }
  }

  private emettre(type: string, data?: string): void {
    for (const ecouteur of this.ecouteurs.get(type) ?? []) {
      ecouteur(data === undefined ? undefined : { data });
    }
  }

  send(trame: string): void {
    this.envoyes.push(trame);
    if (this.mode === 'ok' || this.mode === 'refus') {
      const evenement = (JSON.parse(trame) as [string, { id: string }])[1];
      queueMicrotask(() =>
        this.emettre(
          'message',
          JSON.stringify([
            'OK',
            evenement.id,
            this.mode === 'ok',
            this.mode === 'ok' ? '' : 'refusé : Doublon',
          ]),
        ),
      );
    }
  }

  close(): void {
    // Rien à fermer : pas de vraie socket.
  }
}

/** Fabrique factice : un mode par relais, tous créés OK par défaut. */
function fabriqueWs(modes: Record<string, ModeRelais> = {}): {
  fabrique: FabriqueWs;
  sockets: WsFactice[];
} {
  const sockets: WsFactice[] = [];
  return {
    sockets,
    fabrique: (url) => {
      const socket = new WsFactice(url, modes[url] ?? 'ok');
      sockets.push(socket);
      return socket;
    },
  };
}

const fetchExplosif = vi.fn(async () => {
  throw new Error('AUCUN APPEL RÉSEAU ATTENDU');
});

afterEach(() => {
  vi.restoreAllMocks();
  reinitFabriqueWs();
});

// ---------------------------------------------------------------------------

describe('client Bluesky — cassettes atproto (T38)', () => {
  it('createSession puis createRecord 201 → SENT avec l’uri at://, requêtes conformes aux formes officielles', async () => {
    const { fetchFn, appels } = fetchScenario([
      { url: 'https://bsky.social/xrpc/com.atproto.server.createSession', cass: cassette('createSession-200.json') },
      { url: 'https://bsky.social/xrpc/com.atproto.repo.createRecord', cass: cassette('createRecord-201.json') },
    ]);
    const result = await sendBluesky(
      ficheConfirmee(),
      makeEnv(makeDb().db, CLE_BLUESKY),
      fetchFn,
    );
    expect(result).toEqual({
      status: 'SENT',
      externalId: 'at://did:plc:testdidfrancepassoire/app.bsky.feed.post/3ltestpost123',
    });
    expect(appels()).toBe(2);
  });

  it('createRecord 401 (jeton expiré) → UNE relance de session puis retry → 201 → SENT', async () => {
    const session = cassette('createSession-200.json');
    const record = cassette('createRecord-201.json');
    const expire = { status: 401, body: { error: 'ExpiredToken', message: 'Token has expired' } };
    const { fetchFn, appels } = fetchScenario([
      { url: 'https://bsky.social/xrpc/com.atproto.server.createSession', cass: session },
      { url: 'https://bsky.social/xrpc/com.atproto.repo.createRecord', cass: record, remplacement: expire },
      { url: 'https://bsky.social/xrpc/com.atproto.server.createSession', cass: session },
      { url: 'https://bsky.social/xrpc/com.atproto.repo.createRecord', cass: record },
    ]);
    const result = await sendBluesky(
      ficheConfirmee(),
      makeEnv(makeDb().db, CLE_BLUESKY),
      fetchFn,
    );
    expect(result).toEqual({
      status: 'SENT',
      externalId: 'at://did:plc:testdidfrancepassoire/app.bsky.feed.post/3ltestpost123',
    });
    expect(appels()).toBe(4);
  });

  it('createRecord 401 même après rafraîchissement → erreur PERMANENTE, exactement 4 appels (pas de boucle)', async () => {
    const session = cassette('createSession-200.json');
    const record = cassette('createRecord-201.json');
    const expire = { status: 401, body: { error: 'ExpiredToken', message: 'Token has expired' } };
    const { fetchFn, appels } = fetchScenario([
      { url: 'https://bsky.social/xrpc/com.atproto.server.createSession', cass: session },
      { url: 'https://bsky.social/xrpc/com.atproto.repo.createRecord', cass: record, remplacement: expire },
      { url: 'https://bsky.social/xrpc/com.atproto.server.createSession', cass: session },
      { url: 'https://bsky.social/xrpc/com.atproto.repo.createRecord', cass: record, remplacement: expire },
    ]);
    const result = await sendBluesky(
      ficheConfirmee(),
      makeEnv(makeDb().db, CLE_BLUESKY),
      fetchFn,
    );
    expect(result.status).toBe('ERROR');
    if (result.status === 'ERROR') {
      expect(result.retryable).toBe(false);
      expect(result.reason).toContain('après rafraîchissement');
    }
    expect(appels()).toBe(4);
  });

  it('BLUESKY_HANDLE/BLUESKY_APP_PASSWORD absents → PENDING_KEYS, aucun appel réseau', async () => {
    const result = await sendBluesky(
      ficheConfirmee(),
      makeEnv(makeDb().db, { BLUESKY_HANDLE: 'francepassoire.bsky.social' }),
      fetchExplosif as unknown as typeof fetch,
    );
    expect(result.status).toBe('PENDING_KEYS');
    if (result.status === 'PENDING_KEYS') {
      expect(result.reason).toContain('BLUESKY_HANDLE');
      expect(result.reason).toContain('BLUESKY_APP_PASSWORD');
      expect(result.reason).toContain('mot de passe d’application');
    }
    expect(fetchExplosif).not.toHaveBeenCalled();
  });

  it('createSession 401 (identifiants morts) → erreur PERMANENTE, un seul appel', async () => {
    const { fetchFn, appels } = fetchScenario([
      {
        url: 'https://bsky.social/xrpc/com.atproto.server.createSession',
        cass: cassette('createSession-401.json'),
      },
    ]);
    const result = await sendBluesky(
      ficheConfirmee(),
      makeEnv(makeDb().db, CLE_BLUESKY),
      fetchFn,
    );
    expect(result.status).toBe('ERROR');
    if (result.status === 'ERROR') {
      expect(result.retryable).toBe(false);
      expect(result.reason).toContain('401');
    }
    expect(appels()).toBe(1);
  });

  it('createRecord 429 (rate limit) → erreur REJOUABLE au cron suivant', async () => {
    const record = cassette('createRecord-201.json');
    const { fetchFn } = fetchScenario([
      { url: 'https://bsky.social/xrpc/com.atproto.server.createSession', cass: cassette('createSession-200.json') },
      {
        url: 'https://bsky.social/xrpc/com.atproto.repo.createRecord',
        cass: record,
        remplacement: { status: 429, body: { error: 'RateLimitExceeded' } },
      },
    ]);
    const result = await sendBluesky(
      ficheConfirmee(),
      makeEnv(makeDb().db, CLE_BLUESKY),
      fetchFn,
    );
    expect(result.status).toBe('ERROR');
    if (result.status === 'ERROR') {
      expect(result.retryable).toBe(true);
    }
  });
});

describe('client Nostr — clé, note, relais (T38)', () => {
  it('NOSTR_NSEC absent → PENDING_KEYS, la raison documente wrangler secret put', async () => {
    const result = await sendNostr(ficheConfirmee(), makeEnv(makeDb().db), fetchExplosif as unknown as typeof fetch);
    expect(result.status).toBe('PENDING_KEYS');
    if (result.status === 'PENDING_KEYS') {
      expect(result.reason).toContain('wrangler secret put NOSTR_NSEC');
      expect(result.reason).toContain('nostr.key');
    }
  });

  it('normalizeSecret accepte le hex canonique ET le nsec bech32 (clé fraîche), rejette l’invalide', () => {
    // Clé générée DANS le test — jamais la clé d'ancrage en quarantaine.
    const secret = generateSecretKey();
    const hex = Array.from(secret, (o) => o.toString(16).padStart(2, '0')).join('');
    expect(normalizeSecret(hex)).toEqual(secret);
    expect(normalizeSecret(`  ${hex}  `)).toEqual(secret);
    expect(normalizeSecret(nip19.nsecEncode(secret))).toEqual(secret);
    expect(() => normalizeSecret('npub1ceciestunepub')).toThrow(/NOSTR_NSEC/);
    expect(() => normalizeSecret('pas-un-secret')).toThrow(/hex 64 caractères/);
  });

  it('buildNote signe une note kind 1 vérifiable, sans doublon d’URL (ajoutée seulement si absente)', () => {
    const secret = generateSecretKey();
    const avecUrl = buildNote(ficheRevendiqueeAvecMention(), secret);
    expect(verifyEvent(avecUrl)).toBe(true);
    expect(avecUrl.kind).toBe(1);
    expect(avecUrl.content).toBe(ficheRevendiqueeAvecMention().text);
    expect(avecUrl.content.match(new RegExp(URL_FICHE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);

    const sansUrl: PostPayload = {
      text: 'Nouvelle fiche confirmée : Alaxione — 900 000 patients.',
      url: URL_FICHE,
      statut: 'confirmee',
    };
    const enrichie = buildNote(sansUrl, secret);
    expect(verifyEvent(enrichie)).toBe(true);
    expect(enrichie.content).toBe(`${sansUrl.text} ${URL_FICHE}`);
  });

  it('envoi via WebSocket factices : ≥ 1 relais OK → SENT avec l’id d’événement, trames ["EVENT", note] sur les 3 relais', async () => {
    const { fabrique, sockets } = fabriqueWs();
    setFabriqueWs(fabrique);
    const env = makeEnv(makeDb().db, { NOSTR_NSEC: hexTest() });
    const result = await sendNostr(ficheConfirmee(), env, fetchExplosif as unknown as typeof fetch);
    expect(result.status).toBe('SENT');
    if (result.status === 'SENT') {
      expect(result.externalId).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(sockets.map((s) => s.url)).toEqual([...RELAIS_EPINGLES]);
    for (const socket of sockets) {
      expect(socket.envoyes).toHaveLength(1);
      const trame = JSON.parse(socket.envoyes[0] ?? '') as [string, unknown];
      expect(trame[0]).toBe('EVENT');
    }
  });

  it('tous les relais indisponibles (fermeture avant OK) → erreur REJOUABLE', async () => {
    const { fabrique } = fabriqueWs({
      'wss://relay.damus.io': 'ferme',
      'wss://nos.lol': 'erreur',
      'wss://relay.primal.net': 'ferme',
    });
    setFabriqueWs(fabrique);
    const env = makeEnv(makeDb().db, { NOSTR_NSEC: hexTest() });
    const result = await sendNostr(ficheConfirmee(), env, fetchExplosif as unknown as typeof fetch);
    expect(result.status).toBe('ERROR');
    if (result.status === 'ERROR') {
      expect(result.retryable).toBe(true);
      expect(result.reason).toContain('aucun relais');
    }
  });
});

describe('file social_outbox — intégration Bluesky + Nostr (T38)', () => {
  it('drain avec clés : lignes bluesky et nostr → SENT ; ligne revendiquée SANS mention → INVALID avant tout envoi', async () => {
    const sansMention: PostPayload = {
      text: `Nouvelle fiche revendiquée : Alaxione — 1,2 million de comptes. Détails : ${URL_FICHE}`,
      url: URL_FICHE,
      statut: 'revendiquee',
    };
    const { db, lignes } = makeDb([
      { id: 'ligne-bsky-1', platform: 'bluesky', payload: JSON.stringify(ficheConfirmee()), status: 'PENDING', scheduled_at: null },
      { id: 'ligne-nostr-1', platform: 'nostr', payload: JSON.stringify(ficheRevendiqueeAvecMention()), status: 'PENDING', scheduled_at: null },
      { id: 'ligne-bsky-2', platform: 'bluesky', payload: JSON.stringify(sansMention), status: 'PENDING', scheduled_at: null },
    ]);
    const { fabrique, sockets } = fabriqueWs();
    setFabriqueWs(fabrique);
    const { fetchFn, appels } = fetchScenario([
      { url: 'https://bsky.social/xrpc/com.atproto.server.createSession', cass: cassette('createSession-200.json') },
      { url: 'https://bsky.social/xrpc/com.atproto.repo.createRecord', cass: cassette('createRecord-201.json') },
    ]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = makeEnv(db, { ...CLE_BLUESKY, NOSTR_NSEC: hexTest() });

    const outcomes = await runDrain(env, { fetchFn });

    expect(outcomes).toEqual([
      { id: 'ligne-bsky-1', platform: 'bluesky', status: 'SENT' },
      { id: 'ligne-nostr-1', platform: 'nostr', status: 'SENT' },
      { id: 'ligne-bsky-2', platform: 'bluesky', status: 'INVALID' },
    ]);
    expect(lignes.map((l) => l.status)).toEqual(['SENT', 'SENT', 'INVALID']);
    // Un seul cycle Bluesky réseau (la ligne INVALID n'y va jamais) + 3 sockets Nostr.
    expect(appels()).toBe(2);
    expect(sockets).toHaveLength(3);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`CAVEAT ligne ligne-bsky-2 (bluesky)`),
    );
  });

  it('drain sans secrets : lignes bluesky et nostr → PENDING_KEYS (jamais un échec)', async () => {
    const { db, lignes } = makeDb([
      { id: 'ligne-bsky-1', platform: 'bluesky', payload: JSON.stringify(ficheConfirmee()), status: 'PENDING', scheduled_at: null },
      { id: 'ligne-nostr-1', platform: 'nostr', payload: JSON.stringify(ficheRevendiqueeAvecMention()), status: 'PENDING', scheduled_at: null },
    ]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = makeEnv(db);

    const outcomes = await runDrain(env, { fetchFn: fetchExplosif as unknown as typeof fetch });

    expect(outcomes).toEqual([
      { id: 'ligne-bsky-1', platform: 'bluesky', status: 'PENDING_KEYS' },
      { id: 'ligne-nostr-1', platform: 'nostr', status: 'PENDING_KEYS' },
    ]);
    expect(lignes.map((l) => l.status)).toEqual(['PENDING_KEYS', 'PENDING_KEYS']);
    expect(fetchExplosif).not.toHaveBeenCalled();
  });
});

/** Clé fraîche hex par test — générée, jamais la clé en quarantaine. */
function hexTest(): string {
  return Array.from(generateSecretKey(), (o) => o.toString(16).padStart(2, '0')).join('');
}
