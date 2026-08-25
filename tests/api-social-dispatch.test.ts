// tests/api-social-dispatch.test.ts — dispatcher social T38/T47 : le balayage
// instant alimente social_outbox (quatre plateformes — facebook/instagram
// retirés le 23/08, décision propriétaire — idempotent, garde-mention).
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { dispatcherInstantSocial, dispatcherRecapHebdo } from '../workers/api/src/social-dispatch';
import { runInstantSweep, type FicheDigest } from '../workers/api/src/watchlist';
import type { D1Database, Env, KVNamespace } from '../workers/api/src/index';
import { MENTION_REVENDICATION } from '../src/lib/social-templates';

const MENTION = 'revendication non confirmée par l’entité';
const AES_KEY = 'a'.repeat(64);
const URL_FICHE = 'https://francepassoire.com/fiche/actua-20260822/';

function makeDb(): { d1: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE social_outbox (
    id TEXT PRIMARY KEY, platform TEXT NOT NULL, payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', scheduled_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE subscribers (
    id TEXT PRIMARY KEY, email_hash TEXT NOT NULL UNIQUE, email_enc TEXT NOT NULL,
    confirmed_at TEXT, unsub_token TEXT NOT NULL UNIQUE,
    prefs_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  const d1: D1Database = {
    prepare(sql: string) {
      const stmt = raw.prepare(sql);
      let params: unknown[] = [];
      const wrapped = {
        bind(...values: unknown[]) {
          params = params.concat(values);
          return wrapped;
        },
        async run() {
          stmt.run(...(params as Parameters<typeof stmt.run>));
          return { success: true };
        },
        async first() {
          return (stmt.get(...(params as Parameters<typeof stmt.get>)) ?? null) as unknown;
        },
        async all() {
          return stmt.all(...(params as Parameters<typeof stmt.all>)) as unknown[];
        },
      };
      return wrapped as never;
    },
  };
  return { d1, raw };
}

class FakeKV implements KVNamespace {
  store = new Map<string, string>();
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }
  put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }
}

const revendiquee: FicheDigest = {
  slug: 'actua-20260822',
  entity: 'Actua',
  secteur: 'services',
  statut: 'revendiquee',
  description: 'Le 22 août 2026, le groupe LockBit 5.0 revendique une attaque contre Actua.',
  data_types: ['identite'],
  dates: { revendication: '2026-08-22', publication: '2026-08-22' },
  volume: { label: 'plus de 100 000 personnes recrutées selon LockBit 5.0 ; passeports annoncés' },
};

const confirmee: FicheDigest = {
  ...revendiquee,
  slug: 'ird-20260821',
  entity: 'IRD',
  statut: 'confirmee',
  volume: { label: '7 500 personnes' },
};

function lignes(raw: DatabaseSync) {
  return (raw.prepare('SELECT id, platform, payload FROM social_outbox ORDER BY id').all() as object[])
    .map((r) => ({ ...(r as object), payload: JSON.parse((r as { payload: string }).payload) }) as {
      id: string;
      platform: string;
      payload: { text: string; statut?: string; imageUrl?: string };
    });
}

describe('dispatcherInstantSocial — nouvelle fiche', () => {
  it('revendiquée : quatre plateformes, mention EXACTE partout (garde du drain), LONG avec image', async () => {
    const { d1, raw } = makeDb();
    await dispatcherInstantSocial(d1, [revendiquee], [], { log: () => {} });
    const rows = lignes(raw);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.platform).sort()).toEqual(
      ['bluesky', 'linkedin', 'nostr', 'x'],
    );
    for (const r of rows) {
      expect(r.id).toBe(`sw:actua-20260822:${r.platform}`);
      expect(r.payload.statut).toBe('revendiquee');
      expect(r.payload.text).toContain(MENTION);
    }
    const li = rows.find((r) => r.platform === 'linkedin')!;
    expect(li.payload.imageUrl).toBe(URL_FICHE + 'card.jpg');
    expect(li.payload.text).toContain('Statut : Revendiquée (revendication non confirmée par l’entité)');
    const x = rows.find((r) => r.platform === 'x')!;
    expect(x.payload.text).toContain('Nouvelle fiche revendiquée : Actua');
    expect(x.payload.imageUrl).toBeUndefined();
  });

  it('confirmée : COURT = gabarit propriétaire, sans mention exiger, LONG hashtags', async () => {
    const { d1, raw } = makeDb();
    await dispatcherInstantSocial(d1, [confirmee], [], { log: () => {} });
    const rows = lignes(raw);
    expect(rows).toHaveLength(4);
    const x = rows.find((r) => r.platform === 'x')!;
    expect(x.payload.text.startsWith('🚨📣 Nouvelle fuite recensée : IRD')).toBe(true);
    expect(x.payload.text).not.toContain(MENTION);
    const li = rows.find((r) => r.platform === 'linkedin')!;
    expect(li.payload.text).toContain('#FrancePassoire');
  });

  it('idempotent : double passage = zéro doublon (id déterministe + OR IGNORE)', async () => {
    const { d1, raw } = makeDb();
    await dispatcherInstantSocial(d1, [revendiquee], [], { log: () => {} });
    await dispatcherInstantSocial(d1, [revendiquee], [], { log: () => {} });
    expect((lignes(raw)).length).toBe(4);
  });

  it('rendu refusé (volume monstrueux en COURT) : plateforme sautée avec log, les autres partent, aucun crash', async () => {
    const { d1, raw } = makeDb();
    const monstre: FicheDigest = {
      ...confirmee,
      slug: 'monstre-20260823',
      entity: 'Une Entité Au Nom Beaucoup Trop Long Pour Tenir Dans La Limite De Caracteres De X',
      volume: { label: 'un volume extraordinairement long qui ne tiendra jamais dans la limite X' },
    };
    await dispatcherInstantSocial(d1, [monstre], [], { log: () => {} });
    const rows = lignes(raw);
    const plates = rows.map((r) => r.platform).sort();
    expect(plates).toEqual(['linkedin']);
  });
});

