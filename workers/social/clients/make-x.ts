// workers/social/clients/make-x.ts — client X via webhook Make.com (T51).
//
// Même délégation que make-linkedin.ts : l'API X directe est passée en
// pay-per-use (0,20 $/post avec URL — hors périmètre, cf. docs/social-setup.md
// §1), tandis que Make.com, partenaire X, expose le module « Create a Post »
// OAuth'é au compte @francepassoire. On remet {text, url, request_id} au
// webhook du scénario ; tout 2xx vaut remise réussie (le devenir ultérieur —
// publication ou approbation humaine — est visible côté Make, pas chez nous).
//
// Le secret MAKE_WEBHOOK_URL est le CRÉDENTIEL : l'URL du webhook Make est
// longue et impossible à deviner — qui la possède peut déclencher le post.

import type { Env, PostPayload, SendFn, SendResult } from '../src/types';

const MAKE_TIMEOUT_MS = 15_000;

/** Classifie les statuts HTTP Make : 2xx = remis, 429/5xx = rejouable, reste permanent. */
function classifierStatut(status: number): { retryable: boolean } {
  return { retryable: status === 429 || status >= 500 };
}

export const send: SendFn = async (
  payload: PostPayload,
  env: Env,
  fetchFn: typeof fetch,
): Promise<SendResult> => {
  const webhook = env.MAKE_WEBHOOK_URL;
  if (!webhook) {
    return {
      status: 'PENDING_KEYS',
      reason: 'MAKE_WEBHOOK_URL absent — webhook Make.com non configuré (wrangler secret put MAKE_WEBHOOK_URL)',
    };
  }

  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), MAKE_TIMEOUT_MS);
  try {
    const reponse = await fetchFn(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: payload.text,
        url: payload.url,
        request_id: payload.metadata?.request_id,
      }),
      signal: controleur.signal,
    });
    if (reponse.status >= 200 && reponse.status < 300) {
      return { status: 'SENT' };
    }
    return {
      status: 'ERROR',
      ...classifierStatut(reponse.status),
      reason: `webhook Make → ${String(reponse.status)}`,
    };
  } catch (error) {
    return {
      status: 'ERROR',
      retryable: true,
      reason: `webhook Make injoignable : ${String(error)}`,
    };
  } finally {
    clearTimeout(minuteur);
  }
};

export const __test = { classifierStatut, MAKE_TIMEOUT_MS };
export type { Env, PostPayload, SendResult };
