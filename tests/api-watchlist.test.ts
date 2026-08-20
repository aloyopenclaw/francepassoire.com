import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// T30/T31 — veille par email + moteur d'alertes Brevo (workers/api).
// Vraie sémantique SQLite (node:sqlite, schéma réel de migrations/0001_init.sql)
// derrière l'interface D1, KV fake avec TTL, fetch siteverify/Brevo/fiches.json
// mocké par routage d'URL — aucune dépendance runtime Cloudflare.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  handleRequest,
  type D1Database,
  type D1PreparedStatement,
  type Env,
  type KVNamespace,
} from '../workers/api/src/index';
import {
  decryptEmailAes,
  emailHashOf,
  encryptEmailAes,
  enqueueInstantAlert,
  mintConfirmToken,
  runWeeklyDigest,
  type FicheDigest,
} from '../workers/api/src/watchlist';

const SCHEMA = readFileSync(
  fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url)),
  'utf-8',
);

const AES_KEY = '11'.repeat(32);
const HASH_KEY = '22'.repeat(32);
const NOW = new Date('2026-08-21T09:00:00Z');

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeKV implements KVNamespace {
  readonly store = new Map<string, { value: string; expiresAtMs: number | null }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs !== null && Date.now() >= entry.expiresAtMs) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    const expiresAtMs = opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
    this.store.set(key, { value, expiresAtMs });
  }
}

function makeDb(): { d1: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  const d1: D1Database = {
    prepare(sql: string) {
      const stmt = raw.prepare(sql);
      let params: unknown[] = [];
      const wrapped: D1PreparedStatement = {
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
      return wrapped;
    },
  };
  return { d1, raw };
}

interface MakeEnvOverrides {
  turnstileSecret?: string;
  brevoKey?: string;
  aesKey?: string;
  hashKey?: string;
}

function makeEnv(overrides: MakeEnvOverrides = {}): { env: Env; raw: DatabaseSync; kv: FakeKV } {
  const { d1, raw } = makeDb();
  const kv = new FakeKV();
  const env: Env = {
    DB: d1,
    RATE_LIMIT: kv,
    TURNSTILE_SECRET: overrides.turnstileSecret,
    BREVO_API_KEY: overrides.brevoKey,
    WATCHLIST_AES_KEY: overrides.aesKey,
    WATCHLIST_HASH_KEY: overrides.hashKey,
  };
  return { env, raw, kv };
}

const envComplet = {
  turnstileSecret: 'secret-test',
  brevoKey: 'brevo-key-test',
  aesKey: AES_KEY,
  hashKey: HASH_KEY,
};

interface BrevoBody {
  sender: { name: string; email: string };
  to: { email: string }[];
  subject: string;
  textContent: string;
  htmlContent?: string;
}

interface BrevoCall {
  headers: Record<string, string>;
  body: BrevoBody;
}

interface FetchOptions {
  siteverifyOk?: boolean;
  brevoStatus?: number;
  brevoCalls?: BrevoCall[];
  fiches?: FicheDigest[];
  fichesStatus?: number;
}

/** Routage d'URL : siteverify → Brevo → fiches.json ; tout le reste → 404. */
function makeFetch(opts: FetchOptions = {}): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('https://challenges.cloudflare.com/turnstile')) {
      return new Response(
        JSON.stringify({ success: opts.siteverifyOk !== false }),
        { status: 200 },
      );
    }
    if (u === 'https://api.brevo.com/v3/smtp/email') {
      opts.brevoCalls?.push({
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(init?.body as string) as BrevoBody,
      });
      return new Response(JSON.stringify({ messageId: 'test-123' }), {
        status: opts.brevoStatus ?? 200,
      });
    }
    if (u === 'https://francepassoire.com/api/v1/fiches.json') {
      return new Response(
        JSON.stringify({ schema: 'francepassoire/fiches@v1', count: opts.fiches?.length ?? 0, fiches: opts.fiches ?? [] }),
        { status: opts.fichesStatus ?? 200 },
      );
    }
    return new Response('introuvable', { status: 404 });
  }) as typeof fetch;
}

const validSubscribe = {
  email: 'jeanne@example.com',
  sectors: ['sante'],
  data_types: [] as string[],
  entities: [] as string[],
  freq: 'hebdo',
  turnstile_token: 'tok-valide',
};

