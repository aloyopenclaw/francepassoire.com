// workers/api/src/watchlist.ts — veille par email (T30) + moteur d'alertes
// Brevo (T31, Wave 4). Routeur monté par index.ts, mêmes conventions que
// /api/report (fakes D1/KV testables, zéro dépendance runtime Cloudflare).
//
// T30 — double opt-in RGPD :
//   POST /api/watchlist            inscription (Turnstile → rate limit 3/IP/h
//                                  → validation FR → chiffrement → UPSERT →
//                                  email de confirmation Brevo avec lien HMAC
//                                  24 h). Sans BREVO_API_KEY → 503 AVANT
//                                  toute écriture (décision documentée : pas
//                                  de ligne orpheline qu'aucun email ne peut
//                                  confirmer — « no silent breakage »).
//   GET  /api/watchlist/status     {email_enabled} — l'îlot /proteger/ affiche
//                                  le formulaire ou l'avis d'activation (jamais
//                                  de futur prometteur : état factuel).
//   GET  /api/watchlist/confirm?token=   HMAC + TTL → confirmed_at → 302
//                                        /proteger/?veille=confirmee|invalide.
//   GET  /api/watchlist/unsub/<token>    désinscription 1 clic → 302
//                                        ?veille=desinscrit (aucun oracle sur
//                                        l'existence du jeton).
//   GET  /api/watchlist/prefs?token=     JSON {email masqué, prefs, confirmé}
//                                        — API que l'UI de préférences
//                                        (future page) consommera.
//
// T31 — alertes Brevo (API HTTPS v3 — le binding send_email Cloudflare est
// disqualifié par la sonde T29 : refus des destinations non vérifiées) :
//   runWeeklyDigest()   cron lundi 09:00 Europe/Paris (« 0 7 * * 1 » UTC) :
//                       fiches publiées les 7 derniers jours lues depuis
//                       https://francepassoire.com/api/v1/fiches.json
//                       (public, cache 1 h — aucune plomberie nouvelle), un
//                       email par abonné CONFIRMÉ dont les préférences
//                       matchent, pause 250 ms entre envois (~5 req/s Brevo),
//                       lien de désinscription dans chaque email (asserté en
//                       test). 429 Brevo → saut + log, aucun crash (le cron
//                       de la semaine suivante réessaie naturellement).
//   enqueueInstantAlert()  exporté, testé — le déclencheur (événement
//                       fiche-publish câblé en CI, T47) n'existe pas encore :
//                       le digest hebdo est le seul chemin live documenté.
//
// CRYPTO / CONVENTIONS (engageantes, docs/rgpd.md §1.2) :
//   email_hash  = sha256(trim(email).toLowerCase()) en hex — convention
//                 partagée avec scripts/erase-subscriber.mjs (effacement
//                 RGPD par email). NB : le plan T30 évoquait un HMAC pour la
//                 recherche ; on garde le hash documenté pour ne pas casser
//                 l'outil d'effacement — WATCHLIST_HASH_KEY reste la clé HMAC
//                 des jetons de confirmation.
//   email_enc   = AES-GCM 256 (WebCrypto), clé WATCHLIST_AES_KEY hex 32 octets
//                 (générer : openssl rand -hex 32). Jamais d'email en clair.
//   unsub_token = 32 octets aléatoires en hex.
//   confirm     = <email_hash>.<exp_ms>.<HMAC-SHA256(WATCHLIST_HASH_KEY,
//                 "watchlist-confirm:<email_hash>:<exp_ms>")>, TTL 24 h.

import type { D1Database, Env, KVNamespace } from './index';

// ---------------------------------------------------------------------------
// Constantes et copies locales (frontière worker ↔ src/lib — aucun import)
// ---------------------------------------------------------------------------

const SITE_URL = 'https://francepassoire.com';
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
const FICHES_URL = 'https://francepassoire.com/api/v1/fiches.json';
const SENDER_EMAIL = 'alerte@francepassoire.com';
const SENDER_NAME = 'France Passoire';

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_S = 3600;
const CONFIRM_TTL_MS = 24 * 3600 * 1000;
const DIGEST_WINDOW_DAYS = 7;
const SEND_PAUSE_MS = 250;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;
const HEX_32B_RE = /^[0-9a-fA-F]{64}$/;

// COPIE LOCALE (T30) de secteurEnum / dataTypeEnum (src/lib/fiche-schema.ts) :
// un worker n'importe jamais src/lib (frontière de build). Toute extension
// d'une énumération (contrat public) doit être répliquée ici.
const SECTEURS = [
  'sante', 'finance', 'retail', 'recherche', 'public',
  'industrie', 'services', 'media', 'autre',
] as const;
const DATA_TYPES = [
  'identite', 'coordonnees', 'sante', 'financier', 'credentials',
  'biometrique', 'documents', 'geolocalisation', 'autre',
] as const;
const FREQS = ['quotidien', 'hebdo'] as const;
type Freq = (typeof FREQS)[number];

