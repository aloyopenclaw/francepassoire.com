import { describe, expect, it, vi } from 'vitest';
// Worker de rétention RGPD (T46) : les règles S1/C1/E1 de docs/rgpd.md §2
// exécutées sur une VRAIE sémantique SQLite (node:sqlite en mémoire, schéma
// réel de migrations/0001_init.sql) derrière l'interface D1 du worker —
// fixtures anciennes purgées, lignes récentes et file éditoriale intactes.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import worker, {
  runRetention,
  type D1Database,
  type D1PreparedStatement,
  type Env,
} from '../workers/retention/src/index';

const SCHEMA = readFileSync(
  fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url)),
  'utf-8',
);

/** Adaptateur D1 sur SQLite réel : mêmes méthodes que le binding, changes exploités. */
function makeEnv(): { env: Env; db: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const d1: D1Database = {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      let params: unknown[] = [];
      const wrapped: D1PreparedStatement = {
        bind(...values: unknown[]) {
          params = params.concat(values);
          return wrapped;
        },
        async run() {
          const info = stmt.run(...(params as Parameters<typeof stmt.run>));
          return { success: true, meta: { changes: Number(info.changes) } };
        },
      };
      return wrapped;
    },
  };
  return { env: { DB: d1 }, db };
}

describe('workers/retention — règles S1/C1/E1 (docs/rgpd.md §2)', () => {
  it('purge les lignes expirées et épargne tout le reste, reçu exact', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { env, db } = makeEnv();
    const at = (modifier: string): string =>
      (db.prepare(`SELECT datetime('now', '${modifier}') AS d`).get() as { d: string }).d;

    const insert = (table: string, row: Record<string, string>) => {
      const cols = Object.keys(row);
      db.prepare(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      ).run(...Object.values(row));
    };

    // subscribers : s1 (non confirmé, 40 j) purgé ; s2 récent et s3 confirmé conservés.
    insert('subscribers', { id: 's1', email_hash: 'h1', email_enc: 'e1', unsub_token: 't1', created_at: at('-40 days') });
    insert('subscribers', { id: 's2', email_hash: 'h2', email_enc: 'e2', unsub_token: 't2', created_at: at('-5 days') });
    insert('subscribers', { id: 's3', email_hash: 'h3', email_enc: 'e3', unsub_token: 't3', created_at: at('-400 days'), confirmed_at: at('-399 days') });

    // candidates : c1 (REJECTED, 400 j) purgé ; c2 REJECTED récent, c3 NEW
    // ancien, c4 PUBLISHED ancien — tous conservés (file éditoriale).
    insert('candidates', { id: 'c1', source: 'signalement', raw: '{}', status: 'REJECTED', created_at: at('-400 days') });
    insert('candidates', { id: 'c2', source: 'signalement', raw: '{}', status: 'REJECTED', created_at: at('-100 days') });
    insert('candidates', { id: 'c3', source: 'rss', raw: '{}', status: 'NEW', created_at: at('-400 days') });
    insert('candidates', { id: 'c4', source: 'signalement', raw: '{}', status: 'PUBLISHED', created_at: at('-400 days') });

    // events : e1 (120 j) purgé ; e2 récent conservé.
    insert('events', { id: 'e1', fiche_id: 'f1', type: 'publish', payload_json: '{}', created_at: at('-120 days') });
    insert('events', { id: 'e2', fiche_id: 'f2', type: 'publish', payload_json: '{}', created_at: at('-10 days') });

    // Hors périmètre déclaré : registry et social_outbox ne sont JAMAIS purgés.
    insert('registry', { date: at('-400 days'), type: 'genesis', empreinte: 'a'.repeat(64) });
    insert('social_outbox', { id: 'o1', platform: 'x', payload: '{}', created_at: at('-400 days') });

    const recu = await runRetention(env);

    expect(recu).toEqual({ unconfirmedSubscribers: 1, rejectedCandidates: 1, oldEvents: 1 });
    expect(db.prepare('SELECT id FROM subscribers ORDER BY id').all()).toEqual([
      { id: 's2' },
      { id: 's3' },
    ]);
    expect(db.prepare('SELECT id FROM candidates ORDER BY id').all()).toEqual([
      { id: 'c2' },
      { id: 'c3' },
      { id: 'c4' },
    ]);
    expect(db.prepare('SELECT id FROM events ORDER BY id').all()).toEqual([{ id: 'e2' }]);
    expect(db.prepare('SELECT COUNT(*) n FROM registry').get()).toMatchObject({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) n FROM social_outbox').get()).toMatchObject({ n: 1 });
    expect(logSpy).not.toHaveBeenCalled(); // runRetention ne logge pas (seul scheduled logge)

    vi.restoreAllMocks();
  });

  it('deuxième exécution idempotente : reçu à zéro, rien de plus supprimé', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { env, db } = makeEnv();
    const at = (modifier: string): string =>
      (db.prepare(`SELECT datetime('now', '${modifier}') AS d`).get() as { d: string }).d;
    db.prepare('INSERT INTO subscribers (id, email_hash, email_enc, unsub_token, created_at) VALUES (?,?,?,?,?)')
      .run('s-old', 'h', 'e', 't', at('-60 days'));

    expect(await runRetention(env)).toMatchObject({ unconfirmedSubscribers: 1 });
    expect(await runRetention(env)).toEqual({ unconfirmedSubscribers: 0, rejectedCandidates: 0, oldEvents: 0 });
    expect(db.prepare('SELECT COUNT(*) n FROM subscribers').get()).toMatchObject({ n: 0 });

    vi.restoreAllMocks();
  });

  it('le handler scheduled par défaut exécute les règles et logge le reçu', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { env, db } = makeEnv();
    const at = (modifier: string): string =>
      (db.prepare(`SELECT datetime('now', '${modifier}') AS d`).get() as { d: string }).d;
    db.prepare('INSERT INTO events (id, fiche_id, type, payload_json, created_at) VALUES (?,?,?,?,?)')
      .run('e-vieux', 'f', 'publish', '{}', at('-120 days'));

    await worker.scheduled(
      { scheduledTime: Date.now(), cron: '17 3 * * *' },
      env,
      { waitUntil: () => {}, passThroughOnException: () => {} },
    );

    expect(db.prepare('SELECT COUNT(*) n FROM events').get()).toMatchObject({ n: 0 });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('E1=1'));

    vi.restoreAllMocks();
  });
});
