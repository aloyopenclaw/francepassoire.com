// workers/social/src/index.ts — worker de publication sociale (T39+T40, Wave 5).
//
// Modèle « file d'attente » (docs/social-setup.md, § Principe) : la table D1
// social_outbox fait office d'outbox transactionnelle. L'intake est
// `enqueuePost` (appelé par le dispatcher d'alertes T38/T47) ; le vidage est
// le cron */5 min ci-dessous. Statuts de ligne :
//
//   PENDING       en file, à envoyer au prochain cron ;
//   PENDING_KEYS  secrétaire de plateforme absente — la ligne ATTEND la clé,
//                 ce n'est jamais un échec ni un blocage du lancement ;
//   SENT          publié (id externe loguée) ;
//   DEAD          lettre morte : 3 tentatives épuisées, erreur permanente
//                 (ex. 401), payload structurellement non postable, ou JSON
//                 illisible — chaque DEAD passe par console.error ;
//   INVALID       garde éditoriale violée : une fiche « revendiquée » sans
//                 la mention de non-confirmation ne se publie JAMAIS.
//
// Garde éditoriale (spécification Wave 5) : avant tout envoi, si
// payload.statut === 'revendiquée', le texte rendu DOIT contenir la mention
// exacte « revendication non confirmée par l'entité » (source unique :
// MENTION_REVENDICATION de src/lib/social-templates.ts — aucun risque de
// dérive entre le rendu et le contrôle).
//
// Tentatives : compteur attempts dans payload.metadata, incrémenté à chaque
// cron en échec. 3 échecs → DEAD. Les erreurs retryables (429/5xx/réseau)
// restent PENDING — le cron */5 min est le pacing naturel du backoff ; les
// erreurs permanentes (401/4xx) passent DEAD immédiatement.

import { MENTION_REVENDICATION } from '../../../src/lib/social-templates';
import { send as sendLinkedIn } from '../clients/linkedin';
import { send as sendTikTok } from '../clients/tiktok';
import { send as sendX } from '../clients/x';
import {
  PLATFORMES,
  type D1Database,
  type Env,
  type ExecutionContext,
  type PostPayload,
  type ScheduledController,
  type SendFn,
  type SendResult,
  type SocialPlatform,
} from './types';

/** Tentatives max par ligne (1 initiale + 2 retries au fil des crons). */
export const MAX_ATTEMPTS = 3;

// Clients branchés — T39 : X ; T40 : LinkedIn et TikTok.
const CLIENTS: Record<SocialPlatform, SendFn> = {
  x: sendX,
  linkedin: sendLinkedIn,
  tiktok: sendTikTok,
};

export interface OutboxRow {
  id: string;
  platform: string;
  payload: string;
}

/** Statut final d'une ligne après un passage de drain. */
export type RowOutcome = {
  id: string;
  platform: string;
  status: 'SENT' | 'PENDING' | 'PENDING_KEYS' | 'DEAD' | 'INVALID';
};

export interface DrainOptions {
  fetchFn?: typeof fetch;
}

const setStatus = (db: D1Database, id: string, status: string): Promise<void> =>
  db
    .prepare('UPDATE social_outbox SET status = ? WHERE id = ?')
    .bind(status, id)
    .run()
    .then(() => undefined);

/**
 * Intake de la file : insère une ligne PENDING. Appelé par le dispatcher
 * d'alertes/social (T38/T47) après rendu du texte par social-templates.
 * La garde de mention (fiche revendiquée) est vérifiée au DRAIN, pas ici —
 * l'intake ne rejette jamais, il met en file.
 */
export async function enqueuePost(
  db: D1Database,
  platform: SocialPlatform,
  payload: PostPayload,
  scheduledAt?: string,
): Promise<void> {
  if (!(PLATFORMES as readonly string[]).includes(platform)) {
    throw new Error(
      `Plateforme « ${String(platform)} » inconnue : seules ${PLATFORMES.join(', ')} sont mises en file.`,
    );
  }
  if (payload.text.trim() === '') {
    throw new Error('Payload sans texte : rien à mettre en file.');
  }
  if (payload.url.trim() === '') {
    throw new Error('Payload sans URL de fiche : un post sans lien ne se met pas en file.');
  }
  await db
    .prepare(
      'INSERT INTO social_outbox (id, platform, payload, status, scheduled_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(
      crypto.randomUUID(),
      platform,
      JSON.stringify(payload),
      'PENDING',
      scheduledAt ?? null,
    )
    .run();
}

/** Incrémente le compteur de tentatives ; DECIDE PENDING (rejoué au cron
 * suivant) ou DEAD (compteur épuisé / erreur permanente). */