// COPIE LOCALE (T30) de normalizeName + LEGAL_FORM_TOKENS (src/lib/entities.ts)
// pour apparier les entités libres des préférences aux fiches. Faire évoluer
// la règle à l'un endroit = l'évoluer à l'autre.
const LEGAL_FORM_TOKENS: ReadonlySet<string> = new Set([
  'sas', 'sasu', 'sarl', 'sa', 'eurl', 'ei', 'scm', 'snc', 'gie',
  'association', 'asso',
]);

export function normalizeEntityName(raw: string): string {
  const folded = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc\u2032'`´]/g, '')
    .replace(/[-–—/]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (folded === '') return '';
  const tokens = folded.split(' ');
  while (tokens.length > 1 && LEGAL_FORM_TOKENS.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(' ');
}

/** Sous-ensemble structurel d'une fiche du catalogue public fiches.json. */
export interface FicheDigest {
  slug: string;
  entity: string;
  secteur: string;
  data_types: string[];
  dates: { revendication: string; publication?: string };
  volume: { label: string };
}

export interface Prefs {
  sectors: string[];
  data_types: string[];
  entities: string[];
  freq: Freq;
}

export interface HandlerOptions {
  fetchFn?: typeof fetch;
}

export interface DigestOptions {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: Date;
  log?: (...args: unknown[]) => void;
}

// ---------------------------------------------------------------------------
// Crypto (WebCrypto — disponible en Workers et en Node ≥ 20 pour les tests)
// ---------------------------------------------------------------------------

const te = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toB64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(input: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(input))));
}

/** Convention engageante docs/rgpd.md §1.2 : sha256(trim(email).toLowerCase()). */
export async function emailHashOf(email: string): Promise<string> {
  return sha256Hex(email.trim().toLowerCase());
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    te.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, te.encode(message))));
}

export function randomTokenHex(bytes = 32): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function importAesKey(hexKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', hexToBytes(hexKey), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

/** email_enc = base64(iv 12 o).base64(chiffré AES-GCM 256). */
export async function encryptEmailAes(email: string, keyHex: string): Promise<string> {
  const key = await importAesKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(email)),
  );
  return `${toB64(iv)}.${toB64(cipher)}`;
}

export async function decryptEmailAes(payload: string, keyHex: string): Promise<string> {
  const [ivB64, cipherB64] = payload.split('.');
  if (!ivB64 || !cipherB64) throw new Error('email_enc mal formé');
  const key = await importAesKey(keyHex);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ivB64) },
    key,
    fromB64(cipherB64),
  );
  return new TextDecoder().decode(plain);
}

export async function mintConfirmToken(
  emailHash: string,
  key: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const exp = nowMs + CONFIRM_TTL_MS;
  const sig = await hmacSha256Hex(key, `watchlist-confirm:${emailHash}:${exp}`);
  return `${emailHash}.${exp}.${sig}`;
}

/** Jeton valide et non expiré → email_hash ; sinon null (fail closed). */
export async function verifyConfirmToken(
  token: string,
  key: string,
  nowMs: number = Date.now(),
): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [emailHash, expRaw, sig] = parts as [string, string, string];
  if (!/^[0-9a-f]{64}$/.test(emailHash) || !/^\d{1,15}$/.test(expRaw)) return null;
  const exp = Number(expRaw);
  if (exp < nowMs) return null;
  const expected = await hmacSha256Hex(key, `watchlist-confirm:${emailHash}:${expRaw}`);
  return sig === expected ? emailHash : null;
}

