// Rapport pipeline quotidien (10:00 Paris, garde KV rapport:jour:) +
// tripwire fiches.json (compteur quart d'heure, alerte une fois par jour).
// Mêmes approches que api-watchlist / api-queue-watchdog : D1 node:sqlite
// (schéma réel 0001_init.sql), KV fake avec list, fetch routé par URL
// (Brevo / fiches.json / GitHub Actions), horloge injectée. Aucun réseau réel.

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, Env, KVNamespace } from '../workers/api/src/index';
import {
  SEUIL_FICHES_MORTES,
  cleGardeFiches,
  cleGardeRapport,
  doitLancerRapport,
  gererFichesMortes,
  runRapportQuotidien,
  sujetRapport,
} from '../workers/api/src/rapport-quotidien';
import type { InstantSweepResultats } from '../workers/api/src/watchlist';

const SCHEMA = readFileSync(fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url)), 'utf8');

// Dimanche 23/08/2026 10:00:30 Paris (heure d'été, UTC+2) : week-end inclus.
const MAINTENANT = new Date('2026-08-23T08:00:30.000Z');

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

  async list(opts?: { prefix?: string }): Promise<{ keys: { name: string }[] }> {
    const prefix = opts?.prefix ?? '';
    const names = [...this.store.keys()].filter((k) => k.startsWith(prefix)).sort();
    return { keys: names.map((name) => ({ name })) };
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

function makeEnv(overrides: { brevo?: string } = {}): { env: Env; raw: DatabaseSync; kv: FakeKV } {
  const { d1, raw } = makeDb();
  const kv = new FakeKV();
  const env: Env = {
    DB: d1,
    RATE_LIMIT: kv,
    RUN_STATE: kv,
    BREVO_API_KEY: overrides.brevo,
  };
  return { env, raw, kv };
}

interface BrevoBody {
  to: { email: string }[];
  subject: string;
  textContent: string;
  htmlContent?: string;
}

interface BrevoCall {
  body: BrevoBody;
}

interface RunGithub {
  name: string;
  conclusion: string | null;
  created_at: string;
}

interface FetchOptions {
  brevoCalls?: BrevoCall[];
  brevoStatus?: number;
  fichesStatus?: number;
  fichesCount?: number;
  fichesGenere?: string;
  githubStatus?: number;
  githubRuns?: RunGithub[];
}

/** Routage d'URL : Brevo → fiches.json → GitHub Actions ; le reste → 404. */
function makeFetch(opts: FetchOptions = {}): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === 'https://api.brevo.com/v3/smtp/email') {
      opts.brevoCalls?.push({
        body: JSON.parse(init?.body as string) as BrevoBody,
      });
      return new Response(JSON.stringify({ messageId: 'test-123' }), {
        status: opts.brevoStatus ?? 200,
      });
    }
    if (u === 'https://francepassoire.com/opendata/v1/fiches.json') {
      if (opts.fichesStatus !== undefined && opts.fichesStatus !== 200) {
        return new Response('erreur catalogue', { status: opts.fichesStatus });
      }
      return new Response(
        JSON.stringify({
          schema: 'francepassoire/fiches@v1',
          generated_at: opts.fichesGenere ?? '2026-08-23T07:58:00Z',
          count: opts.fichesCount ?? 883,
          fiches: [],
        }),
        { status: 200 },
      );
    }
    if (u.startsWith('https://api.github.com/')) {
      return new Response(
        JSON.stringify({ workflow_runs: opts.githubRuns ?? [] }),
        { status: opts.githubStatus ?? 200 },
      );
    }
    return new Response('introuvable', { status: 404 });
  }) as typeof fetch;
}

function semerCandidat(raw: DatabaseSync, status: string, createdAt: string, nom: string | null): void {
  raw.prepare(
    "INSERT INTO candidates (id, source, source_url, raw, status, entity_name, created_at) VALUES (?, 'test', 'https://exemple.fr', '{}', ?, ?, ?)",
  ).run(crypto.randomUUID(), status, nom, createdAt);
}

