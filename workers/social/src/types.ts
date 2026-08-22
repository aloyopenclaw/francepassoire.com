// workers/social/src/types.ts — types structurels partagés par la file
// sociale et ses clients de plateforme (T38–T40 + T51, Wave 5).
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
   * URL du webhook Make.com — chemin de production pour X ET LinkedIn page
   * (clients make-x.ts / make-linkedin.ts) : l'URL longue et secrète EST le
   * crédential du scénario (Webhook → module « Create a Post » / post page).
   */
  MAKE_WEBHOOK_URL?: string;
  /** Token membre LinkedIn (scope w_member_social, 60 jours). */
  LINKEDIN_ACCESS_TOKEN?: string;
  /** URN du membre émetteur, ex. urn:li:person:XXXXXX (page Token Generator). */
  LINKEDIN_MEMBER_URN?: string;
  /** ID de la Page Facebook (feed de publication), ex. 1234567890. */
  FB_PAGE_ID?: string;
  /**
   * Page access token Facebook (Graph API Explorer → /me/accounts) — sert
   * AUSSI au client Instagram (compte IG professionnel relié à la Page).
   */
  FB_PAGE_TOKEN?: string;
  /** ID du compte Instagram professionnel (instagram_business_account de la Page). */
  IG_USER_ID?: string;
  /** Handle Bluesky, ex. francepassoire.bsky.social (tâche 38). */
  BLUESKY_HANDLE?: string;
  /**
   * Mot de passe d'APPLICATION Bluesky (bsky.app › Réglages › Confidentialité
   * et sécurité — jamais le mot de passe du compte lui-même, tâche 38).
   */
  BLUESKY_APP_PASSWORD?: string;
  /**
   * Secret Nostr (tâche 38) : hex 64 caractères — la valeur exacte de
   * ~/.config/francepassoire/nostr.key — ou son équivalent nsec. Se pose via
   * `wrangler secret put NOSTR_NSEC`.
   */
  NOSTR_NSEC?: string;
}

/**
 * Plateformes gérées par ce worker (T38–T40 : Bluesky/Nostr, X, LinkedIn ;
 * T51 : X passe au bridge Make, + Facebook Page + Instagram, TikTok retiré).
 */
export type SocialPlatform =
  | 'x'
  | 'linkedin'
  | 'facebook'
  | 'instagram'
  | 'bluesky'
  | 'nostr';

export const PLATFORMES: readonly SocialPlatform[] = [
  'x',
  'linkedin',
  'facebook',
  'instagram',
  'bluesky',
  'nostr',
];

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
 *  - UNSUPPORTED_PAYLOAD : honnête refus structurel (ex. URL sans carte pour
 *    Instagram) ;
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