/** j***@exemple.fr — l'API prefs n'expose jamais l'adresse complète. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

// ---------------------------------------------------------------------------
// Réponses / helpers HTTP (mêmes conventions que index.ts)
// ---------------------------------------------------------------------------

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}

function redirect302(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

const isString = (value: unknown): value is string => typeof value === 'string';
const str = (value: unknown): string => (isString(value) ? value.trim() : '');

/** Fail closed — même contrat que index.ts (réponse invalide, réseau ou ≠ 200 → false). */
async function verifyTurnstile(
  token: string,
  ip: string,
  secret: string,
  fetchFn: typeof fetch,
): Promise<boolean> {
  const form = new URLSearchParams({ secret, response: token });
  if (ip !== 'unknown') form.set('remoteip', ip);
  try {
    const res = await fetchFn(SITEVERIFY_URL, {
      method: 'POST',
      body: form.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

/** Rate limit 3/IP/h — même mécanique que rl:report (KV, TTL glissant 3600 s). */
async function consumeWatchlistRateLimit(kv: KVNamespace, ip: string): Promise<boolean> {
  const key = `rl:watchlist:${ip}`;
  const current = Number.parseInt((await kv.get(key)) ?? '0', 10);
  if (Number.isNaN(current) || current >= RATE_LIMIT_MAX) return false;
  await kv.put(key, String(current + 1), { expirationTtl: RATE_LIMIT_WINDOW_S });
  return true;
}

// ---------------------------------------------------------------------------
// Envoi Brevo (API HTTPS v3 — décision propriétaire post-T29)
// ---------------------------------------------------------------------------

interface BrevoEmail {
  to: string;
  subject: string;
  textContent: string;
  htmlContent?: string;
}

export interface BrevoSendResult {
  ok: boolean;
  status: number;
}

/** POST /v3/smtp/email. Échec réseau ou HTTP ≠ 2xx → {ok:false} (jamais de throw). */
export async function sendBrevoEmail(
  apiKey: string,
  email: BrevoEmail,
  fetchFn: typeof fetch,
): Promise<BrevoSendResult> {
  try {
    const res = await fetchFn(BREVO_SEND_URL, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: email.to }],
        subject: email.subject,
        textContent: email.textContent,
        ...(email.htmlContent ? { htmlContent: email.htmlContent } : {}),
      }),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

// ---------------------------------------------------------------------------
// Validation de l'inscription
// ---------------------------------------------------------------------------

interface SubscribeBody {
  email?: unknown;
  sectors?: unknown;
  data_types?: unknown;
  entities?: unknown;
  freq?: unknown;
  turnstile_token?: unknown;
}

function stringArray(value: unknown, maxItems: number, errors: string[], label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => !isString(v))) {
    errors.push(`Le champ « ${label} » doit être une liste de textes.`);
    return [];
  }
  const trimmed = (value as string[]).map((v) => v.trim()).filter((v) => v !== '');
  if (trimmed.length > maxItems) {
    errors.push(`Le champ « ${label} » accepte au plus ${maxItems} valeurs.`);
    return [];
  }
  return [...new Set(trimmed)];
}

function validateSubscribe(body: SubscribeBody): {
  email: string;
  prefs: Prefs;
  turnstileToken: string;
  errors: string[];
} {
  const errors: string[] = [];

  const email = str(body.email);
  if (!email) errors.push("Le champ « Votre email » est obligatoire.");
  else if (!EMAIL_RE.test(email)) errors.push("L'adresse email semble invalide.");

  const sectors = stringArray(body.sectors, SECTEURS.length, errors, 'Secteurs');
  for (const s of sectors) {
    if (!(SECTEURS as readonly string[]).includes(s)) {
      errors.push(`Secteur inconnu : « ${s} ».`);
    }
  }

  const dataTypes = stringArray(body.data_types, DATA_TYPES.length, errors, 'Types de données');
  for (const d of dataTypes) {
    if (!(DATA_TYPES as readonly string[]).includes(d)) {
      errors.push(`Type de données inconnu : « ${d} ».`);
    }
  }

  const entities = stringArray(body.entities, 20, errors, 'Entités');
  for (const e of entities) {
    if (e.length > 200) {
      errors.push('Chaque entité surveillée doit tenir en 200 caractères.');
      break;
    }
  }

  let freq: Freq = 'hebdo';
  const freqRaw = str(body.freq);
  if (freqRaw !== '' && !(FREQS as readonly string[]).includes(freqRaw)) {
    errors.push('La fréquence doit être « quotidien » ou « hebdo ».');
  } else if (freqRaw !== '') {
    freq = freqRaw as Freq;
  }

  const turnstileToken = str(body.turnstile_token);
  if (!turnstileToken) errors.push('La vérification anti-robot (Turnstile) est manquante.');

  return { email, prefs: { sectors, data_types: dataTypes, entities, freq }, turnstileToken, errors };
}

// ---------------------------------------------------------------------------
// POST /api/watchlist — inscription double opt-in
// ---------------------------------------------------------------------------

const MSG_ACTIVATION =
  'Veille par email : activation en cours. En attendant, les outils de veille de la page Se protéger restent disponibles.';

async function selectFirst<T>(
  db: D1Database,
  sql: string,
  ...params: string[]
): Promise<T | null> {
  const stmt = db.prepare(sql).bind(...params);
  const row = stmt.first ? await stmt.first() : null;
  return (row as T | undefined) ?? null;
}

async function handleSubscribe(
  request: Request,
  env: Env,
  fetchFn: typeof fetch,
): Promise<Response> {
  const cors = corsHeaders(request);

  let body: SubscribeBody;
  try {
    body = (await request.json()) as SubscribeBody;
  } catch {
    return jsonResponse(400, { ok: false, error: 'Corps de requête invalide : JSON attendu.' }, cors);
  }

  // Même cascade que /api/report (messages FR, fail closed) : validation →
  // secret absent → siteverify → rate limit ; puis (T30) secrets d'envoi
  // absents → 503 AVANT toute écriture D1.
  const { email, prefs, turnstileToken, errors } = validateSubscribe(body);
  if (errors.length > 0) {
    return jsonResponse(400, { ok: false, error: 'Certains champs sont invalides.', errors }, cors);
  }

  if (!env.TURNSTILE_SECRET) {
    return jsonResponse(
      503,
      { ok: false, error: 'Protection anti-abus non configurée. Merci de réessayer plus tard.' },
      cors,
    );
  }

  const ip = clientIp(request);
  const human = await verifyTurnstile(turnstileToken, ip, env.TURNSTILE_SECRET, fetchFn);
  if (!human) {
    return jsonResponse(
      403,
      { ok: false, error: 'Vérification anti-robot échouée. Rechargez la page et réessayez.' },
      cors,
    );
  }

  // Rate limit 3/IP/h (clé rl:watchlist:<ip>, distincte de rl:report).
  if (!(await consumeWatchlistRateLimit(env.RATE_LIMIT, ip))) {
    return jsonResponse(
      429,
      { ok: false, error: 'Trop de demandes depuis cette adresse. Merci de réessayer dans une heure.' },
      cors,
    );
  }

  // 3. Secrets d'envoi/de stockage absents → 503 AVANT toute écriture D1
  //    (décision T30 : aucune ligne orpheline qu'aucun email ne saurait
  //    confirmer — /proteger/ reste honnête à chaque instant).
  if (!env.BREVO_API_KEY) {
    return jsonResponse(503, { ok: false, error: MSG_ACTIVATION }, cors);
  }
  if (!env.WATCHLIST_AES_KEY || !HEX_32B_RE.test(env.WATCHLIST_AES_KEY)) {
    return jsonResponse(
      503,
      { ok: false, error: 'Le stockage sécurisé de la veille est mal configuré. Merci de réessayer plus tard.' },
      cors,
    );
  }
  if (!env.WATCHLIST_HASH_KEY) {
    return jsonResponse(503, { ok: false, error: MSG_ACTIVATION }, cors);
  }

  // 4. Crypto : hash (convention rgpd.md), chiffrement, jeton de désinscription.
  const emailHash = await emailHashOf(email);
  const emailEnc = await encryptEmailAes(email, env.WATCHLIST_AES_KEY);
  const unsubToken = randomTokenHex(32);
  const prefsJson = JSON.stringify(prefs);

  // 5. UPSERT : déjà inscrit → préférences mises à jour + jeton régénéré,
  //    confirmed_at conservé ; sinon insertion non confirmée.
  const existing = await selectFirst<{ id: string }>(
    env.DB,
    'SELECT id FROM subscribers WHERE email_hash = ?',
    emailHash,
  );
  if (existing) {
    await env.DB
      .prepare('UPDATE subscribers SET prefs_json = ?, unsub_token = ? WHERE email_hash = ?')
      .bind(prefsJson, unsubToken, emailHash)
      .run();
  } else {
    await env.DB
      .prepare(
        'INSERT INTO subscribers (id, email_hash, email_enc, confirmed_at, unsub_token, prefs_json) VALUES (?, ?, ?, NULL, ?, ?)',
      )
      .bind(crypto.randomUUID(), emailHash, emailEnc, unsubToken, prefsJson)
      .run();
  }

  // 6. Email de confirmation (lien HMAC 24 h) — un échec d'envoi ne se
  //    déguise jamais en succès : 502, la ligne non confirmée reste
  //    récupérable en réessayant l'inscription (nouveau jeton, renvoi).
  const confirmToken = await mintConfirmToken(emailHash, env.WATCHLIST_HASH_KEY);
  const confirmUrl = `${SITE_URL}/api/watchlist/confirm?token=${encodeURIComponent(confirmToken)}`;
  const text = [
    'Bonjour,',
    '',
    'Vous avez demandé à recevoir la veille FrancePassoire (fuites de données touchant la France).',
    'Pour activer votre veille, cliquez sur ce bouton dans les 24 heures :',
    '',
    confirmUrl,
    '',
    'Si vous n\'êtes pas à l\'origine de cette demande, ignorez simplement cet email : rien ne sera activé.',
    '',
    'Vos données et vos droits : votre adresse email sert uniquement à vous envoyer ces alertes',
    '(base légale : consentement, double opt-in). Désinscription en un clic dans chaque email,',
    'ou écrivez à contact@francepassoire.com (réponse sous 30 jours). Aucune donnée de victimes',
    'de fuites n\'est collectée, hébergée ou reproduite par FrancePassoire.',
  ].join('\n');

  const html = [
    '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Confirmez votre veille France Passoire</title></head>',
    '<body style="margin:0; padding:0; background-color:#FFF9F2; font-family: Arial, Helvetica, sans-serif; -webkit-font-smoothing: antialiased;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF9F2; padding: 40px 16px;"><tr><td align="center">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%; background-color:#FFF6EA; border: 3px solid #241405; border-radius: 20px; box-shadow: 6px 6px 0px 0px #241405; overflow: hidden;">',
    '<tr><td style="background-color:#FF6B1A; background-image: radial-gradient(circle, #241405 1.5px, transparent 1.5px); background-size: 22px 22px; border-bottom: 3px solid #241405; padding: 32px; text-align: center;">',
    '<p style="margin:0; font-family: \'Arial Black\', Impact, sans-serif; font-size: 28px; font-weight: 900; color: #241405; letter-spacing: -1px; text-transform: uppercase;">FRANCEPASSOIRE</p>',
    '<p style="margin: 8px 0 0; font-family: \'Courier New\', Courier, monospace; font-size: 14px; font-weight: bold; color: #241405; background-color: #FFF6EA; display: inline-block; padding: 4px 12px; border: 2px solid #241405; border-radius: 50px;">LA VEILLE ANTI-FUITES</p>',
    '</td></tr>',
    '<tr><td style="padding: 40px 32px 24px; color: #241405; font-size: 16px; line-height: 1.6;">',
    '<h1 style="margin: 0 0 20px; font-family: \'Arial Black\', Impact, sans-serif; font-size: 22px; font-weight: 900; letter-spacing: -0.5px; line-height: 1.2;">Plus qu\'un clic pour surveiller vos arrières.</h1>',
    '<p style="margin: 0 0 16px;">Bonjour,</p>',
    '<p style="margin: 0 0 16px;">Vous avez demandé à ce qu\'on vous prévienne quand la passoire fuit. C\'est une excellente idée pour reprendre le contrôle.</p>',
    '<p style="margin: 0 0 24px;">Pour des raisons évidentes de sécurité (on ne va pas vous spammer sans votre accord formel), il nous faut une petite confirmation. Cliquez sur le bouton ci-dessous pour valider :</p>',
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto 32px;"><tr>',
    '<td align="center" style="background-color: #FF6B1A; border: 3px solid #241405; border-radius: 12px; box-shadow: 4px 4px 0px 0px #241405;">',
    `<a href="${confirmUrl}" style="display: inline-block; padding: 18px 32px; color: #241405; font-family: 'Arial Black', Impact, sans-serif; font-weight: 900; font-size: 16px; text-decoration: none; text-transform: uppercase; letter-spacing: 0.5px;">Activer ma veille</a>`,
    '</td></tr></table>',
    '<div style="background-color: #FFF9F2; border: 2px dashed #241405; border-radius: 12px; padding: 16px; margin-bottom: 24px;">',
    '<p style="margin: 0 0 8px; font-family: \'Courier New\', Courier, monospace; font-size: 12px; font-weight: bold; color: #241405;">Le bouton fait grève ? Copiez-collez ce lien (valable 24h) :</p>',
    `<p style="margin: 0; font-family: 'Courier New', Courier, monospace; font-size: 12px; word-break: break-all;"><a href="${confirmUrl}" style="color: #E85A0C; font-weight: bold;">${confirmUrl}</a></p>`,
    '</div>',
    '<p style="margin: 0; font-size: 14px; opacity: 0.8;"><em>Si vous n\'avez rien demandé, jetez simplement cet email. Rien ne sera activé.</em></p>',
    '</td></tr>',
    '<tr><td style="padding: 24px 32px; background-color: #241405; color: #FFF6EA; border-top: 3px solid #241405;">',
    '<p style="margin: 0; font-family: \'Courier New\', Courier, monospace; font-size: 11px; line-height: 1.5; opacity: 0.8;"><strong>Transparence :</strong> Votre email sert uniquement à vous envoyer ces alertes. Il n\'est pas croisé, ni revendu. Désinscription garantie en un clic dans chaque email. Aucune donnée de victimes n\'est hébergée chez nous.</p>',
    '</td></tr>',
    '</table>',
    '<p style="margin: 24px 0 0; font-family: \'Courier New\', Courier, monospace; font-size: 12px; font-weight: bold; color: #241405; opacity: 0.6;">© 2026 FrancePassoire — Projet citoyen</p>',
    '</td></tr></table></body></html>',
  ].join('');

  const sent = await sendBrevoEmail(
    env.BREVO_API_KEY,
    { to: email, subject: '🏷️ Confirmez votre veille FrancePassoire (24 h)', textContent: text, htmlContent: html },
    fetchFn,
  );
  if (!sent.ok) {
    return jsonResponse(
      502,
      { ok: false, error: "L'email de confirmation n'a pas pu être envoyé. Merci de réessayer dans quelques instants." },
      cors,
    );
  }

  return jsonResponse(
    201,
    {
      ok: true,
      message:
        'Presque ! Ouvrez votre boîte mail et cliquez sur le lien de confirmation pour activer votre veille (valable 24 heures).',
    },
    cors,
  );
}

// ---------------------------------------------------------------------------
// GET confirm / unsub / prefs / status
// ---------------------------------------------------------------------------

async function handleConfirm(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const emailHash = env.WATCHLIST_HASH_KEY
    ? await verifyConfirmToken(token, env.WATCHLIST_HASH_KEY)
    : null;
  if (!emailHash) return redirect302(`${SITE_URL}/proteger/?veille=invalide`);

  const row = await selectFirst<{ id: string }>(
    env.DB,
    'SELECT id FROM subscribers WHERE email_hash = ?',
    emailHash,
  );
  if (!row) return redirect302(`${SITE_URL}/proteger/?veille=invalide`);

  await env.DB
    .prepare('UPDATE subscribers SET confirmed_at = COALESCE(confirmed_at, ?) WHERE email_hash = ?')
    .bind(new Date().toISOString(), emailHash)
    .run();
  return redirect302(`${SITE_URL}/proteger/?veille=confirmee`);
}

async function handleUnsub(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).pathname.replace(/^\/api\/watchlist\/unsub\//, '');
  if (!TOKEN_RE.test(token)) return redirect302(`${SITE_URL}/proteger/?veille=invalide`);
  // Jeton bien formé mais inconnu → même 302 « desinscrit » : aucun oracle
  // sur l'existence d'un abonnement (désinscription = idempotente).
  await env.DB.prepare('DELETE FROM subscribers WHERE unsub_token = ?').bind(token).run();
  return redirect302(`${SITE_URL}/proteger/?veille=desinscrit`);
}

async function handlePrefs(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request);
  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!TOKEN_RE.test(token)) {
    return jsonResponse(400, { ok: false, error: 'Jeton de préférences manquant ou invalide.' }, cors);
  }
  if (!env.WATCHLIST_AES_KEY || !HEX_32B_RE.test(env.WATCHLIST_AES_KEY)) {
    return jsonResponse(
      503,
      { ok: false, error: 'Le service de veille est mal configuré. Merci de réessayer plus tard.' },
      cors,
    );
  }
  const row = await selectFirst<{
    email_enc: string;
    confirmed_at: string | null;
    prefs_json: string;
  }>(env.DB, 'SELECT email_enc, confirmed_at, prefs_json FROM subscribers WHERE unsub_token = ?', token);
  if (!row) {
    return jsonResponse(404, { ok: false, error: 'Jeton inconnu.' }, cors);
  }
  let email = '';
  try {
    email = await decryptEmailAes(row.email_enc, env.WATCHLIST_AES_KEY);
  } catch {
    return jsonResponse(500, { ok: false, error: 'Lecture de la préférence impossible.' }, cors);
  }
  return jsonResponse(
    200,
    {
      ok: true,
      email: maskEmail(email),
      confirmed: row.confirmed_at !== null,
      prefs: JSON.parse(row.prefs_json) as Prefs,
    },
    cors,
  );
}

