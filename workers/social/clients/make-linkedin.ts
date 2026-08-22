// Client LinkedIn via webhook Make.com — chemin de production (21/08/2026).
//
// Le posting direct sur la page société exige w_organization_social (revue
// LinkedIn = entreprise enregistrée active — hors de portée). Make.com, partenaire
// LinkedIn, expose le posting page via SES identifiants : on délègue par webhook.
// Le scénario côté Make : webhook → (approbation humaine optionnelle) → post page.
//
// Réponse Make observée : 200 + {"status":"pending_approval","request_id":…}
// — tout 2xx vaut remise réussie (SENDED côté file) ; le devenir ultérieur
// (approbation, publication) est visible côté Make, pas chez nous.

import type { Env, PostPayload, SendResult, SendFn } from '../src/types';

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
  const webhook = env.LINKEDIN_WEBHOOK_URL;
  if (!webhook) {
    return {
      status: 'PENDING_KEYS',
      reason: 'LINKEDIN_WEBHOOK_URL absent — webhook Make.com LinkedIn non configuré (wrangler secret put LINKEDIN_WEBHOOK_URL)',
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
        // Gabarit propriétaire 22/08 : le scénario LinkedIn publie image+texte ;
        // mediaUrl est le champ du module LinkedIn (repli url si pas d'image).
        mediaUrl: payload.imageUrl ?? payload.url,
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
