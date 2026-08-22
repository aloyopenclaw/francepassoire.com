import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Worker API /api/report (T33, Wave 4) : fakes D1/KV en mémoire + fetch
// siteverify mocké — aucune dépendance runtime Cloudflare.
import {
  handleRequest,
  type D1Database,
  type D1PreparedStatement,
  type Env,
  type KVNamespace,
} from '../workers/api/src/index';

interface ExecutedStatement {
  sql: string;
  params: unknown[];
}

/** KV fake avec TTL : une entrée expirée se lit comme absente (fenêtre glissante simulable). */
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

function makeEnv(overrides?: { turnstileSecret?: string }): {
  env: Env;
  executed: ExecutedStatement[];
  kv: FakeKV;
} {
  const executed: ExecutedStatement[] = [];
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
  const kv = new FakeKV();
  const env: Env = { DB: db, RATE_LIMIT: kv, TURNSTILE_SECRET: overrides?.turnstileSecret };
  return { env, executed, kv };
}

const siteverifyOk = async (): Promise<Response> =>
  new Response(JSON.stringify({ success: true }), { status: 200 });

const validBody = {
  entity: 'Clinique Exemple',
  date: '2026-08-01',
  details: 'Base de rendez-vous exposée, ~30 000 lignes vues sur un forum public.',
  source_url: 'https://forum-exemple.fr/thread/42',
  contact_email: 'jeanne@example.com',
  turnstile_token: 'tok-valide',
  honeypot: '',
};

function reportRequest(body: unknown, ip = '203.0.113.7'): Request {
  return new Request('https://api.francepassoire.com/api/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-20T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/report — cas nominaux', () => {
  it('insère un candidat source signalement / status NEW et répond 201', async () => {
    const { env, executed } = makeEnv({ turnstileSecret: 'secret-test' });

    const res = await handleRequest(reportRequest(validBody), env, { fetchFn: siteverifyOk });
    const payload = (await res.json()) as { ok: boolean; message: string };

    expect(res.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.message).toMatch(/merci/i);
    expect(executed).toHaveLength(1);
    const stmt = executed[0]!;
    expect(stmt.sql).toMatch(/^INSERT INTO candidates/);
    expect(stmt.params[0]).toMatch(/^[0-9a-f-]{36}$/); // UUID
    expect(stmt.params[1]).toBe('signalement');
    expect(stmt.params[2]).toBe(validBody.source_url);
    expect(stmt.params[4]).toBe('Clinique Exemple'); // entity_name
    expect(stmt.params[5]).toBeNull(); // dedup_score
    expect(stmt.params[6]).toBe('NEW');
    const raw = JSON.parse(stmt.params[3] as string) as Record<string, unknown>;
    expect(raw.entity).toBe('Clinique Exemple');
    expect(raw.details).toBe(validBody.details);
  });

  it('siteverify reçoit secret + token + remoteip', async () => {
    const { env } = makeEnv({ turnstileSecret: 'secret-test' });
    const calls: Array<Record<string, string>> = [];
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      const form = new URLSearchParams(init?.body as string);
      const record: Record<string, string> = {};
      for (const [k, v] of form.entries()) record[k] = v;
      calls.push(record);
      return siteverifyOk();
    }) as typeof fetch;

    await handleRequest(reportRequest(validBody), env, { fetchFn });

    expect(calls).toEqual([
      {
        secret: 'secret-test',
        response: 'tok-valide',
        remoteip: '203.0.113.7',
      },
    ]);
  });

  it('honeypot rempli → 201 factice, aucune ligne D1, aucun compteur', async () => {
    const { env, executed, kv } = makeEnv({ turnstileSecret: 'secret-test' });

    const res = await handleRequest(
      reportRequest({ ...validBody, honeypot: 'http://spam.example' }),
      env,
      { fetchFn: siteverifyOk },
    );
    const payload = (await res.json()) as { ok: boolean };

    expect(res.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(executed).toHaveLength(0);
    expect(kv.store.size).toBe(0);
  });
});