function handleStatus(request: Request, env: Env): Response {
  const emailEnabled = Boolean(
    env.TURNSTILE_SECRET && env.BREVO_API_KEY && env.WATCHLIST_AES_KEY && env.WATCHLIST_HASH_KEY,
  );
  return jsonResponse(200, { ok: true, email_enabled: emailEnabled }, corsHeaders(request));
}

// ---------------------------------------------------------------------------
// Routeur watchlist (monté par index.ts)
// ---------------------------------------------------------------------------

export async function handleWatchlistRequest(
  request: Request,
  env: Env,
  options: HandlerOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const fetchFn = options.fetchFn ?? fetch;

  if (path === '/api/watchlist' && request.method === 'POST') {
    return handleSubscribe(request, env, fetchFn);
  }
  if (path === '/api/watchlist/status' && request.method === 'GET') {
    return handleStatus(request, env);
  }
  if (path === '/api/watchlist/confirm' && request.method === 'GET') {
    return handleConfirm(request, env);
  }
  if (path.startsWith('/api/watchlist/unsub/') && request.method === 'GET') {
    return handleUnsub(request, env);
  }
  if (path === '/api/watchlist/prefs' && request.method === 'GET') {
    return handlePrefs(request, env);
  }
  return jsonResponse(404, { ok: false, error: 'Introuvable.' }, corsHeaders(request));
}

