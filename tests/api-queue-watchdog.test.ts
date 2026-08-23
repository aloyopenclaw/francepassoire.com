// Chien de garde de la file éditoriale : seuil 24 h, garde KV une fois par
// jour, double canal Brevo + Pushinator (contrat v2 de notify.yml), mode
// détection seule sans secrets. Aucun réseau réel (fetch injecté capturant
// Brevo/Pushinator, D1 en node:sqlite en mémoire, horloge injectée).

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, Env, KVNamespace } from '../workers/api/src/index';
import {
  SEUIL_FILE_MS,
  ageFileMs,
  cleGardeFile,
  envoyerPush,
  runQueueWatchdog,
  textesAlerte,
} from '../workers/api/src/queue-watchdog';

const SCHEMA = readFileSync(fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url)), 'utf8');

function makeEnv(secrets: Partial<Env> = {}): { env: Env; raw: DatabaseSync; store: Map<string, string> } {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  const d1: D1Database = {
    prepare(sql: string) {
      const stmt = raw.prepare(sql);
      let params: unknown[] = [];
      const wrapped: D1PreparedStatement = {
        bind(...v: unknown[]) { params = params.concat(v); return wrapped; },
        async run() { stmt.run(...(params as Parameters<typeof stmt.run>)); return { success: true }; },
        async first() { return (stmt.get(...(params as Parameters<typeof stmt.get>)) ?? null) as unknown; },
        async all() { return stmt.all(...(params as Parameters<typeof stmt.all>)) as unknown[]; },
      };
      return wrapped;
    },
  };
  const store = new Map<string, string>();
  const kv: KVNamespace = {
    async get(key) { return store.get(key) ?? null; },
    async put(key, value) { store.set(key, value); },
  };
  const env = { DB: d1, RUN_STATE: kv, BREVO_API_KEY: 'xkeysib-test', PUSHINATOR_TOKEN: 'tok-test', PUSHINATOR_CHANNEL: 'chn-test', ...secrets } as Env;
  return { env, raw, store };
}

interface BrevoAppel { sujet: string; texte: string; html: string }
interface PushAppel { url: string; auth: string; corps: string }

function makeFetch(opts: { brevo?: BrevoAppel[]; push?: PushAppel[]; pushStatus?: number } = {}) {
  return vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u);
    if (url.includes('api.brevo.com')) {
      const b = JSON.parse(String(init?.body ?? '{}')) as { subject: string; textContent: string; htmlContent?: string };
      opts.brevo?.push({ sujet: b.subject, texte: b.textContent, html: b.htmlContent ?? '' });
      return new Response('{"message":"ok"}', { status: 200 });
    }
    if (url.includes('pushinator.com')) {
      const auth = String((init?.headers as Record<string, string>)?.authorization ?? '');
      opts.push?.push({ url, auth, corps: String(init?.body ?? '') });
      return new Response('{}', { status: opts.pushStatus ?? 200 });
    }
    throw new Error(`URL inattendue sous test : ${url}`);
  }) as unknown as typeof fetch;
}

/** Insère un candidat ; createdAt au format SQLite datetime('now') : « AAAA-MM-JJ HH:MM:SS ». */
function semerCandidat(raw: DatabaseSync, status: string, createdAt: string): void {
  raw.prepare(
    "INSERT INTO candidates (id, source, source_url, raw, status, created_at) VALUES (?, 'test', 'https://exemple.fr', '{}', ?, ?)",
  ).run(crypto.randomUUID(), status, createdAt);
}

const MAINTENANT = new Date('2026-08-23T12:00:00.000Z'); // dimanche 14:00 Paris
const IL_Y_A_2H = '2026-08-23 10:00:00';
const IL_Y_A_26H = '2026-08-22 10:00:00';
const IL_Y_A_24H_PILE = '2026-08-22 12:00:00';