async function enregistrerEchec(
  db: D1Database,
  row: OutboxRow,
  payload: PostPayload,
  retryable: boolean,
  reason: string,
): Promise<'PENDING' | 'DEAD'> {
  const attempts = (payload.metadata?.attempts ?? 0) + 1;
  const mort = !retryable || attempts >= MAX_ATTEMPTS;
  if (mort) {
    await setStatus(db, row.id, 'DEAD');
    console.error(
      `[social] ${row.platform} ligne ${row.id} DEAD après ${String(attempts)} tentative(s) : ${reason}`,
    );
    return 'DEAD';
  }
  const relu: PostPayload = {
    ...payload,
    metadata: { ...payload.metadata, attempts },
  };
  await db
    .prepare('UPDATE social_outbox SET payload = ? WHERE id = ?')
    .bind(JSON.stringify(relu), row.id)
    .run();
  console.error(
    `[social] ${row.platform} ligne ${row.id} échec ${String(attempts)}/${String(MAX_ATTEMPTS)}, rejouée au prochain cron : ${reason}`,
  );
  return 'PENDING';
}

async function processRow(
  row: OutboxRow,
  env: Env,
  fetchFn: typeof fetch,
): Promise<RowOutcome> {
  let payload: PostPayload;
  try {
    payload = JSON.parse(row.payload) as PostPayload;
  } catch (error) {
    await setStatus(env.DB, row.id, 'DEAD');
    console.error(`[social] ligne ${row.id} payload JSON illisible → DEAD`, error);
    return { id: row.id, platform: row.platform, status: 'DEAD' };
  }

  // Garde éditoriale : aucune allégation non vérifiée ne part sans sa
  // mention de prudence — même si le rendu amont est déjà sûr par contrat.
  if (payload.statut === 'revendiquee' && !payload.text.includes(MENTION_REVENDICATION)) {
    await setStatus(env.DB, row.id, 'INVALID');
    console.error(
      `[social] CAVEAT ligne ${row.id} (${row.platform}) : statut « revendiquée » sans la mention « ${MENTION_REVENDICATION} » → INVALID, jamais publié`,
    );
    return { id: row.id, platform: row.platform, status: 'INVALID' };
  }

  const send = CLIENTS[row.platform as SocialPlatform];

  let result: SendResult;
  try {
    result = await send(payload, env, fetchFn);
  } catch (error) {
    // Un bug de client n'arrête pas le drain — traité comme échec rejouable.
    return {
      id: row.id,
      platform: row.platform,
      status: await enregistrerEchec(
        env.DB,
        row,
        payload,
        true,
        `exception client : ${String(error)}`,
      ),
    };
  }

  switch (result.status) {
    case 'SENT': {
      await setStatus(env.DB, row.id, 'SENT');
      console.log(
        `[social] ${row.platform} ligne ${row.id} envoyée (id externe ${result.externalId ?? 'inconnue'})`,
      );
      return { id: row.id, platform: row.platform, status: 'SENT' };
    }
    case 'PENDING_KEYS': {
      await setStatus(env.DB, row.id, 'PENDING_KEYS');
      console.log(`[social] ${row.platform} ligne ${row.id} en attente de clés : ${result.reason}`);
      return { id: row.id, platform: row.platform, status: 'PENDING_KEYS' };
    }
    case 'UNSUPPORTED_PAYLOAD': {
      // Refus structurel honnête (ex. TikTok sans vidéo) : jamais un 500.
      await setStatus(env.DB, row.id, 'DEAD');
      console.error(
        `[social] ${row.platform} ligne ${row.id} payload non postable → DEAD : ${result.reason}`,
      );
      return { id: row.id, platform: row.platform, status: 'DEAD' };
    }
    case 'ERROR': {
      return {
        id: row.id,
        platform: row.platform,
        status: await enregistrerEchec(env.DB, row, payload, result.retryable, result.reason),
      };
    }
  }
}

/**
 * Vidage de la file : chaque cron lit les lignes PENDING/PENDING_KEYS dues
 * (scheduled_at NULL ou passé) et les traite une par une — isolation totale
 * : une ligne en échec n'empêche jamais les suivantes.
 */
export async function runDrain(
  env: Env,
  options: DrainOptions = {},
): Promise<RowOutcome[]> {
  const fetchFn = options.fetchFn ?? fetch;
  const maintenant = new Date().toISOString();
  const { results: rows } = await env.DB
    .prepare(
      "SELECT id, platform, payload FROM social_outbox WHERE status IN ('PENDING', 'PENDING_KEYS') AND (scheduled_at IS NULL OR scheduled_at <= ?) ORDER BY created_at",
    )
    .bind(maintenant)
    .all<OutboxRow>();

  const outcomes: RowOutcome[] = [];
  for (const row of rows) {
    try {
      outcomes.push(await processRow(row, env, fetchFn));
    } catch (error) {
      // Ceinture d'isolation D1 : le drain ne crash jamais sur une ligne.
      console.error(`[social] erreur inattendue ligne ${row.id}`, error);
      outcomes.push({ id: row.id, platform: row.platform, status: 'DEAD' });
    }
  }
  return outcomes;
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await runDrain(env);
  },
};
