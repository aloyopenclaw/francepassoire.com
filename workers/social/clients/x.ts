// workers/social/clients/x.ts — client de publication X (Twitter), T39.
//
// Authentification (docs/social-setup.md §1, vérifié le 20 août 2026) :
//  - X_BEARER (app-only) est un token de LECTURE SEULE — il ne peut PAS
//    publier, ce client ne l'utilise donc jamais ;
//  - POST /2/tweets exige un token UTILISATEUR OAuth 2.0 avec les scopes
//    tweet.read + users.read + tweet.write (ou un token OAuth 1.0a).
//    Le secret correspondant est X_USER_TOKEN (nom canonique défini ici) :
//    à créer via `wrangler secret put X_USER_TOKEN` le jour où le
//    propriétaire souscrit l'offre pay-per-use X (0,015 $/post, 0,20 $/post
//    avec URL — le rendu de nos posts contient toujours une URL de fiche).
//
// Tant que X_USER_TOKEN est absent, la réponse est PENDING_KEYS : la ligne
// reste en file, le lancement du site n'est jamais bloqué.
//
// Endpoint : POST https://api.x.com/2/tweets, corps { "text": "…" },
// réponse 201 avec { "data": { "id": "…", "text": "…" } }.

import type { Env, PostPayload, SendFn, SendResult } from '../src/types';

export const X_TWEETS_ENDPOINT = 'https://api.x.com/2/tweets';

interface XTweetResponse {
  data?: { id?: string; text?: string };
}

function classify(status: number): { retryable: boolean } {
  // 429 (rate limit) et 5xx (plateforme) méritent une nouvelle tentative au
  // cron suivant ; tout autre code (401 token mort, 400 payload refusé) est
  // permanent — re-tenter ne changerait rien.
  return { retryable: status === 429 || status >= 500 };
}

export const send: SendFn = async (
  payload: PostPayload,
  env: Env,
  fetchFn: typeof fetch,
): Promise<SendResult> => {
  const token = env.X_USER_TOKEN;
  if (!token) {
    return {
      status: 'PENDING_KEYS',
      reason:
        'X_USER_TOKEN absent — X_BEARER est lecture seule, la publication X attend le token utilisateur (offre pay-per-use)',
    };
  }

  let response: Response;
  try {
    response = await fetchFn(X_TWEETS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: payload.text }),
    });
  } catch (error) {
    return {
      status: 'ERROR',
      retryable: true,
      reason: `réseau X indisponible : ${String(error)}`,
    };
  }

  if (response.status === 201) {
    try {
      const body = (await response.json()) as XTweetResponse;
      return { status: 'SENT', externalId: body.data?.id };
    } catch {
      // Publié mais corps illisible : l'id est optionnelle, pas l'envoi.
      return { status: 'SENT' };
    }
  }

  let detail = '';
  try {
    detail = JSON.stringify(await response.json()).slice(0, 300);
  } catch {
    detail = `<corps non JSON, statut ${String(response.status)}>`;
  }
  return {
    status: 'ERROR',
    retryable: classify(response.status).retryable,
    reason: `POST /2/tweets → ${String(response.status)} : ${detail}`,
  };
};
