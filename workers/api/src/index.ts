// workers/api/src/index.ts — worker API public FrancePassoire (T33, Wave 4).
//
// POST /api/report : formulaire « Signaler une fuite » → candidat D1
// (source 'signalement', status NEW — même file de validation que les
// adapters d'ingestion). Anti-abus en cascade, dans l'ordre :
//   1. honeypot rempli → 201 factice (silencieusement jeté, aucune écriture) ;
//   2. validation des champs (messages FR) → 400 ;
//   3. TURNSTILE_SECRET absent → 503 (honnête, pas de crash) ;
//   4. siteverify Turnstile (fail closed : réponse invalide OU erreur
//      réseau/5xx → 403) ;
//   5. rate limit 5/IP/h via KV (clé rl:report:<ip>, TTL 3600 s) → 429 ;
//   6. INSERT candidates → 201.
//
// Le honeypot court-circuite AVANT la vérification Turnstile : un robot qui
// remplit tous les champs ne consomme ni quota ni appel siteverify, et le
// chemin reste testable en local sans secret configuré.
//
// Pas d'email d'accusé de réception pour l'instant (pré-vol T29 en attente) :
// confirmation sur la page uniquement — pas de rupture silencieuse.
//
// Accès D1/KV uniquement via l'env injecté — interfaces structurelles
// minimales (pas de dépendance @cloudflare/workers-types), donc testable
// par vitest avec des fakes en mémoire (même approche que workers/ingest).
//
// T30/T31 : routes /api/watchlist* + cron digest hebdo (lundi 09:00 Paris)
// implémentées dans ./watchlist.ts (double opt-in Brevo, alertes) — ce
// fichier ne fait que le routage et le scheduled.

import { handleWatchlistRequest, runInstantSweep, runWeeklyDigest } from './watchlist';
import { runVeilleSociale, slotVeilleSociale } from './veille-sociale';

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<{ success: boolean }>;
  /** Lecture SELECT (T30 watchlist) : fourni par le binding D1 réel ;
   *  optionnel pour ne pas casser les fakes minimalistes des tests. */
  first?(): Promise<unknown>;
  all?(): Promise<unknown[]>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  DB: D1Database;
  RATE_LIMIT: KVNamespace;
  /** État du balayage « immédiat » (dernier catalogue vu) — KV partagé. */
  RUN_STATE?: KVNamespace;
  /** Secret Turnstile (wrangler secret put TURNSTILE_SECRET) — jamais une var en clair. */
  TURNSTILE_SECRET?: string;
  /** Clé API v3 Brevo (T30/T31) — envoi des emails de veille. */
  BREVO_API_KEY?: string;
  /** Destinataire du digest veille sociale (interne) — secret, pas une var. */
  VEILLE_SOCIALE_DEST?: string;
  /** Clé AES-256 en hex (T30) — chiffrement des emails : openssl rand -hex 32. */
  WATCHLIST_AES_KEY?: string;
  /** Clé HMAC (T30) — signature des liens de confirmation 24 h. */
  WATCHLIST_HASH_KEY?: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface HandlerOptions {
  /** Injectable pour les tests (mock siteverify). */
  fetchFn?: typeof fetch;
}

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_S = 3600;

const rateKey = (ip: string): string => `rl:report:${ip}`;

const MSG_MERCI =
  "Merci. Votre signalement a bien été reçu et sera examiné par l'équipe éditoriale.";
const MSG_HONEYPOT = MSG_MERCI; // 201 factice : indiscernable du succès réel.

