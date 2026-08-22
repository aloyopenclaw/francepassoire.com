// workers/social/clients/facebook.ts — client Page Facebook, T51.
//
// Publication sur le fil de la Page (POST /{page-id}/feed, Graph API v21.0)
// avec le Page access token (FB_PAGE_TOKEN, cf. docs/social-setup.md) :
// {message, link, access_token} — le message embarque l'URL de la fiche si
// le rendu amont ne la contient pas déjà.
//
// Classification des erreurs Graph : le corps d'erreur est
// {error:{message, code, subcode…}} —
//   code 190/102  token/session expiré → PERMANENT (token mort : la ligne
//                 passe DEAD, la clé doit être régénérée côté propriétaire) ;
//   code 4/17/32  limites de débit applicatif/utilisateur → REJOUABLE ;
//   autre code    → PERMANENT avec la raison de Meta.
// Corps illisible (HTML de proxy…) : repli sur le statut HTTP (429/5xx
// rejouable, le reste permanent).

import type { Env, PostPayload, SendFn, SendResult } from '../src/types';

const GRAPH_VERSION = 'v21.0';
const FB_TIMEOUT_MS = 15_000;

/** Codes d'erreur Graph API pérennes : re-tenter ne changerait rien. */
const CODES_TOKEN_MORT = new Set([190, 102]);
/** Codes de limitation de débit Graph API : le prochain cron repasse. */
const CODES_DEBIT = new Set([4, 17, 32]);

interface ErreurGraph {
  error?: { message?: string; code?: number; subcode?: number };
}

/** Classifie un corps d'erreur Graph ({error:{code,…}}) ; code inconnu → permanent. */
export function classifierErreurGraph(code: number | undefined): { retryable: boolean } {
  if (code !== undefined && CODES_DEBIT.has(code)) {
    return { retryable: true };
  }
  return { retryable: false };
}

/** Texte + URL, l'URL ajoutée seulement si le rendu ne l'embarque pas déjà. */
export function composerMessage(payload: PostPayload): string {
  return payload.text.includes(payload.url)
    ? payload.text
    : `${payload.text} ${payload.url}`;
}

export const send: SendFn = async (
  payload: PostPayload,
  env: Env,
  fetchFn: typeof fetch,
): Promise<SendResult> => {
  const pageId = env.FB_PAGE_ID;
  const token = env.FB_PAGE_TOKEN;
  const manquants = [
    ...(pageId ? [] : ['FB_PAGE_ID']),
    ...(token ? [] : ['FB_PAGE_TOKEN']),
  ];
  if (manquants.length > 0) {
    return {
      status: 'PENDING_KEYS',
      reason: `${manquants.join(' + ')} absent(s) — Page Facebook non câblée (wrangler secret put ${manquants.join(' / ')})`,
    };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/feed`;
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), FB_TIMEOUT_MS);
  try {
    const reponse = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: composerMessage(payload),
        link: payload.url,
        access_token: token,
      }),
      signal: controleur.signal,
    });

    if (reponse.status >= 200 && reponse.status < 300) {
      let externalId: string | undefined;
      try {
        const corps = (await reponse.json()) as { id?: string };
        externalId = corps.id;
      } catch {
        // Publié mais corps illisible : l'id est optionnelle, pas l'envoi.
      }
      if (externalId) {
        console.log(`[social][facebook] post Page publié : id ${externalId}`);
      }
      return { status: 'SENT', externalId };
    }

    // Erreur Graph : {error:{code, message}} quand le corps est JSON.
    let code: number | undefined;
    let detail = '';
    try {
      const corps = (await reponse.json()) as ErreurGraph;
      code = corps.error?.code;
      detail =
        corps.error?.message?.slice(0, 300) ??
        JSON.stringify(corps).slice(0, 300);
    } catch {
      detail = `<corps non JSON, statut ${String(reponse.status)}>`;
    }

    let retryable: boolean;
    if (code !== undefined) {
      retryable = classifierErreurGraph(code).retryable;
    } else {
      retryable = reponse.status === 429 || reponse.status >= 500;
    }

    const suffixe =
      code !== undefined && CODES_TOKEN_MORT.has(code)
        ? ' — token Page mort : régénérer FB_PAGE_TOKEN (docs/social-setup.md §Facebook)'
        : '';
    return {
      status: 'ERROR',
      retryable,
      reason: `POST /${pageId}/feed → ${String(reponse.status)} (code ${String(code)}) : ${detail}${suffixe}`,
    };
  } catch (error) {
    return {
      status: 'ERROR',
      retryable: true,
      reason: `Graph API Facebook injoignable : ${String(error)}`,
    };
  } finally {
    clearTimeout(minuteur);
  }
};

export const __test = {
  classifierErreurGraph,
  composerMessage,
  CODES_TOKEN_MORT,
  FB_TIMEOUT_MS,
};
export type { Env, PostPayload, SendResult };
