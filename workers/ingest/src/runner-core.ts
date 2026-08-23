// workers/ingest/src/runner-core.ts — internes du runner d'ingestion.
//
// Extraction de index.ts (refactor pur : mêmes fonctions, mêmes sémantiques)
// pour tester et réutiliser l'insertion de candidats et l'état KV hors du
// module d'entrée du worker.

import type { Candidate } from './adapter';

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<{ success: boolean }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  /** T54c : retrait du drapeau source_dead quand une source redevient saine. */
  delete(key: string): Promise<void>;
}

/** Taille max de guid_set par source (FIFO) — borne la valeur KV. */
export const GUID_SET_MAX = 500;

export interface SourceState {
  last_run: string | null;
  last_success: string | null;
  consecutive_failures: number;
  disabled: boolean;
  guid_set: string[];
  hibp_catalog?: string;
}

export const stateKey = (adapterId: string): string => `ingest:state:${adapterId}`;

/**
 * Lecture + normalisation : l'état KV est PARTIEL par nature (première run,
 * champs absents) — cette fonction garantit un état COMPLET (guid_set et
 * compteurs jamais undefined), invariant dont dépend tout le runner.
 */
export async function readState(kv: KVNamespace, adapterId: string): Promise<SourceState> {
  const raw = await kv.get(stateKey(adapterId));
  const parsed = raw === null ? ({} as Partial<SourceState>) : (JSON.parse(raw) as Partial<SourceState>);
  return {
    ...parsed,
    last_run: parsed.last_run ?? null,
    last_success: parsed.last_success ?? null,
    consecutive_failures: parsed.consecutive_failures ?? 0,
    disabled: parsed.disabled ?? false,
    guid_set: parsed.guid_set ?? [],
  };
}

export const writeState = (kv: KVNamespace, adapterId: string, state: SourceState): Promise<void> =>
  kv.put(stateKey(adapterId), JSON.stringify(state));

/** Insertion des candidats (status NEW, id UUID) — tout chemin d'entrée du
 *  pipeline passe par ici. */
export async function insertCandidates(db: D1Database, candidates: Candidate[]): Promise<number> {
  for (const candidate of candidates) {
    await db
      .prepare(
        'INSERT INTO candidates (id, source, source_url, raw, entity_name, dedup_score, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        crypto.randomUUID(),
        candidate.source,
        candidate.source_url,
        candidate.raw,
        candidate.entity_name,
        candidate.dedup_score ?? null,
        'NEW',
      )
      .run();
  }
  return candidates.length;
}