describe('ageFileMs / cleGardeFile — purs', () => {
  it('parse le format SQLite datetime(\'now\') comme UTC', () => {
    expect(ageFileMs('2026-08-22 12:00:00', new Date('2026-08-23T12:00:00Z'))).toBe(SEUIL_FILE_MS);
    expect(ageFileMs('2026-08-22T12:00:00Z', new Date('2026-08-23T12:00:00Z'))).toBe(SEUIL_FILE_MS);
  });

  it('null ou date illisible → 0 (jamais d\'alerte sur de l\'indéterminé)', () => {
    expect(ageFileMs(null, MAINTENANT)).toBe(0);
    expect(ageFileMs('nimporte quoi', MAINTENANT)).toBe(0);
  });

  it('clé de garde datée Europe/Paris (bascule de jour à minuit Paris, pas UTC)', () => {
    expect(cleGardeFile(new Date('2026-08-23T22:30:00Z'))).toBe('watchdog:queue-alerted:20260824'); // 00:30 Paris le 24
    expect(cleGardeFile(new Date('2026-08-23T21:30:00Z'))).toBe('watchdog:queue-alerted:20260823'); // 23:30 Paris le 23
  });
});

describe('runQueueWatchdog — seuil et charge utile', () => {
  it('NEW de 2 h → file saine : aucun envoi, aucune écriture KV', async () => {
    const { env, raw, store } = makeEnv();
    semerCandidat(raw, 'NEW', IL_Y_A_2H);
    const brevo: BrevoAppel[] = [];
    const push: PushAppel[] = [];
    const v = await runQueueWatchdog(env, { fetchFn: makeFetch({ brevo, push }), now: () => MAINTENANT, log: () => {} });
    expect(v.bloquee).toBe(false);
    expect(v.alerte).toBe(false);
    expect(brevo).toHaveLength(0);
    expect(push).toHaveLength(0);
    expect([...store.keys()]).toHaveLength(0);
  });

  it('NEW de 26 h → alerte : garde KV posée, email Brevo et push Pushinator avec compteurs et âge', async () => {
    const { env, raw, store } = makeEnv();
    semerCandidat(raw, 'NEW', IL_Y_A_26H);
    semerCandidat(raw, 'NEW', IL_Y_A_2H);
    semerCandidat(raw, 'DRAFT', IL_Y_A_2H);
    const brevo: BrevoAppel[] = [];
    const push: PushAppel[] = [];
    const v = await runQueueWatchdog(env, { fetchFn: makeFetch({ brevo, push }), now: () => MAINTENANT, log: () => {} });
    expect(v.bloquee).toBe(true);
    expect(v.alerte).toBe(true);
    expect(v.nbNew).toBe(2);
    expect(v.nbDraft).toBe(1);
    expect(v.ageH).toBeCloseTo(26, 0);
    expect(store.get('watchdog:queue-alerted:20260823')).toBeTruthy();
    expect(brevo).toHaveLength(1);
    expect(brevo[0]!.sujet).toContain('26 h');
    expect(brevo[0]!.texte).toContain('NEW en attente : 2');
    expect(brevo[0]!.texte).toContain('DRAFT en cours : 1');
    expect(brevo[0]!.texte).toContain(IL_Y_A_26H);
    expect(push).toHaveLength(1);
    expect(push[0]!.url).toBe('https://api.pushinator.com/api/v2/notifications/send');
    expect(push[0]!.auth).toBe('Bearer tok-test');
    expect(JSON.parse(push[0]!.corps)).toEqual({
      channel_id: 'chn-test',
      content: expect.stringContaining('file bloquée'),
    });
  });

  it('exactement 24 h pile → PAS bloquée (seuil strictement supérieur)', async () => {
    const { env, raw } = makeEnv();
    semerCandidat(raw, 'NEW', IL_Y_A_24H_PILE);
    const v = await runQueueWatchdog(env, { fetchFn: makeFetch(), now: () => MAINTENANT, log: () => {} });
    expect(v.bloquee).toBe(false);
    expect(v.alerte).toBe(false);
  });

  it('garde une fois par jour : second passage le même jour → aucun nouvel envoi', async () => {
    const { env, raw } = makeEnv();
    semerCandidat(raw, 'NEW', IL_Y_A_26H);
    const brevo: BrevoAppel[] = [];
    const push: PushAppel[] = [];
    const fetchFn = makeFetch({ brevo, push });
    await runQueueWatchdog(env, { fetchFn, now: () => MAINTENANT, log: () => {} });
    const v2 = await runQueueWatchdog(env, { fetchFn, now: () => new Date('2026-08-23T12:15:00Z'), log: () => {} });
    expect(v2.alerte).toBe(false);
    expect(v2.dejaAlerte).toBe(true);
    expect(brevo).toHaveLength(1);
    expect(push).toHaveLength(1);
  });

  it('le lendemain (nouvelle clé) → nouvelle alerte', async () => {
    const { env, raw } = makeEnv();
    semerCandidat(raw, 'NEW', IL_Y_A_26H);
    const brevo: BrevoAppel[] = [];
    const fetchFn = makeFetch({ brevo });
    await runQueueWatchdog(env, { fetchFn, now: () => MAINTENANT, log: () => {} });
    const v2 = await runQueueWatchdog(env, { fetchFn, now: () => new Date('2026-08-24T12:00:00Z'), log: () => {} });
    expect(v2.alerte).toBe(true);
    expect(brevo).toHaveLength(2);
  });

  it('aucun NEW → jamais bloquée, aucun envoi', async () => {
    const { env, raw } = makeEnv();
    semerCandidat(raw, 'DRAFT', IL_Y_A_26H);
    semerCandidat(raw, 'PUBLISHED', IL_Y_A_26H);
    const v = await runQueueWatchdog(env, { fetchFn: makeFetch(), now: () => MAINTENANT, log: () => {} });
    expect(v.bloquee).toBe(false);
    expect(v.nbNew).toBe(0);
    expect(v.plusAncienNew).toBeNull();
    expect(v.ageH).toBeNull();
  });

  it('aucun canal configuré → détection seule : log console.error, garde NON posée', async () => {
    const { env, raw, store } = makeEnv({ BREVO_API_KEY: undefined, PUSHINATOR_TOKEN: undefined });
    semerCandidat(raw, 'NEW', IL_Y_A_26H);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const v = await runQueueWatchdog(env, { fetchFn: makeFetch(), now: () => MAINTENANT, log: () => {} });
    expect(v.detectOnly).toBe(true);
    expect(v.alerte).toBe(false);
    expect([...store.keys()]).toHaveLength(0);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('DÉTECTION SEULE'));
    err.mockRestore();
  });

  it('échec push (HTTP 500) → email quand même remis, garde posée (pas de re-spam au tick suivant)', async () => {
    const { env, raw, store } = makeEnv();
    semerCandidat(raw, 'NEW', IL_Y_A_26H);
    const brevo: BrevoAppel[] = [];
    const push: PushAppel[] = [];
    const v = await runQueueWatchdog(env, {
      fetchFn: makeFetch({ brevo, push, pushStatus: 500 }),
      now: () => MAINTENANT,
      log: () => {},
    });
    expect(v.alerte).toBe(true);
    expect(v.emailOk).toBe(true);
    expect(v.pushOk).toBe(false);
    expect(store.get('watchdog:queue-alerted:20260823')).toBeTruthy();
  });

  it('bindings absents → sortie propre sans crash', async () => {
    const env = { DB: undefined, RUN_STATE: undefined } as unknown as Env;
    const v = await runQueueWatchdog(env, { fetchFn: makeFetch(), now: () => MAINTENANT, log: () => {} });
    expect(v.detectOnly).toBe(true);
    expect(v.bloquee).toBe(false);
  });
});