function subscribeRequest(body: unknown, ip = '203.0.113.9'): Request {
  return new Request('https://api.francepassoire.com/api/watchlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string): Request {
  return new Request(`https://api.francepassoire.com${path}`);
}

interface SubscriberFixture {
  id: string;
  email: string;
  prefs: Record<string, unknown>;
  confirmed?: boolean;
}

async function insertSubscriber(raw: DatabaseSync, fixture: SubscriberFixture): Promise<void> {
  const emailEnc = await encryptEmailAes(fixture.email, AES_KEY);
  raw
    .prepare(
      'INSERT INTO subscribers (id, email_hash, email_enc, confirmed_at, unsub_token, prefs_json) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      fixture.id,
      createHash('sha256').update(fixture.email.trim().toLowerCase()).digest('hex'),
      emailEnc,
      fixture.confirmed ? '2026-08-19 10:00:00' : null,
      `tok${fixture.id}abcdef0123456789`,
      JSON.stringify(fixture.prefs),
    );
}

// ---------------------------------------------------------------------------
// Fixtures fiches (fenêtre digest : NOW = 2026-08-21 → cutoff 2026-08-14)
// ---------------------------------------------------------------------------

const ficheSante: FicheDigest = {
  slug: 'alaxione-20260818',
  entity: 'Alaxione',
  secteur: 'sante',
  data_types: ['sante'],
  dates: { revendication: '2026-08-18', publication: '2026-08-18' },
  volume: { label: '330 000 personnes' },
};

const ficheFinance: FicheDigest = {
  slug: 'cabinet-x-20260816',
  entity: 'Cabinet X',
  secteur: 'finance',
  data_types: ['financier'],
  dates: { revendication: '2026-08-16', publication: '2026-08-16' },
  volume: { label: '12 000 comptes' },
};

const ficheVieille: FicheDigest = {
  slug: 'vieille-20250101',
  entity: 'Vieille Entité',
  secteur: 'sante',
  data_types: ['sante'],
  dates: { revendication: '2025-01-01', publication: '2025-01-01' },
  volume: { label: '1 000 personnes' },
};

// ---------------------------------------------------------------------------
// T30 — POST /api/watchlist (double opt-in)
// ---------------------------------------------------------------------------

describe('POST /api/watchlist — inscription double opt-in', () => {
  it('insère une ligne non confirmée et envoie l’email Brevo avec expéditeur + lien de confirmation', async () => {
    const { env, raw } = makeEnv(envComplet);
    const brevoCalls: BrevoCall[] = [];
    const fetchFn = makeFetch({ brevoCalls });

    const res = await handleRequest(subscribeRequest(validSubscribe), env, { fetchFn });
    const payload = (await res.json()) as { ok: boolean; message: string };

    expect(res.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.message).toMatch(/cliquez sur le lien/i);

    const rows = raw.prepare('SELECT email_hash, email_enc, confirmed_at, unsub_token, prefs_json FROM subscribers').all() as Array<{
      email_hash: string; email_enc: string; confirmed_at: string | null; unsub_token: string; prefs_json: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.confirmed_at).toBeNull();
    expect(rows[0]!.email_hash).toBe(createHash('sha256').update('jeanne@example.com').digest('hex'));
    expect(rows[0]!.unsub_token).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(rows[0]!.prefs_json)).toEqual({
      sectors: ['sante'], data_types: [], entities: [], freq: 'hebdo',
    });
    // l'email en clair ne vit QUE chiffré
    expect(rows[0]!.email_enc).not.toContain('jeanne');
    expect(await decryptEmailAes(rows[0]!.email_enc, AES_KEY)).toBe('jeanne@example.com');

    expect(brevoCalls).toHaveLength(1);
    const body = brevoCalls[0]!.body;
    expect(body.sender).toEqual({ name: 'FrancePassoire', email: 'alerte@francepassoire.com' });
    expect(brevoCalls[0]!.headers['api-key']).toBe('brevo-key-test');
    expect(body.to).toEqual([{ email: 'jeanne@example.com' }]);
    expect(body.subject).toBe('Confirmez votre veille FrancePassoire');
    expect(body.textContent).toContain('https://francepassoire.com/api/watchlist/confirm?token=');
  });

  it('ré-abonnement : préférences mises à jour, jeton régénéré, confirmed_at conservé', async () => {
    const { env, raw } = makeEnv(envComplet);
    const fetchFn = makeFetch({ brevoCalls: [] });

    await handleRequest(subscribeRequest(validSubscribe), env, { fetchFn });
    raw.prepare('UPDATE subscribers SET confirmed_at = ?').run('2026-08-19 11:00:00');
    const tokenAvant = (raw.prepare('SELECT unsub_token FROM subscribers').get() as { unsub_token: string }).unsub_token;

    const res = await handleRequest(
      subscribeRequest({ ...validSubscribe, sectors: ['finance'] }),
      env,
      { fetchFn },
    );

    expect(res.status).toBe(201);
    const rows = raw.prepare('SELECT confirmed_at, unsub_token, prefs_json FROM subscribers').all() as Array<{
      confirmed_at: string | null; unsub_token: string; prefs_json: string;
    }>;
    expect(rows).toHaveLength(1); // UPSERT, pas de doublon
    expect(rows[0]!.confirmed_at).toBe('2026-08-19 11:00:00'); // confirmation conservée
    expect(rows[0]!.unsub_token).not.toBe(tokenAvant); // jeton régénéré
    expect(JSON.parse(rows[0]!.prefs_json).sectors).toEqual(['finance']);
  });

  it('Turnstile invalide → 403, aucune ligne, quota non consommé', async () => {
    const { env, raw, kv } = makeEnv(envComplet);
    const fetchFn = makeFetch({ siteverifyOk: false, brevoCalls: [] });

    const res = await handleRequest(subscribeRequest(validSubscribe), env, { fetchFn });

    expect(res.status).toBe(403);
    expect((raw.prepare('SELECT COUNT(*) AS n FROM subscribers').get() as { n: number }).n).toBe(0);
    expect(kv.store.size).toBe(0);
  });

  it('rate limit : 4e inscription de la même IP dans l’heure → 429 (clé rl:watchlist:)', async () => {
    const { env, raw, kv } = makeEnv(envComplet);
    const fetchFn = makeFetch({ brevoCalls: [] });

    for (let i = 1; i <= 3; i++) {
      const res = await handleRequest(
        subscribeRequest({ ...validSubscribe, email: `u${i}@example.com` }),
        env,
        { fetchFn },
      );
      expect(res.status).toBe(201);
    }
    expect(kv.store.has('rl:watchlist:203.0.113.9')).toBe(true); // clé distincte de rl:report

    const res4 = await handleRequest(subscribeRequest({ ...validSubscribe, email: 'u4@example.com' }), env, { fetchFn });
    const payload = (await res4.json()) as { error: string };

    expect(res4.status).toBe(429);
    expect(payload.error).toMatch(/trop de demandes/i);
    expect((raw.prepare('SELECT COUNT(*) AS n FROM subscribers').get() as { n: number }).n).toBe(3);
  });

  it('secteur hors énumération → 400 avec erreur FR, aucun siteverify appelé', async () => {
    const { env, raw } = makeEnv(envComplet);
    const fetchFn = vi.fn(makeFetch({ brevoCalls: [] }));

    const res = await handleRequest(
      subscribeRequest({ ...validSubscribe, sectors: ['banque'] }),
      env,
      { fetchFn },
    );
    const payload = (await res.json()) as { errors: string[] };

    expect(res.status).toBe(400);
    expect(payload.errors.some((e) => /secteur inconnu/i.test(e))).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
    expect((raw.prepare('SELECT COUNT(*) AS n FROM subscribers').get() as { n: number }).n).toBe(0);
  });

  it('email malformé → 400 avec erreur FR', async () => {
    const { env } = makeEnv(envComplet);

    const res = await handleRequest(
      subscribeRequest({ ...validSubscribe, email: 'pas-un-email' }),
      env,
      { fetchFn: makeFetch() },
    );
    const payload = (await res.json()) as { errors: string[] };

    expect(res.status).toBe(400);
    expect(payload.errors.some((e) => /email/i.test(e))).toBe(true);
  });

  it('BREVO_API_KEY absent → 503 « activation en cours » AVANT toute écriture D1', async () => {
    const { env, raw } = makeEnv({ turnstileSecret: 'secret-test', aesKey: AES_KEY, hashKey: HASH_KEY });
    const brevoCalls: BrevoCall[] = [];

    const res = await handleRequest(subscribeRequest(validSubscribe), env, {
      fetchFn: makeFetch({ brevoCalls }),
    });
    const payload = (await res.json()) as { error: string };

    expect(res.status).toBe(503);
    expect(payload.error).toMatch(/activation en cours/i);
    expect((raw.prepare('SELECT COUNT(*) AS n FROM subscribers').get() as { n: number }).n).toBe(0);
    expect(brevoCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T30 — confirm / unsub / prefs / status
// ---------------------------------------------------------------------------

describe('GET /api/watchlist/confirm|unsub|prefs|status', () => {
  it('confirm avec jeton HMAC valide → confirmed_at posé + 302 ?veille=confirmee', async () => {
    const { env, raw } = makeEnv(envComplet);
    await handleRequest(subscribeRequest(validSubscribe), env, { fetchFn: makeFetch() });

    const emailHash = await emailHashOf('jeanne@example.com');
    const token = await mintConfirmToken(emailHash, HASH_KEY);
    const res = await handleRequest(getRequest(`/api/watchlist/confirm?token=${encodeURIComponent(token)}`), env);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://francepassoire.com/proteger/?veille=confirmee');
    const row = raw.prepare('SELECT confirmed_at FROM subscribers').get() as { confirmed_at: string | null };
    expect(row.confirmed_at).not.toBeNull();
  });

  it('confirm expiré (25 h) → 302 ?veille=invalide, ligne inchangée', async () => {
    const { env, raw } = makeEnv(envComplet);
    await handleRequest(subscribeRequest(validSubscribe), env, { fetchFn: makeFetch() });

    const emailHash = await emailHashOf('jeanne@example.com');
    const token = await mintConfirmToken(emailHash, HASH_KEY, Date.now() - 25 * 3600 * 1000);
    const res = await handleRequest(getRequest(`/api/watchlist/confirm?token=${encodeURIComponent(token)}`), env);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://francepassoire.com/proteger/?veille=invalide');
    const row = raw.prepare('SELECT confirmed_at FROM subscribers').get() as { confirmed_at: string | null };
    expect(row.confirmed_at).toBeNull();
  });

  it('confirm avec signature falsifiée → 302 invalide, ligne inchangée', async () => {
    const { env, raw } = makeEnv(envComplet);
    await handleRequest(subscribeRequest(validSubscribe), env, { fetchFn: makeFetch() });

    const emailHash = await emailHashOf('jeanne@example.com');
    const token = await mintConfirmToken(emailHash, HASH_KEY);
    const falsifie = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    const res = await handleRequest(getRequest(`/api/watchlist/confirm?token=${falsifie}`), env);

    expect(res.headers.get('Location')).toBe('https://francepassoire.com/proteger/?veille=invalide');
    const row = raw.prepare('SELECT confirmed_at FROM subscribers').get() as { confirmed_at: string | null };
    expect(row.confirmed_at).toBeNull();
  });

  it('unsub 1 clic → ligne supprimée + 302 ?veille=desinscrit', async () => {
    const { env, raw } = makeEnv(envComplet);
    await handleRequest(subscribeRequest(validSubscribe), env, { fetchFn: makeFetch() });
    const { unsub_token } = raw.prepare('SELECT unsub_token FROM subscribers').get() as { unsub_token: string };

    const res = await handleRequest(getRequest(`/api/watchlist/unsub/${unsub_token}`), env);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://francepassoire.com/proteger/?veille=desinscrit');
    expect((raw.prepare('SELECT COUNT(*) AS n FROM subscribers').get() as { n: number }).n).toBe(0);
  });

  it('unsub jeton inconnu → 302 propre (desinscrit), sans oracle ni crash', async () => {
    const { env } = makeEnv(envComplet);

    const res = await handleRequest(getRequest('/api/watchlist/unsub/deadbeefdeadbeefdeadbeef'), env);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://francepassoire.com/proteger/?veille=desinscrit');
  });

  it('prefs → email masqué + préférences + statut de confirmation ; jeton inconnu → 404', async () => {
    const { env, raw } = makeEnv(envComplet);
    await handleRequest(subscribeRequest(validSubscribe), env, { fetchFn: makeFetch() });
    const { unsub_token } = raw.prepare('SELECT unsub_token FROM subscribers').get() as { unsub_token: string };

    const res = await handleRequest(getRequest(`/api/watchlist/prefs?token=${unsub_token}`), env);
    const payload = (await res.json()) as { ok: boolean; email: string; confirmed: boolean; prefs: { sectors: string[] } };

    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.email).toBe('j***@example.com');
    expect(payload.confirmed).toBe(false);
    expect(payload.prefs.sectors).toEqual(['sante']);

    const resInconnu = await handleRequest(getRequest('/api/watchlist/prefs?token=tokinconnu1234567890'), env);
    expect(resInconnu.status).toBe(404);
  });

  it('status : email_enabled=false sans les 4 secrets, true avec', async () => {
    const { env: envVide } = makeEnv();
    const resVide = await handleRequest(getRequest('/api/watchlist/status'), envVide);
    expect(((await resVide.json()) as { email_enabled: boolean }).email_enabled).toBe(false);

    const { env: envPlein } = makeEnv(envComplet);
    const resPlein = await handleRequest(getRequest('/api/watchlist/status'), envPlein);
    expect(((await resPlein.json()) as { email_enabled: boolean }).email_enabled).toBe(true);
  });

  it('chiffrement AES : roundtrip décrypt(encrypt(x)) == x, texte clair absent du chiffré', async () => {
    const enc = await encryptEmailAes('marie.curie@example.fr', AES_KEY);
    expect(enc).not.toContain('marie');
    expect(await decryptEmailAes(enc, AES_KEY)).toBe('marie.curie@example.fr');

    const [iv, ct] = enc.split('.');
    expect(iv).toBeDefined();
    expect(ct).toBeDefined();
    // IV aléatoire : deux chiffrés du même email diffèrent
    const enc2 = await encryptEmailAes('marie.curie@example.fr', AES_KEY);
    expect(enc2).not.toBe(enc);
  });
});

// ---------------------------------------------------------------------------
// T31 — digest hebdo + alertes instantanées
// ---------------------------------------------------------------------------

const noSleep = async (): Promise<void> => {};

async function digestEnv(subscribers: SubscriberFixture[]) {
  const { env, raw } = makeEnv(envComplet);
  for (const s of subscribers) await insertSubscriber(raw, s);
  return { env, raw };
}

describe('runWeeklyDigest — cron lundi 09:00 Paris', () => {
  it('envoie uniquement aux abonnés CONFIRMÉS dont les préférences matchent (les non-confirmés n’existent même pas dans la requête)', async () => {
    const { env, raw } = await digestEnv([
      { id: 's1', email: 'abonne-sante@example.com', prefs: { sectors: ['sante'], data_types: [], entities: [], freq: 'hebdo' }, confirmed: true },
      { id: 's2', email: 'abonne-media@example.com', prefs: { sectors: ['media'], data_types: [], entities: [], freq: 'hebdo' }, confirmed: true },
      { id: 's3', email: 'non-confirmee@example.com', prefs: { sectors: ['sante'], data_types: [], entities: [], freq: 'hebdo' }, confirmed: false },
      { id: 's4', email: 'abonne-tout@example.com', prefs: { sectors: [], data_types: [], entities: [], freq: 'quotidien' }, confirmed: true },
    ]);
    const brevoCalls: BrevoCall[] = [];
    const sleeps: number[] = [];
    const log = vi.fn();

    const result = await runWeeklyDigest(env, {
      fetchFn: makeFetch({ brevoCalls, fiches: [ficheSante, ficheFinance, ficheVieille] }),
      sleep: async (ms) => { sleeps.push(ms); },
      now: NOW,
      log,
    });

    expect(result.sent).toBe(2); // s1 (sante) + s4 (tout) ; s2 sans match, s3 non confirmée
    const destinataires = brevoCalls.map((c) => c.body.to[0]!.email);
    expect(destinataires).toEqual(['abonne-sante@example.com', 'abonne-tout@example.com']);
    expect(destinataires).not.toContain('non-confirmee@example.com');
    // la requête ne sélectionne que les confirmés : 3 confirmés (s1, s2, s4),
    // mais s2 sans match ne reçoit rien et s3 (non confirmée) n'existe pas
    // pour le digest — seuls 2 envois partent.
    const confirmes = raw.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE confirmed_at IS NOT NULL').get() as { n: number };
    expect(confirmes.n).toBe(3);
    // pause de courtoisie Brevo (~5 req/s) entre chaque envoi
    expect(sleeps.every((ms) => ms === 250)).toBe(true);
    expect(sleeps.length).toBe(2);
    expect(log).toHaveBeenCalled();
  });

  it('chaque email rendu porte le lien de désinscription 1 clic (HTML + texte)', async () => {
    const { env, raw } = await digestEnv([
      { id: 's1', email: 'abonne-sante@example.com', prefs: { sectors: ['sante'], data_types: [], entities: [], freq: 'hebdo' }, confirmed: true },
    ]);
    await insertSubscriber(raw, { id: 's4', email: 'abonne-tout@example.com', prefs: {}, confirmed: true });
    const brevoCalls: BrevoCall[] = [];

    await runWeeklyDigest(env, {
      fetchFn: makeFetch({ brevoCalls, fiches: [ficheSante, ficheFinance] }),
      sleep: noSleep,
      now: NOW,
    });

    expect(brevoCalls).toHaveLength(2);
    for (const call of brevoCalls) {
      expect(call.body.textContent).toMatch(/https:\/\/francepassoire\.com\/api\/watchlist\/unsub\/[A-Za-z0-9_-]+/);
      expect(call.body.htmlContent).toMatch(/Se désinscrire en un clic/);
      expect(call.body.htmlContent).toMatch(/https:\/\/francepassoire\.com\/api\/watchlist\/unsub\//);
    }
  });

  it('le gabarit rend les fiches de la semaine (entité, volume, lien) et ignore les fiches hors fenêtre', async () => {
    const { env } = await digestEnv([
      { id: 's4', email: 'abonne-tout@example.com', prefs: { sectors: [], data_types: [], entities: [], freq: 'hebdo' }, confirmed: true },
    ]);
    const brevoCalls: BrevoCall[] = [];

    await runWeeklyDigest(env, {
      fetchFn: makeFetch({ brevoCalls, fiches: [ficheSante, ficheFinance, ficheVieille] }),
      sleep: noSleep,
      now: NOW,
    });

    expect(brevoCalls).toHaveLength(1);
    const body = brevoCalls[0]!.body;
    expect(body.subject).toMatch(/veille FrancePassoire/);
    const html = body.htmlContent ?? '';
    expect(html).toContain('Alaxione');
    expect(html).toContain('330 000 personnes');
    expect(html).toContain('https://francepassoire.com/fiche/alaxione-20260818/');
    expect(html).toContain('Cabinet X');
    expect(html).not.toContain('vieille-20250101'); // hors fenêtre 7 jours
    expect(body.textContent).toContain('Alaxione');
  });

  it('abonné confirmé sans aucun match → aucun email, aucun crash', async () => {
    const { env } = await digestEnv([
      { id: 's2', email: 'abonne-media@example.com', prefs: { sectors: ['media'], data_types: [], entities: [], freq: 'hebdo' }, confirmed: true },
    ]);
    const brevoCalls: BrevoCall[] = [];

    const result = await runWeeklyDigest(env, {
      fetchFn: makeFetch({ brevoCalls, fiches: [ficheSante] }),
      sleep: noSleep,
      now: NOW,
    });

    expect(result).toEqual({ sent: 0, skipped: 1 });
    expect(brevoCalls).toHaveLength(0);
  });

  it('Brevo 429 → saut + log, pas de crash, le cron suivant réessaiera', async () => {
    const { env } = await digestEnv([
      { id: 's1', email: 'abonne-sante@example.com', prefs: { sectors: ['sante'], data_types: [], entities: [], freq: 'hebdo' }, confirmed: true },
    ]);
    const brevoCalls: BrevoCall[] = [];
    const log = vi.fn();

    const result = await runWeeklyDigest(env, {
      fetchFn: makeFetch({ brevoCalls, brevoStatus: 429, fiches: [ficheSante] }),
      sleep: noSleep,
      now: NOW,
      log,
    });

    expect(result).toEqual({ sent: 0, skipped: 1 });
    expect(brevoCalls).toHaveLength(1); // tenté puis refusé
    expect(log).toHaveBeenCalledWith('digest: envoi Brevo refusé (HTTP', 429, ') pour', 's1', '— saut');
  });

  it('BREVO_API_KEY absent → sortie propre (log, aucun fetch, aucun envoi)', async () => {
    const { env, raw } = makeEnv({ turnstileSecret: 's', aesKey: AES_KEY, hashKey: HASH_KEY });
    await insertSubscriber(raw, { id: 's1', email: 'abonne@example.com', prefs: {}, confirmed: true });
    const fetchFn = vi.fn(makeFetch());
    const log = vi.fn();

    const result = await runWeeklyDigest(env, { fetchFn, sleep: noSleep, now: NOW, log });

    expect(result).toEqual({ sent: 0, skipped: 0, reason: 'brevo-absent' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('BREVO_API_KEY absent'));
  });

  it('fiches.json indisponible (HTTP 500) → sortie propre, aucun envoi', async () => {
    const { env } = await digestEnv([
      { id: 's1', email: 'abonne@example.com', prefs: {}, confirmed: true },
    ]);
    const brevoCalls: BrevoCall[] = [];
    const log = vi.fn();

    const result = await runWeeklyDigest(env, {
      fetchFn: makeFetch({ brevoCalls, fichesStatus: 500 }),
      sleep: noSleep,
      now: NOW,
      log,
    });

    expect(result.reason).toBe('fiches-indisponibles');
    expect(brevoCalls).toHaveLength(0);
    expect(log).toHaveBeenCalledWith('digest: fiches.json indisponible —', expect.anything());
  });

  it('aucune fiche publiée dans les 7 jours → aucun envoi (raison semaine-vide)', async () => {
    const { env } = await digestEnv([
      { id: 's1', email: 'abonne@example.com', prefs: {}, confirmed: true },
    ]);
    const brevoCalls: BrevoCall[] = [];

    const result = await runWeeklyDigest(env, {
      fetchFn: makeFetch({ brevoCalls, fiches: [ficheVieille] }),
      sleep: noSleep,
      now: NOW,
    });

    expect(result.reason).toBe('semaine-vide');
    expect(brevoCalls).toHaveLength(0);
  });
});

describe('enqueueInstantAlert — contrat testé (câblage CI en T47)', () => {
  it('n’alerte que les abonnés CONFIRMÉS de fréquence quotidienne qui matchent, avec lien de désinscription', async () => {
    const { env } = await digestEnv([
      { id: 's1', email: 'hebdo-sante@example.com', prefs: { sectors: ['sante'], data_types: [], entities: [], freq: 'hebdo' }, confirmed: true },
      { id: 's4', email: 'quotidien-tout@example.com', prefs: { sectors: [], data_types: [], entities: [], freq: 'quotidien' }, confirmed: true },
      { id: 's3', email: 'quotidien-nonconfirmee@example.com', prefs: { sectors: [], data_types: [], entities: [], freq: 'quotidien' }, confirmed: false },
    ]);
    const brevoCalls: BrevoCall[] = [];

    const result = await enqueueInstantAlert(ficheSante, env, {
      fetchFn: makeFetch({ brevoCalls }),
      sleep: noSleep,
    });

    expect(result).toEqual({ matched: 1, sent: 1 });
    expect(brevoCalls).toHaveLength(1);
    expect(brevoCalls[0]!.body.to[0]!.email).toBe('quotidien-tout@example.com');
    expect(brevoCalls[0]!.body.subject).toContain('Alaxione');
    expect(brevoCalls[0]!.body.htmlContent).toMatch(/api\/watchlist\/unsub\//);
  });

  it('correspondance d’entité : « Alaxione SAS » (préférence) matche « Alaxione » (fiche) via la normalisation locale', async () => {
    const { env } = await digestEnv([
      { id: 'se', email: 'veille-alaxione@example.com', prefs: { sectors: [], data_types: [], entities: ['Alaxione SAS'], freq: 'quotidien' }, confirmed: true },
    ]);
    const brevoCalls: BrevoCall[] = [];

    const result = await enqueueInstantAlert(ficheSante, env, {
      fetchFn: makeFetch({ brevoCalls }),
      sleep: noSleep,
    });

    expect(result).toEqual({ matched: 1, sent: 1 });
    expect(brevoCalls[0]!.body.to[0]!.email).toBe('veille-alaxione@example.com');
  });

  it('secrets absents → sortie propre sans aucun envoi', async () => {
    const { env, raw } = makeEnv({ turnstileSecret: 's' });
    await insertSubscriber(raw, { id: 's4', email: 'quotidien@example.com', prefs: { freq: 'quotidien' }, confirmed: true });
    const fetchFn = vi.fn(makeFetch());

    const result = await enqueueInstantAlert(ficheSante, env, { fetchFn, sleep: noSleep });

    expect(result).toEqual({ matched: 0, sent: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
