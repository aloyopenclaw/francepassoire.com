// workers/social/src/types.ts — types structurels partagés par la file
// sociale et ses clients de plateforme (T39+T40, Wave 5).
//
// Même discipline que le worker d'ingestion : accès D1 uniquement via l'env
// injecté, interfaces structurelles minimales (pas de dépendance
// @cloudflare/workers-types), donc testable par vitest avec des fakes.

import type { Statut } from '../../../src/lib/taxonomy';

export interface D1Result<T> {
  results: T[];
  success: boolean;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<{ success: boolean }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

export interface Env {
  DB: D1Database;
  /**
   * Bearer token app-only X — LECTURE SEULE (docs/social-setup.md §1) :
   * présent pour mémoire, ce worker ne l'utilise jamais pour publier.
   */
  X_BEARER?: string;
  /**
   * Token UTILISATEUR OAuth 2.0 X (tweet.read + users.read + tweet.write) :
   * le seul capable de POST /2/tweets. Nom canonique défini par la T39.
   */
  X_USER_TOKEN?: string;
  /** Token membre LinkedIn (scope w_member_social, 60 jours). */
  LINKEDIN_ACCESS_TOKEN?: string;
  /** URN du membre émetteur, ex. urn:li:person:XXXXXX (page Token Generator). */
  LINKEDIN_MEMBER_URN?: string;
  /** User access token TikTok Login Kit (scope video.publish, préfixe act.). */
  TIKTOK_ACCESS_TOKEN?: string;
}

/** Plateformes gérées par ce worker — Bluesky/Nostr (T38) ont leur propre voie. */
export type SocialPlatform = 'x' | 'linkedin' | 'tiktok';

export const PLATFORMES: readonly SocialPlatform[] = ['x', 'linkedin', 'tiktok'];

/**
 * Payload d'une ligne social_outbox (colonne payload, JSON sérialisé).
 * `text` vient des rendus de src/lib/social-templates.ts (déjà validés
 * ≤ 260 caractères et tonalité factuelle) — le worker ne re-rend rien.
 */
export interface PostPayload {
  /** Texte rendu, prêt à publier. */
  text: string;
  /** URL de la fiche (ou du site) partagée dans le post. */
  url: string;
  /** Statut éditorial de la fiche concernée — déclenche la garde de mention. */
  statut?: Statut;
  /** Traçabilité ; `attempts` (compteur de tentatives) appartient à la file. */
  metadata?: { attempts?: number; [cle: string]: unknown };
}

/**
 * Verdict d'un client de plateforme. Quatre états, jamais d'exception :
 *  - SENT : publié, externalId logué ;
 *  - PENDING_KEYS : secret absent, la ligne reste en file (jamais un échec) ;
 *  - UNSUPPORTED_PAYLOAD : honnête refus structurel (ex. TikTok sans vidéo) ;
 *  - ERROR : échec d'appel — retryable (429/5xx/réseau) ou non (401/4xx).
 */
export type SendResult =
  | { status: 'SENT'; externalId?: string }
  | { status: 'PENDING_KEYS'; reason: string }
  | { status: 'UNSUPPORTED_PAYLOAD'; reason: string }
  | { status: 'ERROR'; retryable: boolean; reason: string };

/** Signature commune des clients — cassette-testable via fetchFn injecté. */
export type SendFn = (
  payload: PostPayload,
  env: Env,
  fetchFn: typeof fetch,
) => Promise<SendResult>;