describe('envoyerPush / textesAlerte — contrat notify.yml', () => {
  it('envoyerPush : POST v2, Bearer, JSON {channel_id, content}, timeout sans throw', async () => {
    const appels: PushAppel[] = [];
    const fetchFn = makeFetch({ push: appels });
    const r = await envoyerPush('tok', 'chn', 'coucou', fetchFn);
    expect(r.ok).toBe(true);
    expect(appels[0]!.url).toBe('https://api.pushinator.com/api/v2/notifications/send');
    expect(appels[0]!.auth).toBe('Bearer tok');
    expect(JSON.parse(appels[0]!.corps)).toEqual({ channel_id: 'chn', content: 'coucou' });

    const mort = (async () => { throw new Error('réseau'); }) as unknown as typeof fetch;
    expect((await envoyerPush('tok', 'chn', 'x', mort)).ok).toBe(false);
  });

  it('textesAlerte : sujet, âge arrondi, compteurs, contexte Paris', () => {
    const t = textesAlerte({ nbNew: 7, nbDraft: 2, plusAncienNew: '2026-08-22 10:00:00' }, 26, MAINTENANT);
    expect(t.sujet).toContain('26 h');
    expect(t.texte).toContain('NEW en attente : 7');
    expect(t.texte).toContain('DRAFT en cours : 2');
    expect(t.push).toContain('7 NEW');
    expect(t.push).toContain('2 DRAFT');
  });
});
