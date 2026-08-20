// workers/retention/src/index.ts — worker de rétention RGPD (T46, Wave 6).
//
// Cron quotidien : applie EXACTEMENT les règles S1/C1/E1 de docs/rgpd.md §2
// (la seule autre source de vérité de ces règles) :
//   S1 — subscribers jamais confirmés (confirmed_at IS NULL) créés depuis
//        plus de 30 jours ;
//   C1 — candidates REJECTED créés depuis plus de 365 jours (purge au plus
//        tard 1 an après le traitement — un REJECTED est déjà traité) ;
//   E1 — events créés depuis plus de 90 jours (journaux workers).
//
// Ne touche à RIEN d'autre : la file éditoriale vive (NEW/DRAFT/PUBLISHED)
// et la table registry (chaîne d'intégrité, empreintes sans données
// personnelles) ne sont jamais purgées par ce worker.
//
// Les bornes sont calculées par SQLite lui-même (datetime('now', ?)) pour
// comparer des formats homogènes avec les défauts datetime('now') du schéma
// 0001_init.sql ; le modificateur ('-30 days', etc.) est lié en paramètre —
// le test tests/retention.test.ts l'asserte et exécute le SQL sur une vraie
// sémantique SQLite.
//
// Discipline identique aux autres workers : interfaces structurelles
// minimales (pas de dépendance @cloudflare/workers-types), testable par
// vitest avec un fake D1 en mémoire.

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<{ success: boolean; meta: { changes: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface Env {
  DB: D1Database;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

/** Reçu d'exécution — une ligne par règle de docs/rgpd.md §2. */
export interface RetentionReceipt {
  /** Règle S1 : inscriptions jamais confirmées purgées (30 j). */
  unconfirmedSubscribers: number;
  /** Règle C1 : candidats rejetés purgés (1 an). */
  rejectedCandidates: number;
  /** Règle E1 : événements de journal purgés (90 j). */
  oldEvents: number;
}

const RULE_S1 = {
  sql: 'DELETE FROM subscribers WHERE confirmed_at IS NULL AND created_at < datetime(\'now\', ?)',
  modifier: '-30 days',
};
const RULE_C1 = {
  sql: 'DELETE FROM candidates WHERE status = \'REJECTED\' AND created_at < datetime(\'now\', ?)',
  modifier: '-365 days',
};
const RULE_E1 = {
  sql: 'DELETE FROM events WHERE created_at < datetime(\'now\', ?)',
  modifier: '-90 days',
};

/** Applique les trois règles dans un ordre déterministe, retourne le reçu. */
export async function runRetention(env: Env): Promise<RetentionReceipt> {
  const deleted = async (rule: { sql: string; modifier: string }): Promise<number> => {
    const result = await env.DB.prepare(rule.sql).bind(rule.modifier).run();
    return result.success ? result.meta.changes : 0;
  };

  const unconfirmedSubscribers = await deleted(RULE_S1);
  const rejectedCandidates = await deleted(RULE_C1);
  const oldEvents = await deleted(RULE_E1);

  return { unconfirmedSubscribers, rejectedCandidates, oldEvents };
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const recu = await runRetention(env);
    console.log(
      `[retention] S1=${recu.unconfirmedSubscribers} non-confirmés purgés, ` +
        `C1=${recu.rejectedCandidates} candidats rejetés purgés, ` +
        `E1=${recu.oldEvents} événements purgés (règles docs/rgpd.md §2)`,
    );
  },
};
