// workers/social/clients/bluesky.ts — client de publication Bluesky (AT
// Protocol), T38. Aucun SDK : l'atproto est du HTTP+JSON simple (spéc.
// publique https://atproto.com/specs/xrpc) — deux appels fetch suffisent,
// aucune dépendance ajoutée au projet.
//
// Authentification (docs.bsky.app, tutoriel « Creating a post ») :
//  1. POST /xrpc/com.atproto.server.createSession {identifier, password} →
//     {accessJwt, did}. Le mot de passe est un MOT DE PASSE D'APPLICATION
//     (bsky.app › Réglages › Confidentialité et sécurité › Mots de passe
//     d'application) — JAMAIS le mot de passe du compte ;
//  2. POST /xrpc/com.atproto.repo.createRecord {repo: did, collection
//     app.bsky.feed.post, record {text, createdAt, embed}} avec
//     Authorization: Bearer <accessJwt> → 200/201 {uri: at://…}.
// L'URL de la fiche voyage en carte de lien (app.bsky.embed.external). Le
// texte rendu (≤ 260, src/lib/social-templates.ts) est sous la limite
// Bluesky de 300 graphèmes — aucun redécoupage ici.
//
// Tant que BLUESKY_HANDLE ou BLUESKY_APP_PASSWORD est absent → PENDING_KEYS :
// la ligne reste en file, le lancement n'est jamais bloqué (le propriétaire
// active le compte en créant son mot de passe d'application).
// createRecord 401 (jeton expiré) → UNE relance de session puis UN seul
// retry ; encore 401 → permanent. 429/5xx → rejouable au cron suivant.

import type { Env, PostPayload, SendFn, SendResult } from '../src/types';

export const BSKY_SESSION_ENDPOINT =
  'https://bsky.social/xrpc/com.atproto.server.createSession';
export const BSKY_CREATE_RECORD_ENDPOINT =
  'https://bsky.social/xrpc/com.atproto.repo.createRecord';
export const BSKY_POST_COLLECTION = 'app.bsky.feed.post';
/** Titre fixe de la carte de lien app.bsky.embed.external. */
export const BSKY_EMBED_TITLE = 'FrancePassoire — fiche de fuite de données';
export const BSKY_EMBED_DESCRIPTION =
  'Observatoire citoyen et indépendant des fuites de données personnelles en France';

interface SessionBsky {
  accessJwt?: string;
  refreshJwt?: string;
  did?: string;
}

interface RecordCree {
  uri?: string;
}

function classify(status: number): { retryable: boolean } {
  // 429 et 5xx : plateforme/throttling, rejouables au cron suivant ; le
  // reste (401 identifiants morts, 400 payload refusé) est permanent.
  return { retryable: status === 429 || status >= 500 };
}

/** Lecture JSON tolérante : un corps non JSON vaut null, jamais d'exception. */
async function lireJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

interface SessionOuverte {
  accessJwt: string;
  did: string;
}

type OuvertureSession = { session: SessionOuverte } | { erreur: SendResult };

async function ouvrirSession(
  env: Env,
  fetchFn: typeof fetch,
): Promise<OuvertureSession> {
  let response: Response;
  try {
    response = await fetchFn(BSKY_SESSION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: env.BLUESKY_HANDLE,
        password: env.BLUESKY_APP_PASSWORD,
      }),
    });
  } catch (error) {
    return {
      erreur: {
        status: 'ERROR',
        retryable: true,
        reason: `réseau Bluesky indisponible : ${String(error)}`,
      },
    };
  }
  if (response.status !== 200) {
    const detail = JSON.stringify(await lireJson(response)).slice(0, 300);
    return {
      erreur: {
        status: 'ERROR',
        retryable: classify(response.status).retryable,
        reason: `createSession → ${String(response.status)} : ${detail}`,
      },
    };
  }
  const body = (await lireJson(response)) as SessionBsky | null;
  if (body?.accessJwt === undefined || body.did === undefined) {
    return {
      erreur: {
        status: 'ERROR',
        retryable: false,
        reason: 'createSession 200 incomplet : accessJwt/did absents de la réponse',
      },
    };
  }
  return { session: { accessJwt: body.accessJwt, did: body.did } };
}

type VerdictRecord =
  | { statut: 'publie'; uri?: string }
  | { statut: 'session-expiree' }
  | { statut: 'erreur'; resultat: SendResult };

async function creerRecord(
  session: SessionOuverte,
  payload: PostPayload,
  fetchFn: typeof fetch,
): Promise<VerdictRecord> {
  let response: Response;
  try {
    response = await fetchFn(BSKY_CREATE_RECORD_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessJwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repo: session.did,
        collection: BSKY_POST_COLLECTION,
        record: {
          text: payload.text,
          createdAt: new Date().toISOString(),
          embed: {
            $type: 'app.bsky.embed.external',
            external: {
              uri: payload.url,
              title: BSKY_EMBED_TITLE,
              // Lexicon app.bsky.embed.external : « description » est REQUISE
              // (une chaîne vide passe, son ABSENCE vaut 400 InvalidRequest →
              // classé permanent → DEAD — bug du premier post, corrigé ici).
              description: BSKY_EMBED_DESCRIPTION,
            },
          },
        },
      }),
    });
  } catch (error) {
    return {
      statut: 'erreur',
      resultat: {
        status: 'ERROR',
        retryable: true,
        reason: `réseau Bluesky indisponible : ${String(error)}`,
      },
    };
  }
  if (response.status === 401) {
    return { statut: 'session-expiree' };
  }
  if (response.status === 200 || response.status === 201) {
    const body = (await lireJson(response)) as RecordCree | null;
    return { statut: 'publie', uri: body?.uri };
  }
  const detail = JSON.stringify(await lireJson(response)).slice(0, 300);
  return {
    statut: 'erreur',
    resultat: {
      status: 'ERROR',
      retryable: classify(response.status).retryable,
      reason: `createRecord → ${String(response.status)} : ${detail}`,
    },
  };
}

export const send: SendFn = async (
  payload: PostPayload,
  env: Env,
  fetchFn: typeof fetch,
): Promise<SendResult> => {
  if (env.BLUESKY_HANDLE === undefined || env.BLUESKY_APP_PASSWORD === undefined) {
    return {
      status: 'PENDING_KEYS',
      reason:
        'BLUESKY_HANDLE/BLUESKY_APP_PASSWORD absents — créer un mot de passe d’application (bsky.app › Réglages › Confidentialité et sécurité), puis wrangler secret put pour chacun',
    };
  }

  const premiere = await ouvrirSession(env, fetchFn);
  if ('erreur' in premiere) {
    return premiere.erreur;
  }
  let verdict = await creerRecord(premiere.session, payload, fetchFn);
  if (verdict.statut === 'session-expiree') {
    // Jeton expiré en vol : UNE relance de session, UN seul retry — jamais de boucle.
    const seconde = await ouvrirSession(env, fetchFn);
    if ('erreur' in seconde) {
      return seconde.erreur;
    }
    verdict = await creerRecord(seconde.session, payload, fetchFn);
    if (verdict.statut === 'session-expiree') {
      return {
        status: 'ERROR',
        retryable: false,
        reason:
          'createRecord 401 après rafraîchissement de session — identifiants morts, re-tenter ne changerait rien',
      };
    }
  }
  if (verdict.statut === 'erreur') {
    return verdict.resultat;
  }
  return { status: 'SENT', externalId: verdict.uri };
};