describe('POST /api/report — fail closed Turnstile', () => {
  it('token invalide → 403, aucune ligne, quota non consommé', async () => {
    const { env, executed, kv } = makeEnv({ turnstileSecret: 'secret-test' });
    const siteverifyKo = async (): Promise<Response> =>
      new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), {
        status: 200,
      });

    const res = await handleRequest(reportRequest(validBody), env, { fetchFn: siteverifyKo });
    const payload = (await res.json()) as { ok: boolean; error: string };

    expect(res.status).toBe(403);
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/vérification/i);
    expect(executed).toHaveLength(0);
    expect(kv.store.size).toBe(0);
  });

  it('siteverify en erreur 500 → 403 (fail closed), aucune ligne', async () => {
    const { env, executed } = makeEnv({ turnstileSecret: 'secret-test' });
    const siteverifyDown = async (): Promise<Response> => new Response('boom', { status: 500 });

    const res = await handleRequest(reportRequest(validBody), env, { fetchFn: siteverifyDown });

    expect(res.status).toBe(403);
    expect(executed).toHaveLength(0);
  });

  it('token absent → 400 (validation), pas d’appel siteverify', async () => {
    const { env } = makeEnv({ turnstileSecret: 'secret-test' });
    const fetchFn = vi.fn(siteverifyOk);
    const { turnstile_token: _tokenOmis, ...body } = validBody;

    const res = await handleRequest(reportRequest(body), env, { fetchFn });

    expect(res.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('TURNSTILE_SECRET absent → 503 « protection anti-abus non configurée »', async () => {
    const { env, executed } = makeEnv({ turnstileSecret: undefined });

    const res = await handleRequest(reportRequest(validBody), env, { fetchFn: siteverifyOk });
    const payload = (await res.json()) as { ok: boolean; error: string };

    expect(res.status).toBe(503);
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/non configurée/);
    expect(executed).toHaveLength(0);
  });
});

describe('POST /api/report — rate limit 5/IP/h', () => {
  it('6e signalement de la même IP dans l’heure → 429, pas de 6e ligne', async () => {
    const { env, executed } = makeEnv({ turnstileSecret: 'secret-test' });

    for (let i = 1; i <= 5; i++) {
      const res = await handleRequest(reportRequest(validBody), env, { fetchFn: siteverifyOk });
      expect(res.status).toBe(201);
    }

    const res6 = await handleRequest(reportRequest(validBody), env, { fetchFn: siteverifyOk });
    const payload = (await res6.json()) as { ok: boolean; error: string };

    expect(res6.status).toBe(429);
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/trop de signalements/i);
    expect(executed).toHaveLength(5);
  });

  it('une autre IP n’est pas pénalisée (clé par IP)', async () => {
    const { env, executed } = makeEnv({ turnstileSecret: 'secret-test' });

    for (let i = 1; i <= 5; i++) {
      await handleRequest(reportRequest(validBody, '198.51.100.1'), env, { fetchFn: siteverifyOk });
    }
    const resAutreIp = await handleRequest(
      reportRequest(validBody, '198.51.100.2'),
      env,
      { fetchFn: siteverifyOk },
    );

    expect(resAutreIp.status).toBe(201);
    expect(executed).toHaveLength(6);
  });

  it('le compteur retombe à zéro après expiration du TTL (fenêtre 1 h)', async () => {
    const { env, executed, kv } = makeEnv({ turnstileSecret: 'secret-test' });

    for (let i = 1; i <= 5; i++) {
      await handleRequest(reportRequest(validBody), env, { fetchFn: siteverifyOk });
    }
    const resBloque = await handleRequest(reportRequest(validBody), env, { fetchFn: siteverifyOk });
    expect(resBloque.status).toBe(429);

    // La clé TTL 3600 s a été posée au 1er hit : +1 h +1 s → tout est expiré.
    vi.setSystemTime(new Date('2026-08-20T13:00:01Z'));
    expect(await kv.get('rl:report:203.0.113.7')).toBeNull();

    const resApresTtl = await handleRequest(reportRequest(validBody), env, { fetchFn: siteverifyOk });
    expect(resApresTtl.status).toBe(201);
    expect(executed).toHaveLength(6);
  });
});

