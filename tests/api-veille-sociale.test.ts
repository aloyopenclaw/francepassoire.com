// T52 — veille sociale interne : normalisation, dédup, plafond, sources
// mortes, heartbeat calme, slots Paris (DST). Aucun réseau réel (fetch
// injecté rejouant des fixtures RSS/JSON).

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, Env } from '../workers/api/src/index';
import { runVeilleSociale, slotVeilleSociale, VEILLE_CAP, __test } from '../workers/api/src/veille-sociale';

const SCHEMA = readFileSync(fileURLToPath(new URL('../migrations/0002_veille_seen.sql', import.meta.url)), 'utf8')
  + readFileSync(fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url)), 'utf8');

function makeEnv(): { env: Env; raw: DatabaseSync } {
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
  const env = { DB: d1, BREVO_API_KEY: 'xkeysib-test', RUN_STATE: undefined } as unknown as Env;
  return { env, raw };
}

interface BrevoCall { subject: string; html: string; text: string }

/** fetch injecté : Google News/Reddit RSS, Bluesky/Mastodon JSON, fiches.json, Brevo. */
function makeFetch(opts: {
  news?: string[]; bluesky?: string[]; reddit?: string[]; mastodon?: string[];
  brevo: BrevoCall[]; mortes?: Array<'news' | 'bluesky' | 'reddit' | 'mastodon'>;
}) {
  const rss = (titres: string[]) =>
    `<rss><channel>${titres
      .map((t, i) => `<item><title>${t}</title><link>https://exemple.fr/a${i}</link><pubDate>Sat, 22 Aug 2026 08:00:00 GMT</pubDate><source>Presse</source></item>`)
      .join('')}</channel></rss>`;
  const bsky = (textes: string[]) => ({
    posts: textes.map((t, i) => ({
      author: { handle: `user${i}.bsky.social` },
      record: { text: t, createdAt: '2026-08-22T08:00:00Z' },
      uri: `at://did/x/post${i}`,
    })),
  });
  const masto = (textes: string[]) => ({
    statuses: textes.map((t, i) => ({
      account: { acct: `compte${i}@mastodon.social` },
      content: `<p>${t}</p>`,
      url: `https://mastodon.social/compte${i}/status${i}`,
      created_at: '2026-08-22T08:00:00Z',
    })),
  });
  const mortes = new Set(opts.mortes ?? []);
  return vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u);
    if (url.includes('api.brevo.com')) {
      opts.brevo.push({ subject: '', html: String(init?.body ?? ''), text: '' });
      const b = JSON.parse(String(init?.body ?? '{}'));
      opts.brevo[opts.brevo.length - 1] = { subject: b.subject, html: b.htmlContent, text: b.textContent };
      return new Response('{"message":"ok"}', { status: 200 });
    }
    if (url.includes('fiches.json')) {
      return new Response(JSON.stringify({ fiches: [{ entity: 'Alaxione' }, { entity: 'Carrefour' }] }), { status: 200 });
    }
    if (url.includes('news.google.com')) {
      if (mortes.has('news')) return new Response('err', { status: 500 });
      return new Response(rss(opts.news ?? []), { status: 200 });
    }
    if (url.includes('bsky.app')) {
      if (mortes.has('bluesky')) return new Response('err', { status: 500 });
      return new Response(JSON.stringify(bsky(opts.bluesky ?? [])), { status: 200 });
    }
    if (url.includes('reddit.com')) {
      if (mortes.has('reddit')) return new Response('err', { status: 500 });
      const entries = (opts.reddit ?? [])
        .map((t, i) => `<entry><title>${t}</title><link href="https://reddit.com/r/fr/r${i}"/><author>u${i}</author></entry>`)
        .join('');
      return new Response(`<feed>${entries}</feed>`, { status: 200 });
    }
    if (url.includes('mastodon.social')) {
      if (mortes.has('mastodon')) return new Response('unauthorized', { status: 401 });
      return new Response(JSON.stringify(masto(opts.mastodon ?? [])), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('slotVeilleSociale — 07:00 et 19:00 Paris, DST-proof', () => {
  it('été : 05:00 et 17:00 UTC → slots ; hiver : 06:00 et 18:00 UTC → slots', () => {
    expect(slotVeilleSociale(new Date('2026-08-22T05:00:00Z'))).toBe('matin');
    expect(slotVeilleSociale(new Date('2026-08-22T17:00:00Z'))).toBe('soir');
    expect(slotVeilleSociale(new Date('2026-12-22T06:00:00Z'))).toBe('matin');
    expect(slotVeilleSociale(new Date('2026-12-22T18:00:00Z'))).toBe('soir');
  });

  it('tick non-plein-heure ou autre heure → null', () => {
    expect(slotVeilleSociale(new Date('2026-08-22T05:15:00Z'))).toBeNull();
    expect(slotVeilleSociale(new Date('2026-08-22T04:00:00Z'))).toBeNull();
    expect(slotVeilleSociale(new Date('2026-08-22T08:00:00Z'))).toBeNull();
  });
});

describe('runVeilleSociale — pipeline', () => {
  it('doublon d\'URL inséré deux fois (news + bluesky même titre) → une seule opportunité', async () => {
    const { env } = makeEnv();
    const brevo: BrevoCall[] = [];
    const fetchFn = makeFetch({
      news: ['FrancePassoire cité par La Presse', 'Autre fuite de données chez Alaxione'],
      bluesky: ['FrancePassoire cité par La Presse'],
      brevo,
    });

    const r = await runVeilleSociale(env, 'matin', { fetchFn, now: new Date('2026-08-22T05:00:00Z'), log: () => {} });

    expect(r.opportunities).toBe(2);
    expect(brevo).toHaveLength(1);
    expect(brevo[0]!.subject).toContain('2 opportunité(s)');
    expect(brevo[0]!.html).toContain('VEILLE SOCIALE');
    expect(brevo[0]!.html).toContain('MATIN');
  });

  it('mention FrancePassoire > entité catalogue > générique (classement)', async () => {
    const { env } = makeEnv();
    const brevo: BrevoCall[] = [];
    const fetchFn = makeFetch({
      news: ['Une fuite de données quelconque chez X', 'Mention de FrancePassoire dans un article'],
      reddit: ['Cyberattaque chez Carrefour'],
      brevo,
    });

    await runVeilleSociale(env, 'soir', { fetchFn, now: new Date('2026-08-22T17:00:00Z'), log: () => {} });

    const html = brevo[0]!.html;
    const iMention = html.indexOf('Mention de FrancePassoire');
    const iCarrefour = html.indexOf('Cyberattaque chez Carrefour');
    const iGenerique = html.indexOf('fuite de données quelconque');
    expect(iMention).toBeGreaterThan(-1);
    expect(iMention).toBeLessThan(iCarrefour);
    expect(iCarrefour).toBeLessThan(iGenerique);
  });

  it('20 opportunités → plafond 15 (VEILLE_CAP)', async () => {
    const { env } = makeEnv();
    const brevo: BrevoCall[] = [];
    const fetchFn = makeFetch({
      news: Array.from({ length: 20 }, (_, i) => `Fuite de données n°${i}`),
      brevo,
    });

    const r = await runVeilleSociale(env, 'matin', { fetchFn, now: new Date('2026-08-22T05:00:00Z'), log: () => {} });

    expect(VEILLE_CAP).toBe(15);
    expect(r.opportunities).toBe(15);
    expect(brevo[0]!.subject).toContain('15 opportunité(s)');
  });

  it('déjà vues au run précédent (veille_seen) → plus rien, heartbeat calme', async () => {
    const { env } = makeEnv();
    const brevo: BrevoCall[] = [];
    const fetchFn = makeFetch({ news: ['FrancePassoire cité partout'], brevo });

    await runVeilleSociale(env, 'matin', { fetchFn, now: new Date('2026-08-22T05:00:00Z'), log: () => {} });
    expect(r1(brevo)).toContain('1 opportunité');

    const r2 = await runVeilleSociale(env, 'soir', { fetchFn, now: new Date('2026-08-22T17:00:00Z'), log: () => {} });
    expect(r2.opportunities).toBe(0);
    expect(r2.envoye).toBe(true);
    expect(brevo[1]!.subject).toContain('la passoire est calme');
    expect(brevo[1]!.html).toContain('LA PASSOIRE EST CALME');
  });

  it('une source en 500 → digest envoyé quand même + avertissement sources indisponibles', async () => {
    const { env } = makeEnv();
    const brevo: BrevoCall[] = [];
    const fetchFn = makeFetch({ news: ['FrancePassoire cité'], mastodon: [], mortes: ['bluesky', 'reddit'], brevo });

    const r = await runVeilleSociale(env, 'matin', { fetchFn, now: new Date('2026-08-22T05:00:00Z'), log: () => {} });

    expect(r.envoye).toBe(true);
    expect(r.sourcesMortes).toContain('Bluesky');
    expect(r.sourcesMortes).toContain('Reddit');
    expect(brevo[0]!.html).toContain('Sources indisponibles');
  });

  it('aucune source ne parle de rien → heartbeat calme envoyé (choix propriétaire)', async () => {
    const { env } = makeEnv();
    const brevo: BrevoCall[] = [];
    const fetchFn = makeFetch({ brevo });

    const r = await runVeilleSociale(env, 'matin', { fetchFn, now: new Date('2026-08-22T05:00:00Z'), log: () => {} });

    expect(r.opportunities).toBe(0);
    expect(r.envoye).toBe(true);
    expect(brevo[0]!.text).toContain('la passoire est calme');
  });

  it('gabarit : aucun em-dash dans les rendus', async () => {
    const { env } = makeEnv();
    const brevo: BrevoCall[] = [];
    const fetchFn = makeFetch({ news: ['FrancePassoire : fuite de données révélée'], brevo });

    await runVeilleSociale(env, 'matin', { fetchFn, now: new Date('2026-08-22T05:00:00Z'), log: () => {} });

    expect(brevo[0]!.html).not.toContain('—');
  });
});

function r1(brevo: BrevoCall[]): string {
  return brevo[0]?.subject ?? '';
}

describe('__test — primitives', () => {
  it('normaliserTitre : ponctuation et casse neutralisées', () => {
    expect(__test.normaliserTitre('Fuite chez X! (important)')).toBe(__test.normaliserTitre('FUITE CHEZ X important'));
  });

  it('scoreOccurrence : FrancePassoire exact domine', () => {
    const cat = new Set(['Alaxione']);
    expect(__test.scoreOccurrence({ plateforme: 'Reddit', auteur: '', texte: 'FrancePassoire top', url: 'u', publie: '' }, cat)).toBeGreaterThan(
      __test.scoreOccurrence({ plateforme: 'Reddit', auteur: '', texte: 'fuite de données lambda', url: 'u', publie: '' }, cat),
    );
  });

  it('varianteReponse : mention + question → V2', () => {
    expect(
      __test.varianteReponse({ plateforme: 'Bluesky', auteur: '', texte: 'Comment fonctionne FrancePassoire ?', url: 'u', publie: '' }, new Set()),
    ).toBe('V2-reponse-technique');
  });
});
