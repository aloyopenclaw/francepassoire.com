import { afterEach, describe, expect, it, vi } from 'vitest';
// Chien de garde autonome (T50) : KV factice en mémoire, fetch/publish
// injectés, WebSocket Nostr factice — aucun réseau sous vitest. La clé de
// test est TOUJOURS fraîchement générée (jamais la clé en quarantaine).
import {
  CIBLES,
  CLE_HISTORIQUE,
  DELAI_FETCH_MS,
  heureUtc,
  texteAlerte,
} from '../workers/watchdog/src/cibles';
import {
  runChecks,
  sonder,
  type CheckResultat,
  type Env,
  type KVNamespace,
  type PublishFn,
} from '../workers/watchdog/src/index';
import {
  RELAIS_EPINGLES,
  buildAlerteNote,
  normalizeSecret,
  publierTexte,
  reinitFabriqueWs,
  setFabriqueWs,
  type FabriqueWs,
  type SocketRelais,
} from '../workers/watchdog/src/nostr';
import { generateSecretKey, nip19, verifyEvent } from 'nostr-tools';

// ---------------------------------------------------------------------------
// Fakes : KV Map, fetch par URL, publication capturante.
// ---------------------------------------------------------------------------

function makeEnv(secrets: Partial<Env> = {}): { env: Env; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv: KVNamespace = {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
  return { env: { WATCHDOG: kv, ...secrets }, store };
}

const CORPS_SAINS: Record<string, () => Response> = {
  'https://francepassoire.com/': () =>
    new Response('<!DOCTYPE html><html><title>FrancePassoire</title></html>', { status: 200 }),
  'https://francepassoire.com/feed.xml': () =>
    new Response('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>', {
      status: 200,
    }),
  'https://francepassoire.com/registre.jsonl': () =>
    new Response('{"index":0,"hash":"abc"}\n', { status: 200 }),
  'https://api.francepassoire.com/api/health': () => new Response('{"ok":true}', { status: 200 }),
};

function fetchParUrl(overrides: Record<string, () => Response> = {}): typeof fetch {
  const table = { ...CORPS_SAINS, ...overrides };
  return (async (url: RequestInfo | URL) => {
    const fab = table[String(url)];
    if (!fab) {
      throw new Error(`URL inattendue sous test : ${String(url)}`);
    }
    return fab();
  }) as typeof fetch;
}

const horsLigne = (): Response => new Response('Service Unavailable', { status: 503 });

interface NotePubliee {
  texte: string;
}

function makePublish(): { publish: PublishFn; notes: NotePubliee[] } {
  const notes: NotePubliee[] = [];
  return {
    notes,
    publish: async (texte) => {
      notes.push({ texte });
      return { ok: true, id: `note-${String(notes.length).padStart(2, '0')}`, detail: 'fake' };
    },
  };
}

function semerEtat(store: Map<string, string>, cibleId: string, ok: boolean, since: string): void {
  store.set(`watchdog:state:${cibleId}`, JSON.stringify({ ok, since, lastCheck: since }));
}

function lireEtat(store: Map<string, string>, cibleId: string): Record<string, unknown> {
  return JSON.parse(store.get(`watchdog:state:${cibleId}`) ?? '{}') as Record<string, unknown>;
}

const MAINTENANT = new Date('2026-08-21T10:40:00.000Z');
const IL_Y_A_10_MIN = new Date('2026-08-21T10:30:00.000Z');

afterEach(() => {
  vi.restoreAllMocks();
  reinitFabriqueWs();
});

// ---------------------------------------------------------------------------

describe('watchdog — steady state, transitions, historique (T50)', () => {
  it('toutes cibles saines ET état KV sain : AUCUNE note, états et historique mis à jour', async () => {
    const { env, store } = makeEnv();
    for (const c of CIBLES) semerEtat(store, c.id, true, IL_Y_A_10_MIN.toISOString());
    const { publish, notes } = makePublish();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const resultats = await runChecks(env, { fetchFn: fetchParUrl(), publish, now: () => MAINTENANT });

    expect(resultats.map((r) => r.transition)).toEqual([null, null, null, null]);
    expect(notes).toHaveLength(0);
    // « since » inchangé (pas de transition), « lastCheck » rafraîchi.
    for (const c of CIBLES) {
      const etat = lireEtat(store, c.id);
      expect(etat).toEqual({ ok: true, since: IL_Y_A_10_MIN.toISOString(), lastCheck: MAINTENANT.toISOString() });
    }
    const historique = JSON.parse(store.get(CLE_HISTORIQUE) ?? '[]') as unknown[];
    expect(historique).toHaveLength(4);
  });

  it('première observation (KV vide) : baseline posée sans aucune note', async () => {
    const { env, store } = makeEnv();
    const { publish, notes } = makePublish();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const resultats = await runChecks(env, { fetchFn: fetchParUrl(), publish, now: () => MAINTENANT });

    expect(resultats.every((r) => r.transition === null)).toBe(true);
    expect(notes).toHaveLength(0);
    for (const c of CIBLES) {
      expect(lireEtat(store, c.id)).toEqual({
        ok: true,
        since: MAINTENANT.toISOString(),
        lastCheck: MAINTENANT.toISOString(),
      });
    }
  });

  it('transition ok→down : UNE note « inaccessible depuis <heure UTC> », état basculé', async () => {
    const { env, store } = makeEnv();
    for (const c of CIBLES) semerEtat(store, c.id, true, IL_Y_A_10_MIN.toISOString());
    const { publish, notes } = makePublish();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const resultats = await runChecks(env, {
      fetchFn: fetchParUrl({ 'https://francepassoire.com/feed.xml': horsLigne }),
      publish,
      now: () => MAINTENANT,
    });

    expect(resultats.find((r) => r.cible === 'flux-rss')).toMatchObject({
      ok: false,
      transition: 'vers-hors-ligne',
      noteId: 'note-01',
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.texte).toBe(
      'Surveillance FrancePassoire : le flux RSS inaccessible depuis 2026-08-21 10:40 UTC.',
    );
    expect(lireEtat(store, 'flux-rss')).toEqual({
      ok: false,
      since: MAINTENANT.toISOString(),
      lastCheck: MAINTENANT.toISOString(),
    });
    // Les 3 autres cibles n'ont pas bougé.
    expect(resultats.filter((r) => r.transition !== null)).toHaveLength(1);
  });

  it('récupération down→ok : UNE note « rétablie » avec la durée d’indisponibilité', async () => {
    const { env, store } = makeEnv();
    for (const c of CIBLES) semerEtat(store, c.id, true, IL_Y_A_10_MIN.toISOString());
    semerEtat(store, 'api', false, IL_Y_A_10_MIN.toISOString());
    const { publish, notes } = makePublish();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const resultats = await runChecks(env, { fetchFn: fetchParUrl(), publish, now: () => MAINTENANT });

    expect(resultats.find((r) => r.cible === 'api')).toMatchObject({
      ok: true,
      transition: 'vers-en-ligne',
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.texte).toBe(
      'Surveillance FrancePassoire : l’API publique rétablie à 2026-08-21 10:40 UTC (indisponible 10 min).',
    );
    expect(lireEtat(store, 'api')).toEqual({
      ok: true,
      since: MAINTENANT.toISOString(),
      lastCheck: MAINTENANT.toISOString(),
    });
  });

  it('les 4 cibles tombent : 4 notes, 4 états basculés', async () => {
    const { env, store } = makeEnv();
    for (const c of CIBLES) semerEtat(store, c.id, true, IL_Y_A_10_MIN.toISOString());
    const { publish, notes } = makePublish();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const resultats = await runChecks(env, {
      fetchFn: fetchParUrl({
        'https://francepassoire.com/': horsLigne,
        'https://francepassoire.com/feed.xml': horsLigne,
        'https://francepassoire.com/registre.jsonl': horsLigne,
        'https://api.francepassoire.com/api/health': horsLigne,
      }),
      publish,
      now: () => MAINTENANT,
    });

    expect(resultats.every((r) => r.transition === 'vers-hors-ligne' && r.ok === false)).toBe(true);
    expect(notes).toHaveLength(4);
    for (const c of CIBLES) expect(lireEtat(store, c.id).ok).toBe(false);
  });

  it('corps 200 mais marqueur absent (accueil sans « FrancePassoire », santé sans ok:true) : down', async () => {
    const { env } = makeEnv();
    const fetchMarqueursManquants = fetchParUrl({
      'https://francepassoire.com/': () => new Response('<html>Autre site</html>', { status: 200 }),
      'https://api.francepassoire.com/api/health': () => new Response('{"ok":false}', { status: 200 }),
    });
    // sonder est pur : vérification directe, sans KV ni note.
    expect(await sonder(CIBLES[0]!, fetchMarqueursManquants)).toBe(false);
    expect(await sonder(CIBLES[3]!, fetchMarqueursManquants)).toBe(false);
    expect(await sonder(CIBLES[0]!, fetchParUrl())).toBe(true);
  });

  it('timeout fetch 15 s (AbortController) : cible déclarée down, note partie', async () => {
    vi.useFakeTimers();
    try {
      const { env, store } = makeEnv();
      semerEtat(store, 'registre', true, IL_Y_A_10_MIN.toISOString());
      const { publish, notes } = makePublish();
      // Seule la cible registre bloque ; les autres répondent sain.
      const fetchBloquant: typeof fetch = (url, init) => {
        if (String(url) === 'https://francepassoire.com/registre.jsonl') {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          });
        }
        return Promise.resolve((CORPS_SAINS[String(url)] as () => Response)());
      };
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const promesse = runChecks(env, { fetchFn: fetchBloquant, publish, now: () => MAINTENANT });
      await vi.advanceTimersByTimeAsync(DELAI_FETCH_MS);
      const resultats: CheckResultat[] = await promesse;

      expect(resultats.find((r) => r.cible === 'registre')).toMatchObject({
        ok: false,
        transition: 'vers-hors-ligne',
      });
      expect(notes).toHaveLength(1);
      expect(notes[0]?.texte).toContain('registre d’intégrité inaccessible');
    } finally {
      vi.useRealTimers();
    }
  });

  it('NOSTR_NSEC absent, sans publish injecté : mode DÉTECT-ONLY — état mis à jour, console.error, pas de crash', async () => {
    const { env, store } = makeEnv(); // aucun secret
    for (const c of CIBLES) semerEtat(store, c.id, true, IL_Y_A_10_MIN.toISOString());
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const resultats = await runChecks(env, {
      fetchFn: fetchParUrl({ 'https://francepassoire.com/': horsLigne }),
      now: () => MAINTENANT,
    });

    expect(resultats.find((r) => r.cible === 'accueil')).toMatchObject({
      ok: false,
      transition: 'vers-hors-ligne',
      detectOnly: true,
      noteId: undefined,
    });
    expect(lireEtat(store, 'accueil').ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('DÉTECT-ONLY'),
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('page d’accueil inaccessible'));
  });

  it('historique : tampon circulaire FIFO borné à 100 entrées', async () => {
    const { env, store } = makeEnv();
    // 100 entrées pré-existantes + 4 nouvelles → 100, les plus anciennes évincées.
    const anciennes = Array.from({ length: 100 }, (_, i) => ({
      cible: 'accueil',
      ok: true,
      at: new Date(2026, 0, 1, 0, i).toISOString(),
    }));
    store.set(CLE_HISTORIQUE, JSON.stringify(anciennes));
    const { publish } = makePublish();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await runChecks(env, { fetchFn: fetchParUrl(), publish, now: () => MAINTENANT });

    const historique = JSON.parse(store.get(CLE_HISTORIQUE) ?? '[]') as { cible: string }[];
    expect(historique).toHaveLength(100);
    expect(historique[0]).not.toEqual(anciennes[0]); // le plus ancien est sorti
    expect(historique.slice(-4).map((e) => e.cible)).toEqual(CIBLES.map((c) => c.id));
  });

  it('texteAlerte : formats Ton A exacts (inaccessible / rétablie)', () => {
    const accueil = CIBLES[0]!;
    expect(texteAlerte(accueil, false, MAINTENANT)).toBe(
      'Surveillance FrancePassoire : la page d’accueil inaccessible depuis 2026-08-21 10:40 UTC.',
    );
    expect(texteAlerte(accueil, true, MAINTENANT, IL_Y_A_10_MIN)).toBe(
      'Surveillance FrancePassoire : la page d’accueil rétablie à 2026-08-21 10:40 UTC (indisponible 10 min).',
    );
    expect(heureUtc(MAINTENANT)).toBe('2026-08-21 10:40 UTC');
  });
});

// ---------------------------------------------------------------------------
// Module Nostr du watchdog — clé, signature, relais (même contrat que T38).
// ---------------------------------------------------------------------------

class WsFactice implements SocketRelais {
  readonly envoyes: string[] = [];
  private ecouteurs = new Map<string, Array<(ev?: { data?: unknown }) => void>>();

  constructor(
    readonly url: string,
    private readonly mode: 'ok' | 'ferme',
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
  }

  private emettre(type: string, data?: string): void {
    for (const ecouteur of this.ecouteurs.get(type) ?? []) {
      ecouteur(data === undefined ? undefined : { data });
    }
  }

  send(trame: string): void {
    this.envoyes.push(trame);
    if (this.mode === 'ok') {
      const evenement = (JSON.parse(trame) as [string, { id: string }])[1];
      queueMicrotask(() => this.emettre('message', JSON.stringify(['OK', evenement.id, true, ''])));
    }
  }

  close(): void {
    // Rien à fermer : pas de vraie socket.
  }
}

function fabriqueWs(modes: Record<string, 'ok' | 'ferme'> = {}): {
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

/** Clé fraîche hex par test — générée, jamais la clé en quarantaine. */
function hexTest(): string {
  return Array.from(generateSecretKey(), (o) => o.toString(16).padStart(2, '0')).join('');
}

describe('watchdog — module Nostr (T50)', () => {
  it('normalizeSecret accepte le hex canonique ET le nsec bech32 (clé fraîche), rejette l’invalide', () => {
    const secret = generateSecretKey();
    const hex = Array.from(secret, (o) => o.toString(16).padStart(2, '0')).join('');
    expect(normalizeSecret(hex)).toEqual(secret);
    expect(normalizeSecret(`  ${hex}  `)).toEqual(secret);
    expect(normalizeSecret(nip19.nsecEncode(secret))).toEqual(secret);
    expect(() => normalizeSecret('pas-un-secret')).toThrow(/hex 64 caractères/);
  });

  it('buildAlerteNote signe une note kind 1 vérifiable, texte intégral', () => {
    const secret = generateSecretKey();
    const texte = 'Surveillance FrancePassoire : le flux RSS inaccessible depuis 2026-08-21 10:40 UTC.';
    const note = buildAlerteNote(texte, secret);
    expect(verifyEvent(note)).toBe(true);
    expect(note.kind).toBe(1);
    expect(note.content).toBe(texte);
  });

  it('publierTexte : ≥ 1 relais OK → ok true + id d’événement ; tous muets → ok false', async () => {
    const { fabrique, sockets } = fabriqueWs({ 'wss://nos.lol': 'ferme' });
    setFabriqueWs(fabrique);
    const verdict = await publierTexte('alerte de test', hexTest());
    expect(verdict.ok).toBe(true);
    expect(verdict.id).toMatch(/^[0-9a-f]{64}$/);
    expect(sockets.map((s) => s.url)).toEqual([...RELAIS_EPINGLES]);

    const { fabrique: muets } = fabriqueWs({
      'wss://relay.damus.io': 'ferme',
      'wss://nos.lol': 'ferme',
      'wss://relay.primal.net': 'ferme',
    });
    setFabriqueWs(muets);
    const refuse = await publierTexte('alerte de test', hexTest());
    expect(refuse.ok).toBe(false);
    expect(refuse.detail).toContain('refus/indisponible');
  });
});