describe('POST /api/report — validation FR', () => {
  it('corps JSON malformé → 400 avec message français', async () => {
    const { env } = makeEnv({ turnstileSecret: 'secret-test' });

    const res = await handleRequest(reportRequest('{pas du json'), env, { fetchFn: siteverifyOk });
    const payload = (await res.json()) as { ok: boolean; error: string };

    expect(res.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/invalide|json/i);
  });

  it('entité manquante → 400, erreur FR sur l’entité, aucune ligne', async () => {
    const { env, executed } = makeEnv({ turnstileSecret: 'secret-test' });
    const body = { ...validBody, entity: '' };

    const res = await handleRequest(reportRequest(body), env, { fetchFn: siteverifyOk });
    const payload = (await res.json()) as { ok: boolean; errors: string[] };

    expect(res.status).toBe(400);
    expect(payload.errors.some((e) => /entité/i.test(e))).toBe(true);
    expect(executed).toHaveLength(0);
  });

  it('URL source invalide → 400 avec erreur FR', async () => {
    const { env } = makeEnv({ turnstileSecret: 'secret-test' });
    const body = { ...validBody, source_url: 'javascript:alert(1)' };

    const res = await handleRequest(reportRequest(body), env, { fetchFn: siteverifyOk });
    const payload = (await res.json()) as { errors: string[] };

    expect(res.status).toBe(400);
    expect(payload.errors.some((e) => /url/i.test(e))).toBe(true);
  });

  it('email de contact malformé → 400 avec erreur FR', async () => {
    const { env } = makeEnv({ turnstileSecret: 'secret-test' });
    const body = { ...validBody, contact_email: 'pas-un-email' };

    const res = await handleRequest(reportRequest(body), env, { fetchFn: siteverifyOk });

    expect(res.status).toBe(400);
  });

  it('date au mauvais format → 400 (format YYYY-MM-DD attendu)', async () => {
    const { env } = makeEnv({ turnstileSecret: 'secret-test' });
    const body = { ...validBody, date: 'hier' };

    const res = await handleRequest(reportRequest(body), env, { fetchFn: siteverifyOk });

    expect(res.status).toBe(400);
  });
});

describe('routage worker API', () => {
  it('GET /api/health → 200 {ok:true}', async () => {
    const { env } = makeEnv();

    const res = await handleRequest(
      new Request('https://api.francepassoire.com/api/health'),
      env,
    );
    const payload = (await res.json()) as { ok: boolean };

    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
  });

  it('route inconnue → 404, sans toucher D1', async () => {
    const { env, executed } = makeEnv();

    const res = await handleRequest(
      new Request('https://api.francepassoire.com/api/autre-chose'),
      env,
    );

    expect(res.status).toBe(404);
    expect(executed).toHaveLength(0);
  });

  it('OPTIONS /api/report (préflight CORS) → 204 avec méthodes autorisées', async () => {
    const { env } = makeEnv();

    const res = await handleRequest(
      new Request('https://api.francepassoire.com/api/report', {
        method: 'OPTIONS',
        headers: { Origin: 'https://francepassoire.com' },
      }),
      env,
    );

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://francepassoire.com');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});

// F2 (22/08) — une URL qui passe la regex mais que le constructeur URL rejette
// (port invalide) doit donner un 400 propre, pas une 500 non gérée.
describe('POST /api/report — URL à port invalide', () => {
  it('http://a.b:8080z/ → 400 (et non 500)', async () => {
    const { env } = makeEnv({ turnstileSecret: 'secret-test' });
    const reponse = await handleRequest(
      new Request('https://francepassoire.com/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entite: 'Entité Test',
          details: 'Des détails suffisamment longs pour passer la validation.',
          source_url: 'http://a.b:8080z/article',
          date_incident: '2026-08-01',
          turnstileToken: 'tok',
        }),
      }),
      env,
      { fetchFn: siteverifyOk },
    );
    expect(reponse.status).toBe(400);
    const corps = (await reponse.json()) as { errors?: string[] };
    expect(corps.errors?.join(' ')).toContain('URL http(s) valide');
  });
});