describe('dispatcherInstantSocial — porte d\'âge (7 jours, décision propriétaire 23/08)', () => {
  it('fiche revendiquée il y a plus de 7 jours → AUCUNE ligne en file, log sonore du skip', async () => {
    const { d1, raw } = makeDb();
    const vieille: FicheDigest = { ...revendiquee, slug: 'france-pare-brise-20260713', dates: { revendication: '2026-07-13', publication: '2026-08-23' } };
    const logs: string[] = [];
    await dispatcherInstantSocial(d1, [vieille], [], { log: (...a: unknown[]) => logs.push(String(a[0])), now: new Date('2026-08-23T12:00:00Z') });
    expect((lignes(raw)).length).toBe(0);
    expect(logs.some((l) => l.includes('france-pare-brise-20260713') && l.includes('porte d\'âge'))).toBe(true);
  });

  it('fiche revendiquée il y a 3 jours → publiée (4 plateformes)', async () => {
    const { d1, raw } = makeDb();
    const recente: FicheDigest = { ...revendiquee, dates: { revendication: '2026-08-20', publication: '2026-08-23' } };
    await dispatcherInstantSocial(d1, [recente], [], { log: () => {}, now: new Date('2026-08-23T12:00:00Z') });
    expect((lignes(raw)).length).toBe(4);
  });

  it('la porte ne s\'applique PAS aux changements de statut : vieille fiche confirmée → 4 lignes sw:maj', async () => {
    const { d1, raw } = makeDb();
    const vieilleConfirmee: FicheDigest = { ...confirmee, slug: 'vieille-confirmee-20260701', dates: { revendication: '2026-07-01', publication: '2026-08-23' }, statut: 'confirmee' };
    await dispatcherInstantSocial(d1, [], [vieilleConfirmee], { log: () => {}, now: new Date('2026-08-23T12:00:00Z') });
    const rows = lignes(raw);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.id.startsWith('sw:maj:vieille-confirmee-20260701:'))).toBe(true);
  });
});

describe('dispatcherInstantSocial — changement de statut', () => {  it('revendiquée → confirmée : quatre lignes sw:maj, texte de transition légale', async () => {
    const { d1, raw } = makeDb();
    await dispatcherInstantSocial(d1, [], [confirmee], { log: () => {} });
    const rows = lignes(raw);
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.id).toBe(`sw:maj:ird-20260821:${r.platform}`);
      expect(r.payload.text).toContain('passe de « revendiquée » à « confirmée »');
      expect(r.payload.statut).toBe('confirmee');
    }
  });
});