function semerAbonne(raw: DatabaseSync, id: string, confirme: boolean): void {
  raw.prepare(
    'INSERT INTO subscribers (id, email_hash, email_enc, confirmed_at, unsub_token, prefs_json) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, `hash-${id}`, 'enc-factice', confirme ? '2026-08-19 10:00:00' : null, `tok-${id}-abcdef0123456789`, '{}');
}

/** Fixture complète : candidats frais + hors fenêtre, source saine + muette,
 *  drapeau source morte, 2 workflows (1 succès, 1 échec), catalogue OK. */
async function envRapport(): Promise<{ env: Env; raw: DatabaseSync; kv: FakeKV }> {
  const { env, raw, kv } = makeEnv({ brevo: 'xkeysib-test' });
  semerCandidat(raw, 'NEW', '2026-08-23 06:10:00', 'Entité Récente');
  semerCandidat(raw, 'NEW', '2026-08-23 05:00:00', 'Cabinet Dupont & Fils');
  semerCandidat(raw, 'DRAFT', '2026-08-23 03:30:00', 'Brouillon SARL');
  semerCandidat(raw, 'PUBLISHED', '2026-08-23 01:00:00', 'Publiée SA');
  semerCandidat(raw, 'REJECTED', '2026-08-22 20:00:00', 'Rejetée SA');
  semerCandidat(raw, 'NEW', '2026-08-20 09:00:00', 'Vieille Entité'); // hors fenêtre 24 h
  await kv.put(
    'ingest:state:gnews',
    JSON.stringify({ last_success: '2026-08-23T06:00:00.000Z', consecutive_failures: 0 }),
  );
  await kv.put(
    'ingest:state:rss-01net',
    JSON.stringify({ last_success: '2026-08-22T23:00:00.000Z', consecutive_failures: 3 }),
  );
  await kv.put('source_dead:rss-zataz', JSON.stringify({ since: '2026-08-20', reason: 'archivé' }));
  semerAbonne(raw, 'a1', true);
  semerAbonne(raw, 'a2', true);
  semerAbonne(raw, 'a3', false);
  return { env, raw, kv };
}

const RUNS_GITHUB: RunGithub[] = [
  { name: 'gnews-vps.yml', conclusion: 'success', created_at: '2026-08-23T05:00:00Z' },
  { name: 'fb-vps.yml', conclusion: 'failure', created_at: '2026-08-23T07:00:00Z' },
];

const sweepMort: InstantSweepResultats = { bootstrap: false, nouveaux: 0, changements: 0, envois: 0, sauts: 0, raison: 'fiches-indisponibles' };
const sweepReussi: InstantSweepResultats = { bootstrap: false, nouveaux: 0, changements: 0, envois: 0, sauts: 0 };
const sweepAveugle: InstantSweepResultats = { bootstrap: false, nouveaux: 0, changements: 0, envois: 0, sauts: 0, raison: 'secrets-absents' };

// ---------------------------------------------------------------------------
// Porte (heure 10 Paris) + sujet
// ---------------------------------------------------------------------------

describe('doitLancerRapport — porte heure 10 Paris (DST-safe, week-ends inclus)', () => {
  it('heure 10 Europe/Paris, été comme hiver, samedi et dimanche', () => {
    expect(doitLancerRapport(new Date('2026-08-23T08:00:00Z'))).toBe(true);  // dimanche 10:00 Paris (été)
    expect(doitLancerRapport(new Date('2026-08-23T08:45:00Z'))).toBe(true);  // dimanche 10:45
    expect(doitLancerRapport(new Date('2026-08-22T08:00:00Z'))).toBe(true);  // samedi 10:00
    expect(doitLancerRapport(new Date('2027-01-25T09:00:00Z'))).toBe(true);  // lundi 10:00 Paris (hiver)
  });

  it('toute autre heure → faux (la garde KV déduplique le reste)', () => {
    expect(doitLancerRapport(new Date('2026-08-23T07:59:59Z'))).toBe(false); // 09:59 Paris
    expect(doitLancerRapport(new Date('2026-08-23T09:00:00Z'))).toBe(false); // 11:00 Paris
    expect(doitLancerRapport(new Date('2026-08-23T07:00:00Z'))).toBe(false); // 09:00 Paris
  });

  it('clé de garde datée Paris (bascule à minuit Paris, pas UTC)', () => {
    expect(cleGardeRapport(new Date('2026-08-23T22:30:00Z'))).toBe('rapport:jour:20260824'); // 00:30 Paris le 24
    expect(cleGardeRapport(new Date('2026-08-23T21:30:00Z'))).toBe('rapport:jour:20260823'); // 23:30 Paris le 23
  });
});

describe('sujetRapport — format et longueur', () => {
  it('« Rapport pipeline · verdict · date fr » ≤ 60 caractères, vert et rouge', () => {
    const ok = sujetRapport(0, MAINTENANT);
    expect(ok).toBe('Rapport pipeline · PIPELINE OK · 23/08/2026');
    expect(ok.length).toBeLessThanOrEqual(60);

    const ko = sujetRapport(12, MAINTENANT);
    expect(ko).toBe('Rapport pipeline · ANOMALIE (12) · 23/08/2026');
    expect(ko.length).toBeLessThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------
// Rendu du rapport (sections, verdict, garde)
// ---------------------------------------------------------------------------

describe('runRapportQuotidien — rendu complet avec fixtures', () => {
  it('toutes les sections rendues : candidats, sources, drapeaux, workflows, catalogue, abonnés + verdict ANOMALIE (3)', async () => {
    const { env, kv } = await envRapport();
    const brevoCalls: BrevoCall[] = [];

    const resultat = await runRapportQuotidien(env, {
      fetchFn: makeFetch({ brevoCalls, githubRuns: RUNS_GITHUB }),
      now: MAINTENANT,
      log: () => {},
    });

    expect(resultat.envoye).toBe(true);
    expect(resultat.anomalies).toBe(3); // 1 source muette + 1 drapeau mort + 1 workflow en échec
    expect(kv.store.get('rapport:jour:20260823')?.value).toBeTruthy(); // garde posée

    expect(brevoCalls).toHaveLength(1);
    const corps = brevoCalls[0]!.body;
    expect(corps.to).toEqual([{ email: 'contact@francepassoire.com' }]); // destinataire queue-watchdog
    expect(corps.subject).toBe('Rapport pipeline · ANOMALIE (3) · 23/08/2026');

    const html = corps.htmlContent ?? '';
    const texte = corps.textContent;

    // En-tête maison + verdict
    expect(html).toContain('Rapport pipeline');
    expect(html).toContain('#FFF9F2');
    expect(html).toContain('#241405');
    expect(html).toContain('ANOMALIE (3)');
    expect(html).toContain('#B3261E');
    expect(html).toContain('3 points rouges : 1 source muette (+6 h) · 1 drapeau source morte · 1 workflow en échec');
    expect(texte).toContain('VERDICT : ANOMALIE (3 points rouges)');

    // a. Candidats 24 h : compteurs, total, noms NEW échappés, exclusion hors fenêtre
    expect(html).toContain('Candidats 24 h');
    expect(texte).toContain('NEW 2 · DRAFT 1 · PUBLISHED 1 · REJECTED 1 (total 5)');
    expect(html).toContain('NEW 2 · DRAFT 1 · PUBLISHED 1 · REJECTED 1');
    expect(html).toContain('Cabinet Dupont &amp; Fils'); // échappement HTML
    expect(html).not.toContain('Vieille Entité'); // créée il y a 3 jours
    expect(texte).not.toContain('Vieille Entité');
    expect(texte).toContain('À traiter (NEW) : Entité Récente, Cabinet Dupont & Fils');

    // b. Sources : saine, muette (+6 h) rouge, drapeau mort
    expect(texte).toContain('gnews : dernier succès il y a 2 h · 0 échec de suite');
    expect(texte).toContain('⚠️ rss-01net : dernier succès il y a 9 h · 3 échecs de suite · MUETTE DEPUIS PLUS DE 6 H');
    expect(html).toContain('⚠️ rss-01net');
    expect(texte).toContain('rss-zataz · depuis 2026-08-20 · archivé');
    expect(html).toContain('rss-zataz · depuis 2026-08-20 · archivé');

    // c. Workflows : succès, échec rouge, workflows sans run
    expect(texte).toContain('gnews-vps.yml : succès · il y a 3 h');
    expect(texte).toContain('⚠️ fb-vps.yml : échec · il y a 1 h');
    expect(html).toContain('⚠️ fb-vps.yml : échec · il y a 1 h');
    expect(texte).toContain('veille-sociale-vps.yml : aucun run visible');

    // d. Catalogue OK
    expect(texte).toContain('883 fiches au catalogue · généré le 2026-08-23 07:58 UTC');
    expect(html).toContain('883 fiches au catalogue');

    // e. Abonnés
    expect(texte).toContain('3 abonnés · 2 confirmés');
    expect(html).toContain('3 abonnés · 2 confirmés');
  });

  it('environnement tout vert → pastille PIPELINE OK, « aucun drapeau posé » sans source_dead', async () => {
    const { env, raw } = makeEnv({ brevo: 'xkeysib-test' });
    raw.prepare("INSERT INTO candidates (id, source, raw, status) VALUES ('c1', 'test', '{}', 'NEW')").run();
    const brevoCalls: BrevoCall[] = [];

    const resultat = await runRapportQuotidien(env, {
      fetchFn: makeFetch({
        brevoCalls,
        githubRuns: [{ name: 'gnews-vps.yml', conclusion: 'success', created_at: '2026-08-23T05:00:00Z' }],
      }),
      now: MAINTENANT,
      log: () => {},
    });

    expect(resultat.anomalies).toBe(0);
    const corps = brevoCalls[0]!.body;
    expect(corps.subject).toBe('Rapport pipeline · PIPELINE OK · 23/08/2026');
    expect(corps.htmlContent).toContain('PIPELINE OK');
    expect(corps.htmlContent).toContain('#0E7A46');
    expect(corps.textContent).toContain('VERDICT : PIPELINE OK');
    expect(corps.textContent).toContain('Drapeaux sources mortes : aucun drapeau posé');
    expect(corps.htmlContent).toContain('aucun drapeau posé');
  });

  it('KV sans list → dégradation honnête (pas un rouge), mail envoyé', async () => {
    const { env: envBase } = makeEnv({ brevo: 'xkeysib-test' });
    const kvBase = envBase.RUN_STATE as FakeKV;
    const kvSansList: KVNamespace = {
      async get(key) { return kvBase.store.get(key)?.value ?? null; },
      async put(key, value) { kvBase.store.set(key, { value, expiresAtMs: null }); },
    };
    const envSansList = { ...envBase, RUN_STATE: kvSansList };
    const brevoCalls: BrevoCall[] = [];

    const resultat = await runRapportQuotidien(envSansList, {
      fetchFn: makeFetch({ brevoCalls }),
      now: MAINTENANT,
      log: () => {},
    });

    expect(resultat.envoye).toBe(true);
    expect(resultat.anomalies).toBe(0);
    expect(brevoCalls[0]!.body.textContent).toContain('états non lisibles (binding KV sans list)');
    // la garde du rapport est bien passée par le KV dégradé
    expect(kvBase.store.get('rapport:jour:20260823')?.value).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Garde : une fois par jour, posée AVANT l'envoi
// ---------------------------------------------------------------------------

describe('runRapportQuotidien — garde une fois par jour', () => {
  it('second passage le même jour → aucun nouvel envoi', async () => {
    const { env } = await envRapport();
    const brevoCalls: BrevoCall[] = [];
    const fetchFn = makeFetch({ brevoCalls, githubRuns: RUNS_GITHUB });

    const premier = await runRapportQuotidien(env, { fetchFn, now: MAINTENANT, log: () => {} });
    const second = await runRapportQuotidien(env, {
      fetchFn,
      now: new Date('2026-08-23T08:15:00Z'), // tick suivant de l'heure 10
      log: () => {},
    });

    expect(premier.envoye).toBe(true);
    expect(second).toEqual({ envoye: false, dejaEnvoye: true });
    expect(brevoCalls).toHaveLength(1);
  });

  it('échec Brevo (HTTP 500) → garde quand même posée (pas de re-spam au tick suivant)', async () => {
    const { env, kv } = await envRapport();
    const brevoCalls: BrevoCall[] = [];
    const fetchFn = makeFetch({ brevoCalls, brevoStatus: 500, githubRuns: RUNS_GITHUB });

    const premier = await runRapportQuotidien(env, { fetchFn, now: MAINTENANT, log: () => {} });
    const second = await runRapportQuotidien(env, { fetchFn, now: new Date('2026-08-23T08:30:00Z'), log: () => {} });

    expect(premier.envoye).toBe(false); // Brevo a refusé
    expect(kv.store.get('rapport:jour:20260823')?.value).toBeTruthy(); // garde déjà posée
    expect(second.dejaEnvoye).toBe(true);
    expect(brevoCalls).toHaveLength(1); // un seul essai, le lendemain réessaie
  });

  it('le lendemain (nouvelle clé) → nouvel envoi', async () => {
    const { env } = await envRapport();
    const brevoCalls: BrevoCall[] = [];
    const fetchFn = makeFetch({ brevoCalls, githubRuns: RUNS_GITHUB });

    await runRapportQuotidien(env, { fetchFn, now: MAINTENANT, log: () => {} });
    const lendemain = await runRapportQuotidien(env, {
      fetchFn,
      now: new Date('2026-08-24T08:00:00Z'), // lundi 10:00 Paris
      log: () => {},
    });

    expect(lendemain.envoye).toBe(true);
    expect(brevoCalls).toHaveLength(2);
  });

  it('BREVO_API_KEY absent → sortie propre : aucun fetch, garde non posée', async () => {
    const { env, kv } = makeEnv({});
    const fetchFn = vi.fn(makeFetch());

    const resultat = await runRapportQuotidien(env, { fetchFn, now: MAINTENANT, log: () => {} });

    expect(resultat).toEqual({ envoye: false, raison: 'brevo-absent' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(kv.store.size).toBe(0);
  });

  it('bindings DB/RUN_STATE absents → sortie propre sans crash', async () => {
    const envNu = { DB: undefined, RUN_STATE: undefined } as unknown as Env;
    const resultat = await runRapportQuotidien(envNu, { fetchFn: makeFetch(), now: MAINTENANT, log: () => {} });
    expect(resultat).toEqual({ envoye: false, raison: 'bindings-absents' });
  });
});

// ---------------------------------------------------------------------------
// Catalogue rouge (la classe d'incident du 22/08) + GitHub 404
// ---------------------------------------------------------------------------

describe('runRapportQuotidien — sections dégradées', () => {
  it('fiches.json HTTP 500 → section catalogue ROUGE, verdict ANOMALIE, mail quand même envoyé', async () => {
    const { env } = makeEnv({ brevo: 'xkeysib-test' });
    const brevoCalls: BrevoCall[] = [];

    const resultat = await runRapportQuotidien(env, {
      fetchFn: makeFetch({ brevoCalls, fichesStatus: 500 }),
      now: MAINTENANT,
      log: () => {},
    });

    expect(resultat.envoye).toBe(true); // l'échec du catalogue est du CONTENU, pas un crash
    expect(resultat.anomalies).toBe(1);
    expect(brevoCalls).toHaveLength(1);
    const corps = brevoCalls[0]!.body;
    expect(corps.subject).toBe('Rapport pipeline · ANOMALIE (1) · 23/08/2026');
    expect(corps.textContent).toContain('INJOIGNABLE (HTTP 500)');
    expect(corps.htmlContent).toContain('Catalogue injoignable · HTTP 500');
    expect(corps.htmlContent).toContain('#B3261E');
    expect(corps.textContent).toContain('classe d\'incident du 22/08');
  });

  it('GitHub 404 (dépôt privé sans jeton) → dégradation honnête, aucun rouge, mail envoyé', async () => {
    const { env } = makeEnv({ brevo: 'xkeysib-test' });
    const brevoCalls: BrevoCall[] = [];

    const resultat = await runRapportQuotidien(env, {
      fetchFn: makeFetch({ brevoCalls, githubStatus: 404 }),
      now: MAINTENANT,
      log: () => {},
    });

    expect(resultat.envoye).toBe(true);
    expect(resultat.anomalies).toBe(0); // non vérifiable ≠ rouge
    const corps = brevoCalls[0]!.body;
    expect(corps.subject).toBe('Rapport pipeline · PIPELINE OK · 23/08/2026');
    expect(corps.textContent).toContain('non vérifiables sans jeton · visibles côté GitHub Actions (mobile)');
    expect(corps.htmlContent).toContain('non vérifiables sans jeton');
  });

  it('fetch GitHub qui jette (réseau) → même dégradation honnête, pas de crash', async () => {
    const { env } = makeEnv({ brevo: 'xkeysib-test' });
    const brevoCalls: BrevoCall[] = [];
    const routeur = makeFetch({ brevoCalls });
    const fetchMort = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith('https://api.github.com/')) throw new Error('réseau mort');
      return routeur(url, init);
    }) as typeof fetch;

    const resultat = await runRapportQuotidien(env, { fetchFn: fetchMort, now: MAINTENANT, log: () => {} });

    expect(resultat.envoye).toBe(true);
    expect(resultat.anomalies).toBe(0);
    expect(brevoCalls[0]!.body.textContent).toContain('non vérifiables sans jeton');
  });
});

// ---------------------------------------------------------------------------
// Tripwire fiches.json (compteur quart d'heure)
// ---------------------------------------------------------------------------

describe('gererFichesMortes — compteur, seuil 4, alerte une fois par jour', () => {
  it('4 échecs consécutifs → 1 alerte ; 5e échec le même jour → rien ; succès → remise à zéro ; lendemain → nouvelle alerte', async () => {
    const { env, kv } = makeEnv({ brevo: 'xkeysib-test' });
    const brevoCalls: BrevoCall[] = [];
    const fetchFn = makeFetch({ brevoCalls });
    const jour1 = new Date('2026-08-23T08:15:00Z');

    // balayage aveugle (secrets absents côté sweep) : ni incrément, ni amnésie
    const aveugle = await gererFichesMortes(env, sweepAveugle, { fetchFn, now: jour1, log: () => {} });
    expect(aveugle.compteur).toBe(0);

    // 3 échecs : sous le seuil, aucune alerte
    for (let i = 1; i <= 3; i++) {
      const r = await gererFichesMortes(env, sweepMort, { fetchFn, now: jour1, log: () => {} });
      expect(r.alerte).toBe(false);
    }
    expect(kv.store.get('watchlist:fiches-mortes:compteur')?.value).toBe('3');

    // 4e échec (= 1 h de panne continue) : L'alerte
    const quatrieme = await gererFichesMortes(env, sweepMort, { fetchFn, now: jour1, log: () => {} });
    expect(quatrieme.alerte).toBe(true);
    expect(quatrieme.emailOk).toBe(true);
    expect(brevoCalls).toHaveLength(1);
    expect(brevoCalls[0]!.body.subject).toBe('Catalogue injoignable depuis 1 h');
    expect(brevoCalls[0]!.body.textContent).toContain('fiches.json');
    expect(brevoCalls[0]!.body.textContent).toContain('Échecs consécutifs du balayage quart d\'heure : 4');
    expect(kv.store.get(cleGardeFiches(jour1))?.value).toBeTruthy(); // garde posée AVANT l'envoi

    // 5e échec le même jour : garde déjà là, pas de second email
    const cinquieme = await gererFichesMortes(env, sweepMort, { fetchFn, now: jour1, log: () => {} });
    expect(cinquieme.alerte).toBe(false);
    expect(cinquieme.dejaAlerte).toBe(true);
    expect(brevoCalls).toHaveLength(1);
    expect(kv.store.get('watchlist:fiches-mortes:compteur')?.value).toBe('5');

    // balayage réussi : compteur remis à zéro
    const retabli = await gererFichesMortes(env, sweepReussi, { fetchFn, now: jour1, log: () => {} });
    expect(retabli.compteur).toBe(0);
    expect(kv.store.get('watchlist:fiches-mortes:compteur')?.value).toBe('0');

    // 4 nouveaux échecs le MÊME jour : la garde du jour tient toujours
    for (let i = 0; i < SEUIL_FICHES_MORTES; i++) {
      await gererFichesMortes(env, sweepMort, { fetchFn, now: jour1, log: () => {} });
    }
    expect(brevoCalls).toHaveLength(1);

    // le lendemain : nouvelle alerte autorisée (nouvelle clé de garde)
    const jour2 = new Date('2026-08-24T08:15:00Z');
    const lendemain = await gererFichesMortes(env, sweepMort, { fetchFn, now: jour2, log: () => {} });
    expect(lendemain.alerte).toBe(true);
    expect(brevoCalls).toHaveLength(2);
    expect(brevoCalls[1]!.body.subject).toBe('Catalogue injoignable depuis 1 h'); // 5e échec ≈ 1 h
  });

  it('échec Brevo (HTTP 500) → garde quand même posée, pas de re-spam au tick suivant', async () => {
    const { env, kv } = makeEnv({ brevo: 'xkeysib-test' });
    const brevoCalls: BrevoCall[] = [];
    const fetchFn = makeFetch({ brevoCalls, brevoStatus: 500 });
    const jour = new Date('2026-08-23T08:15:00Z');

    for (let i = 0; i < 4; i++) {
      await gererFichesMortes(env, sweepMort, { fetchFn, now: jour, log: () => {} });
    }
    expect(brevoCalls).toHaveLength(1); // tenté puis refusé
    expect(kv.store.get(cleGardeFiches(jour))?.value).toBeTruthy(); // garde posée avant l'envoi

    const suivant = await gererFichesMortes(env, sweepMort, { fetchFn, now: jour, log: () => {} });
    expect(suivant.dejaAlerte).toBe(true);
    expect(brevoCalls).toHaveLength(1);
  });

  it('BREVO_API_KEY absent → détection seule : console.error, garde NON posée, pas de crash', async () => {
    const { env, kv } = makeEnv({}); // sans Brevo
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const brevoCalls: BrevoCall[] = [];
    const fetchFn = makeFetch({ brevoCalls });
    const jour = new Date('2026-08-23T08:15:00Z');

    for (let i = 0; i < 5; i++) {
      const r = await gererFichesMortes(env, sweepMort, { fetchFn, now: jour, log: () => {} });
      expect(r.alerte).toBe(false);
    }
    expect(brevoCalls).toHaveLength(0);
    expect(kv.store.has(cleGardeFiches(jour))).toBe(false); // le signal reste à envoyer
    expect(kv.store.get('watchlist:fiches-mortes:compteur')?.value).toBe('5');
    expect(err).toHaveBeenCalledWith(expect.stringContaining('DÉTECTION SEULE'));
    err.mockRestore();
  });

  it('binding RUN_STATE absent → sortie propre sans crash', async () => {
    const envNu = { DB: undefined, RUN_STATE: undefined } as unknown as Env;
    const r = await gererFichesMortes(envNu, sweepMort, { fetchFn: makeFetch(), now: MAINTENANT, log: () => {} });
    expect(r.alerte).toBe(false);
    expect(r.compteur).toBe(0);
  });

  it('balayage qui n\'a rien pu vérifier (secrets absents) : compteur inchangé, même après des échecs', async () => {
    const { env, kv } = makeEnv({ brevo: 'xkeysib-test' });
    const fetchFn = makeFetch();
    const jour = new Date('2026-08-23T08:15:00Z');

    for (let i = 0; i < 2; i++) await gererFichesMortes(env, sweepMort, { fetchFn, now: jour, log: () => {} });
    const r = await gererFichesMortes(env, sweepAveugle, { fetchFn, now: jour, log: () => {} });
    expect(r.compteur).toBe(2); // ni incrément, ni amnésie
    expect(kv.store.get('watchlist:fiches-mortes:compteur')?.value).toBe('2');
  });
});

// ---------------------------------------------------------------------------
// Règle maison verrouillée : aucun em-dash dans les rendus
// ---------------------------------------------------------------------------

describe('gabarits verrouillés : aucun em-dash (—) ni en-dash (–) dans les rendus', () => {
  it('rapport quotidien (vert, rouge, dégradé) : sujet, texte et HTML propres', async () => {
    const scenarios: FetchOptions[] = [
      { githubRuns: RUNS_GITHUB },                     // anomalie (3)
      { fichesStatus: 500, githubStatus: 404 },        // catalogue rouge + GitHub dégradé
      {},                                              // tout vert / tout dégradé
    ];
    for (const scenario of scenarios) {
      const { env, raw } = makeEnv({ brevo: 'xkeysib-test' });
      raw.prepare("INSERT INTO candidates (id, source, raw, status, entity_name, created_at) VALUES ('c1', 'test', '{}', 'NEW', 'Entité — Tirets & <dangereux>', '2026-08-23 07:00:00')").run();
      const brevoCalls: BrevoCall[] = [];
      await runRapportQuotidien(env, {
        fetchFn: makeFetch({ ...scenario, brevoCalls }),
        now: MAINTENANT,
        log: () => {},
      });
      expect(brevoCalls).toHaveLength(1);
      const corps = brevoCalls[0]!.body;
      expect(corps.subject).not.toContain('—');
      expect(corps.textContent).not.toContain('—');
      expect(corps.htmlContent).not.toContain('—');
      expect(corps.subject).not.toContain('–');
      expect(corps.textContent).not.toContain('–');
      expect(corps.htmlContent).not.toContain('–');
      // un em-dash VENU DES DONNÉES est neutralisé en tiret simple (+ & et <> échappés en HTML)
      expect(corps.htmlContent).toContain('Entité - Tirets &amp; &lt;dangereux&gt;');
      expect(corps.textContent).toContain('Entité - Tirets & <dangereux>');
    }
  });

  it('alerte fiches mortes : sujet, texte et HTML sans em-dash', async () => {
    const { env } = makeEnv({ brevo: 'xkeysib-test' });
    const brevoCalls: BrevoCall[] = [];
    const fetchFn = makeFetch({ brevoCalls });
    const jour = new Date('2026-08-23T08:15:00Z');
    for (let i = 0; i < 4; i++) {
      await gererFichesMortes(env, sweepMort, { fetchFn, now: jour, log: () => {} });
    }
    expect(brevoCalls).toHaveLength(1);
    const corps = brevoCalls[0]!.body;
    expect(corps.subject).not.toContain('—');
    expect(corps.textContent).not.toContain('—');
    expect(corps.htmlContent).not.toContain('—');
  });
});