// ---------------------------------------------------------------------------
// T31 — moteur d'alertes : correspondance préférences ↔ fiches
// ---------------------------------------------------------------------------

interface SubscriberRow {
  id: string;
  email_hash: string;
  email_enc: string;
  unsub_token: string;
  prefs_json: string;
}

/** Date d'attribution d'une fiche : publication à défaut de revendication
 * (même règle que src/lib/opendata.ts dateAttribution — copie locale). */
function dateAttribution(fiche: FicheDigest): string {
  return fiche.dates.publication ?? fiche.dates.revendication;
}

function parsePrefs(raw: string): Prefs {
  try {
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      sectors: Array.isArray(parsed.sectors) ? parsed.sectors : [],
      data_types: Array.isArray(parsed.data_types) ? parsed.data_types : [],
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      freq: parsed.freq === 'quotidien' ? 'quotidien' : 'hebdo',
    };
  } catch {
    return { sectors: [], data_types: [], entities: [], freq: 'hebdo' };
  }
}

/** Filtres vides = critère « tout » ; entités appariées sur la forme normalisée. */
export function ficheMatchesPrefs(fiche: FicheDigest, prefs: Prefs): boolean {
  if (prefs.sectors.length > 0 && !prefs.sectors.includes(fiche.secteur)) return false;
  if (
    prefs.data_types.length > 0 &&
    !fiche.data_types.some((d) => prefs.data_types.includes(d))
  ) {
    return false;
  }
  if (prefs.entities.length > 0) {
    const ficheEntity = normalizeEntityName(fiche.entity);
    if (!prefs.entities.some((e) => normalizeEntityName(e) === ficheEntity)) return false;
  }
  return true;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function ficheUrl(fiche: FicheDigest): string {
  return `${SITE_URL}/fiche/${fiche.slug}/`;
}

function unsubUrlOf(token: string): string {
  return `${SITE_URL}/api/watchlist/unsub/${token}`;
}

/** Fiches de la fenêtre de 7 jours glissantes, tri récent d'abord. */
function fichesDeLaSemaine(fiches: readonly FicheDigest[], now: Date): FicheDigest[] {
  const cutoff = new Date(now.getTime() - DIGEST_WINDOW_DAYS * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  return fiches
    .filter((f) => dateAttribution(f) >= cutoff)
    .sort((a, b) => dateAttribution(b).localeCompare(dateAttribution(a)));
}

// gabarit email-client-safe : tableaux + styles inline uniquement, sobre.
export function renderDigestHtml(fiches: readonly FicheDigest[], unsubUrl: string): string {
  const rows = fiches
    .map(
      (f) =>
        `        <tr>` +
        `<td style="padding:10px 8px;border-bottom:1px solid #e8ddcc;font-family:Arial,Helvetica,sans-serif;font-size:14px;">` +
        `<strong>${escapeHtml(f.entity)}</strong><br>` +
        `<span style="color:#6b5b45;">${escapeHtml(dateAttribution(f))} — ${escapeHtml(f.volume.label)}</span>` +
        `</td>` +
        `<td style="padding:10px 8px;border-bottom:1px solid #e8ddcc;text-align:right;">` +
        `<a href="${ficheUrl(f)}" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#E85A0C;">Voir la fiche</a>` +
        `</td></tr>`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="fr">
  <body style="margin:0;padding:0;background-color:#FFF9F2;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF9F2;">
      <tr>
        <td style="padding:24px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" align="center" style="width:600px;max-width:100%;background-color:#ffffff;border:2px solid #241405;">
            <tr>
              <td style="padding:20px 24px;background-color:#FF6B1A;border-bottom:2px solid #241405;">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#241405;">FrancePassoire</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <h1 style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:20px;color:#241405;">Votre veille de la semaine</h1>
                <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#241405;">
                  ${fiches.length} nouvelle${fiches.length > 1 ? 's' : ''} fiche${fiches.length > 1 ? 's' : ''} publiée${fiches.length > 1 ? 's' : ''} cette semaine correspondent à votre veille.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${rows}
                </table>
                <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#241405;">
                  <strong>Le geste de la semaine :</strong> un mot de passe long et unique par compte — un gestionnaire de mots de passe suffit à tous les retenir.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;border-top:2px solid #241405;background-color:#FFF6EA;">
                <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#241405;">
                  Vous recevez cet email parce que vous avez activé la veille FrancePassoire (double opt-in).
                </p>
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;">
                  <a href="${unsubUrl}" style="color:#E85A0C;">Se désinscrire en un clic</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderDigestText(fiches: readonly FicheDigest[], unsubUrl: string): string {
  const lignes = fiches.map(
    (f) => `- ${f.entity} (${dateAttribution(f)}, ${f.volume.label}) : ${ficheUrl(f)}`,
  );
  return [
    'Votre veille FrancePassoire de la semaine',
    '',
    `${fiches.length} nouvelle(s) fiche(s) publiée(s) correspondent à votre veille :`,
    ...lignes,
    '',
    'Le geste de la semaine : un mot de passe long et unique par compte.',
    '',
    'Désinscription en un clic :',
    unsubUrl,
  ].join('\n');
}

async function confirmedSubscribers(db: D1Database): Promise<SubscriberRow[]> {
  const stmt = db.prepare(
    'SELECT id, email_hash, email_enc, unsub_token, prefs_json FROM subscribers WHERE confirmed_at IS NOT NULL',
  );
  const rows = stmt.all ? ((await stmt.all()) as SubscriberRow[]) : [];
  return rows;
}

/**
 * Digest hebdo (cron lundi 09:00 Europe/Paris). Un email par abonné CONFIRMÉ
 * dont les préférences matchent au moins une fiche de la semaine. Aucun
 * envoi aux non-confirmés (query assert en test) ; lien de désinscription
 * présent dans chaque rendu (asserté) ; 429/échec Brevo → saut + log sans
 * crash ; secrets absents → sortie propre (honnête, pas de crash).
 */
export async function runWeeklyDigest(
  env: Env,
  options: DigestOptions = {},
): Promise<{ sent: number; skipped: number; reason?: string }> {
  const fetchFn = options.fetchFn ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = options.now ?? new Date();
  const log = options.log ?? console.log;

  if (!env.BREVO_API_KEY) {
    log('digest: BREVO_API_KEY absent — aucun envoi (sortie propre)');
    return { sent: 0, skipped: 0, reason: 'brevo-absent' };
  }
  if (!env.WATCHLIST_AES_KEY || !HEX_32B_RE.test(env.WATCHLIST_AES_KEY)) {
    log('digest: WATCHLIST_AES_KEY absent/ invalide — aucun envoi (sortie propre)');
    return { sent: 0, skipped: 0, reason: 'aes-absent' };
  }

  // Catalogue public (cache 1 h servi par le site) : aucune plomberie
  // nouvelle — le worker lit ce que tout le monde peut lire.
  let fiches: FicheDigest[] = [];
  try {
    const res = await fetchFn(FICHES_URL, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`fiches.json HTTP ${res.status}`);
    const payload = (await res.json()) as { fiches?: FicheDigest[] };
    fiches = Array.isArray(payload.fiches) ? payload.fiches : [];
  } catch (e) {
    log('digest: fiches.json indisponible —', e);
    return { sent: 0, skipped: 0, reason: 'fiches-indisponibles' };
  }

  const semaine = fichesDeLaSemaine(fiches, now);
  if (semaine.length === 0) {
    log('digest: aucune fiche publiée dans les 7 derniers jours — aucun envoi');
    return { sent: 0, skipped: 0, reason: 'semaine-vide' };
  }

  const abonnes = await confirmedSubscribers(env.DB);
  let sent = 0;
  let skipped = 0;

  for (const abonne of abonnes) {
    const prefs = parsePrefs(abonne.prefs_json);
    const fichesAbonne = semaine.filter((f) => ficheMatchesPrefs(f, prefs));
    if (fichesAbonne.length === 0) {
      skipped += 1;
      continue;
    }
    let email = '';
    try {
      email = await decryptEmailAes(abonne.email_enc, env.WATCHLIST_AES_KEY);
    } catch {
      log('digest: email_enc illisible pour', abonne.id, '— saut');
      skipped += 1;
      continue;
    }
    const unsubUrl = unsubUrlOf(abonne.unsub_token);
    const result = await sendBrevoEmail(
      env.BREVO_API_KEY,
      {
        to: email,
        subject: 'Votre veille FrancePassoire — la semaine des fuites',
        textContent: renderDigestText(fichesAbonne, unsubUrl),
        htmlContent: renderDigestHtml(fichesAbonne, unsubUrl),
      },
      fetchFn,
    );
    if (result.ok) {
      sent += 1;
    } else {
      // 429/quota Brevo ou erreur : saut + log — le cron suivant réessaie
      // naturellement, aucun état bloquant.
      log('digest: envoi Brevo refusé (HTTP', result.status, ') pour', abonne.id, '— saut');
      skipped += 1;
    }
    await sleep(SEND_PAUSE_MS);
  }

  log(`digest: ${sent} envoi(s), ${skipped} saut(s), ${abonnes.length} abonné(s) confirmé(s)`);
  return { sent, skipped };
}

/**
 * Alerte instantanée (T31) — appelée à la publication d'une fiche.
 * DÉCLENCHEUR NON CÂBLÉ : le raccordement (événement fiche-publish en CI,
 * T47) n'existe pas encore ; cette fonction est le contrat testé que ce
 * câblage invoquera. Ne sélectionne que les abonnés CONFIRMÉS de fréquence
 * « quotidien » dont les préférences matchent la fiche.
 */
export async function enqueueInstantAlert(
  fiche: FicheDigest,
  env: Env,
  options: HandlerOptions & { sleep?: (ms: number) => Promise<void>; log?: (...args: unknown[]) => void } = {},
): Promise<{ matched: number; sent: number }> {
  const fetchFn = options.fetchFn ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = options.log ?? console.log;

  if (!env.BREVO_API_KEY || !env.WATCHLIST_AES_KEY || !HEX_32B_RE.test(env.WATCHLIST_AES_KEY)) {
    log('instant: secrets Brevo/AES absents — aucun envoi');
    return { matched: 0, sent: 0 };
  }

  const abonnes = (await confirmedSubscribers(env.DB)).filter((a) => {
    const prefs = parsePrefs(a.prefs_json);
    return prefs.freq === 'quotidien' && ficheMatchesPrefs(fiche, prefs);
  });

  let sent = 0;
  for (const abonne of abonnes) {
    let email = '';
    try {
      email = await decryptEmailAes(abonne.email_enc, env.WATCHLIST_AES_KEY);
    } catch {
      log('instant: email_enc illisible pour', abonne.id, '— saut');
      continue;
    }
    const unsubUrl = unsubUrlOf(abonne.unsub_token);
    const result = await sendBrevoEmail(
      env.BREVO_API_KEY,
      {
        to: email,
        subject: `FrancePassoire — nouvelle fuite : ${fiche.entity}`,
        textContent: renderDigestText([fiche], unsubUrl),
        htmlContent: renderDigestHtml([fiche], unsubUrl),
      },
      fetchFn,
    );
    if (result.ok) sent += 1;
    else log('instant: envoi Brevo refusé (HTTP', result.status, ') pour', abonne.id, '— saut');
    await sleep(SEND_PAUSE_MS);
  }

  return { matched: abonnes.length, sent };
}