function jsonResponse(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** CORS réfléchi (Origin rappelé tel quel, sans credentials) : le site statique et le worker vivent sur des origines distinctes. */
function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

interface ReportBody {
  entity?: unknown;
  date?: unknown;
  details?: unknown;
  source_url?: unknown;
  contact_email?: unknown;
  turnstile_token?: unknown;
  honeypot?: unknown;
}

interface ValidatedReport {
  entity: string;
  date: string | null;
  details: string;
  source_url: string;
  contact_email: string | null;
  turnstile_token: string;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const str = (value: unknown): string => (isString(value) ? value.trim() : '');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HTTP_URL_RE = /^https?:\/\/\S+\.\S+/i;

function validateReport(body: ReportBody): { report: ValidatedReport; errors: string[] } {
  const errors: string[] = [];

  const entity = str(body.entity);
  if (!entity) errors.push("Le champ « Entité » est obligatoire.");
  else if (entity.length > 200) errors.push("Le champ « Entité » est trop long (200 caractères max).");

  const dateRaw = str(body.date);
  let date: string | null = null;
  if (dateRaw) {
    if (!DATE_RE.test(dateRaw) || Number.isNaN(Date.parse(dateRaw))) {
      errors.push("La date doit être au format AAAA-MM-JJ.");
    } else {
      date = dateRaw;
    }
  }

  const details = str(body.details);
  if (!details) errors.push("Le champ « Ce qui a fuité » est obligatoire.");
  else if (details.length > 5000) errors.push("Le champ « Ce qui a fuité » est trop long (5000 caractères max).");

  const source_url = str(body.source_url);
  if (!source_url) errors.push("L'URL de la source publique est obligatoire.");
  else if (!HTTP_URL_RE.test(source_url) || null === new URL(source_url).protocol.match(/^https?:$/)) {
    errors.push("L'URL de la source publique doit être une URL http(s) valide.");
  }

  const contactRaw = str(body.contact_email);
  if (contactRaw && !EMAIL_RE.test(contactRaw)) {
    errors.push("L'email de contact semble invalide.");
  }

  const turnstile_token = str(body.turnstile_token);
  if (!turnstile_token) errors.push('La vérification anti-robot (Turnstile) est manquante.');

  return {
    report: {
      entity,
      date,
      details,
      source_url,
      contact_email: contactRaw || null,
      turnstile_token,
    },
    errors,
  };
}

/** Fail closed : réponse invalide, erreur réseau ou HTTP ≠ 200 → false. */
async function verifyTurnstile(
  token: string,
  ip: string,
  secret: string,
  fetchFn: typeof fetch,
): Promise<boolean> {
  const form = new URLSearchParams({ secret, response: token });
  if (ip !== 'unknown') form.set('remoteip', ip);
  try {
    const res = await fetchFn(SITEVERIFY_URL, { method: 'POST', body: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

/** Incrémente le compteur IP ; true si la requête passe, false si le quota est épuisé. */
async function consumeRateLimit(kv: KVNamespace, ip: string): Promise<boolean> {
  const key = rateKey(ip);
  const current = Number.parseInt((await kv.get(key)) ?? '0', 10);
  if (Number.isNaN(current) || current >= RATE_LIMIT_MAX) return false;
  await kv.put(key, String(current + 1), { expirationTtl: RATE_LIMIT_WINDOW_S });
  return true;
}

async function handleReport(request: Request, env: Env, fetchFn: typeof fetch): Promise<Response> {
  const cors = corsHeaders(request);

  let body: ReportBody;
  try {
    body = (await request.json()) as ReportBody;
  } catch {
    return jsonResponse(400, { ok: false, error: 'Corps de requête invalide : JSON attendu.' }, cors);
  }

  // 1. Honeypot rempli → robot : 201 factice, silencieusement jeté.
  if (str(body.honeypot)) {
    return jsonResponse(201, { ok: true, message: MSG_HONEYPOT }, cors);
  }

  // 2. Validation (FR) → 400.
  const { report, errors } = validateReport(body);
  if (errors.length > 0) {
    return jsonResponse(400, { ok: false, error: 'Certains champs sont invalides.', errors }, cors);
  }

  // 3. Secret Turnstile absent → 503 honnête.
  if (!env.TURNSTILE_SECRET) {
    return jsonResponse(
      503,
      { ok: false, error: 'Protection anti-abus non configurée. Merci de réessayer plus tard.' },
      cors,
    );
  }

  // 4. siteverify — fail closed.
  const ip = clientIp(request);
  const human = await verifyTurnstile(report.turnstile_token, ip, env.TURNSTILE_SECRET, fetchFn);
  if (!human) {
    return jsonResponse(
      403,
      { ok: false, error: 'Vérification anti-robot échouée. Rechargez la page et réessayez.' },
      cors,
    );
  }

  // 5. Rate limit 5/IP/h.
  if (!(await consumeRateLimit(env.RATE_LIMIT, ip))) {
    return jsonResponse(
      429,
      { ok: false, error: 'Trop de signalements depuis cette adresse. Merci de réessayer dans une heure.' },
      cors,
    );
  }

  // 6. Insertion candidat — métadonnées uniquement, jamais de données volées.
  const raw = JSON.stringify({
    entity: report.entity,
    date: report.date,
    details: report.details,
    source_url: report.source_url,
    contact_email: report.contact_email,
    submitted_at: new Date().toISOString(),
  });
  await env.DB
    .prepare(
      'INSERT INTO candidates (id, source, source_url, raw, entity_name, dedup_score, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(crypto.randomUUID(), 'signalement', report.source_url, raw, report.entity, null, 'NEW')
    .run();

  return jsonResponse(201, { ok: true, message: MSG_MERCI }, cors);
}

export async function handleRequest(
  request: Request,
  env: Env,
  options: HandlerOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(request),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (path === '/api/health' && request.method === 'GET') {
    return jsonResponse(200, { ok: true }, corsHeaders(request));
  }

  if (path === '/api/report' && request.method === 'POST') {
    return handleReport(request, env, options.fetchFn ?? fetch);
  }

  // Routes watchlist (T30/T31) — module dédié, mêmes conventions.
  if (
    path === '/api/watchlist' ||
    path === '/api/watchlist/status' ||
    path === '/api/watchlist/confirm' ||
    path === '/api/watchlist/prefs' ||
    path.startsWith('/api/watchlist/unsub/')
  ) {
    return handleWatchlistRequest(request, env, { fetchFn: options.fetchFn });
  }

  return jsonResponse(404, { ok: false, error: 'Introuvable.' }, corsHeaders(request));
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env);
  },
  // T31 : un SEUL cron « */15 » (plafond gratuit : 5 déclencheurs/compte).
  // Chaque tick lance le balayage « immédiat » ; le digest hebdo est plié
  // dedans — lundi 09:00 Europe/Paris (garde KV anti-double-envoi, heure
  // locale via Intl donc insensible au basculement DST).
  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await runInstantSweep(env);
    const now = new Date(controller.scheduledTime);
    if (doitLancerDigest(now) && env.RUN_STATE) {
      const cle = 'watchlist:digest:last_monday';
      const lundi = lundiParis(now);
      if ((await env.RUN_STATE.get(cle)) !== lundi) {
        await env.RUN_STATE.put(cle, lundi);
        await runWeeklyDigest(env, { now });
      }
    }
    // T52 : veille sociale interne — slots 07:00 et 19:00 Europe/Paris sur
    // le tick plein-heure, garde KV par slot/jour (plafond cron 5/compte :
    // pas de déclencheur dédié possible).
    const slot = slotVeilleSociale(now);
    if (slot && env.RUN_STATE) {
      const cle = `veille-sociale:slot:${new Intl.DateTimeFormat('fr-CA', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .format(now)
        .replaceAll('-', '')}:${slot}`;
      if ((await env.RUN_STATE.get(cle)) === null) {
        await env.RUN_STATE.put(cle, new Date().toISOString());
        await runVeilleSociale(env, slot, { now });
      }
    }
  },
};

/** Lundi, entre 09:00 et 09:14 Europe/Paris (le tick quart d'heure de 09:00 pile). */
export function doitLancerDigest(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    hour: '2-digit',
    hour12: false,
  }).format(now);
  return /lundi/.test(parts) && /09/.test(parts);
}

/** Identifiant du lundi en cours (Europe/Paris) pour la garde KV. */
function lundiParis(now: Date): string {
  const fmt = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [annee, mois, jour] = fmt.format(now).split('-');
  const base = new Date(Date.UTC(Number(annee), Number(mois) - 1, Number(jour)));
  while (base.getUTCDay() !== 1) base.setUTCDate(base.getUTCDate() - 1);
  return base.toISOString().slice(0, 10);
}