describe('intégration runInstantSweep → file sociale', () => {
  it('une fiche nouvelle détectée par le balayage part en file sans abonné', async () => {
    const { d1, raw } = makeDb();
    const kv = new FakeKV();
    await kv.put('watchlist:instant:last_catalog', JSON.stringify({ 'ird-20260821': { statut: 'confirmee' } }));
    const env = {
      DB: d1,
      RUN_STATE: kv,
      RATE_LIMIT: kv,
      BREVO_API_KEY: 'cle-test',
      WATCHLIST_AES_KEY: AES_KEY,
    } as unknown as Env;

    const fetchFn = (url: string | URL | Request): Promise<Response> => {
      const u = String(url);
      if (u.startsWith('https://francepassoire.com/opendata/v1/fiches.json')) {
        return Promise.resolve(
          new Response(JSON.stringify({ fiches: [revendiquee, confirmee] }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response('intronvable', { status: 404 }));
    };

    const resultat = await runInstantSweep(env, { fetchFn, sleep: async () => {}, log: () => {} });
    expect(resultat.nouveaux).toBe(1);
    const rows = lignes(raw);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.payload.text.includes(MENTION_REVENDICATION))).toBe(true);
  });
});

describe('dispatcherRecapHebdo — récap hebdo social (25/08)', () => {
  const opts = {
    numero: 2,
    fiches: 12,
    personnes: 2_400_000,
    libellePersonnes: 'personnes et comptes exposés',
    exemples: [
      { entity: 'Alaxione', statut: 'confirmee', volume: '6 800 000 personnes' },
      { entity: 'Actua', statut: 'revendiquee', volume: '100 000 personnes' },
    ],
  };

  it('trois lignes (linkedin, x, bluesky), ids déterministes, imageUrl LinkedIn uniquement, mention sur la longue', async () => {
    const { d1, raw } = makeDb();
    await dispatcherRecapHebdo(d1, { ...opts, log: () => {} });
    const rows = lignes(raw);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.platform).sort()).toEqual(['bluesky', 'linkedin', 'x']);
    for (const r of rows) expect(r.id).toBe(`sw:recap:2:${r.platform}`);
    const li = rows.find((r) => r.platform === 'linkedin')!;
    expect(li.payload.imageUrl).toBe('https://francepassoire.com/og-image.jpg');
    expect(li.payload.text).toContain('Le Récap Passoire · N°2');
    expect(li.payload.text).toContain('revendication non confirmée par l’entité');
    expect(li.payload.text).toContain('- Alaxione · Confirmée ·');
    const x = rows.find((r) => r.platform === 'x')!;
    expect(x.payload.imageUrl).toBeUndefined();
    expect(x.payload.text).toContain('Cette semaine sur FrancePassoire');
    expect(x.payload.text.length).toBeLessThanOrEqual(280);
  });

  it('idempotent : double appel → toujours 3 lignes', async () => {
    const { d1, raw } = makeDb();
    await dispatcherRecapHebdo(d1, { ...opts, log: () => {} });
    await dispatcherRecapHebdo(d1, { ...opts, log: () => {} });
    expect(lignes(raw)).toHaveLength(3);
  });
});

describe('dispatcherInstantSocial — volume COURT compact (correctif 25/08)', () => {
  it('volume long avec count/unit : les QUATRE plateformes partent, COURT compact « N unité », mention intacte, ≤ 260', async () => {
    const { d1, raw } = makeDb();
    const ficheLongVolume: FicheDigest = {
      ...revendiquee,
      slug: 'protection-civile-20260821',
      entity: 'Protection Civile',
      volume: { label: "plus de 525 000 profils selon FrenchBreaches, chiffre contesté par la FNPC qui évoque de nombreux doublons", count: 525000, unit: 'personnes' },
    };
    await dispatcherInstantSocial(d1, [ficheLongVolume], [], { log: () => {}, now: new Date('2026-08-25T12:00:00Z') });
    const rows = lignes(raw);
    expect(rows).toHaveLength(4);
    const x = rows.find((r) => r.platform === 'x')!;
    expect(x.payload.text).toContain('525 000 personnes');
    expect(x.payload.text).toContain(MENTION_REVENDICATION);
    expect(x.payload.text.length).toBeLessThanOrEqual(260);
    const li = rows.find((r) => r.platform === 'linkedin')!;
    expect(li.payload.text).toContain('525 000 profils selon FrenchBreaches');
  });

  it('volume long SANS count (revendiquée, cas réel banque-alimentaire) : extraction « nombre + mot » en tête, les 4 plateformes partent', async () => {
    const { d1, raw } = makeDb();
    const fiche: FicheDigest = {
      ...revendiquee,
      slug: 'banque-alimentaire-de-strasbourg-20260825',
      entity: 'Banque Alimentaire',
      volume: { label: "10 073 enregistrements revendiqués par l'acteur Lagui1337, selon FrenchBreaches et Cyberattaque.org" },
    };
    await dispatcherInstantSocial(d1, [fiche], [], { log: () => {}, now: new Date('2026-08-25T12:00:00Z') });
    const rows = lignes(raw);
    expect(rows).toHaveLength(4);
    const x = rows.find((r) => r.platform === 'x')!;
    expect(x.payload.text).toContain('10 073 enregistrements');
    expect(x.payload.text).toContain(MENTION_REVENDICATION);
    expect(x.payload.text.length).toBeLessThanOrEqual(260);
  });

  it('confirmée COURT (rare : fiche née confirmée) : volume micro-cap 12, gabarit à 280 respecté', async () => {
    const { d1, raw } = makeDb();
    const fiche: FicheDigest = {
      ...confirmee,
      slug: 'ird-20260821',
      entity: 'IRD',
      volume: { label: '7 500 personnes', count: 7500, unit: 'personnes' },
    };
    await dispatcherInstantSocial(d1, [fiche], [], { log: () => {}, now: new Date('2026-08-25T12:00:00Z') });
    const x = lignes(raw).find((r) => r.platform === 'x')!;
    expect(x.payload.text).toContain('Statut : Confirmée');
    expect(x.payload.text.length).toBeLessThanOrEqual(280);
  });
});
