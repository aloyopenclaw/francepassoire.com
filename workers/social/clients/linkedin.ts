// workers/social/clients/linkedin.ts — client de publication LinkedIn, T40.
//
// API : UGC Posts — POST https://api.linkedin.com/v2/ugcPosts (docs
// « Share on LinkedIn », produit activable en self-service, scope
// w_member_social — docs/social-setup.md §2). Deux secrets sont requis :
//  - LINKEDIN_ACCESS_TOKEN : token membre (60 jours — renouvellement ~2 mois,
//    l'expiration se manifeste par un 401 → lettre morte immédiate + log) ;
//  - LINKEDIN_MEMBER_URN : URN de l'auteur, ex. urn:li:person:XXXXXX, copiée
//    depuis la page Token Generator du portail développeur (secret
//    additionnel documenté : le token seul ne suffit pas, l'UGC Post exige
//    le membre émetteur dans `author`).
// Tant que l'un manque → PENDING_KEYS : la ligne reste en file.
//
// Le post est un partage d'article : texte rendu en shareCommentary + URL de
// la fiche en média ARTICLE. Réponse 201 avec { "id": "urn:li:share:…" }.

import type { Env, PostPayload, SendFn, SendResult } from '../src/types';

export const LINKEDIN_UGCPOSTS_ENDPOINT = 'https://api.linkedin.com/v2/ugcPosts';

interface LinkedInUgcResponse {
  id?: string;
}

function classify(status: number): { retryable: boolean } {
  // 429 (throttling) et 5xx : rejouables au cron suivant ; le reste (401
  // token expiré, 400 payload refusé) est permanent.
  return { retryable: status === 429 || status >= 500 };
}

export const send: SendFn = async (
  payload: PostPayload,
  env: Env,
  fetchFn: typeof fetch,
): Promise<SendResult> => {
  const token = env.LINKEDIN_ACCESS_TOKEN;
  if (!token) {
    return {
      status: 'PENDING_KEYS',
      reason: 'LINKEDIN_ACCESS_TOKEN absent — générer un token membre (scope w_member_social, Token Generator)',
    };
  }
  const memberUrn = env.LINKEDIN_MEMBER_URN;
  if (!memberUrn) {
    return {
      status: 'PENDING_KEYS',
      reason:
        'LINKEDIN_MEMBER_URN absent — l’UGC Post exige l’auteur (urn:li:person:…, copiée depuis la page Token Generator)',
    };
  }

  let response: Response;
  try {
    response = await fetchFn(LINKEDIN_UGCPOSTS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author: memberUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: payload.text },
            shareMediaCategory: 'ARTICLE',
            media: [{ status: 'READY', originalUrl: payload.url }],
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    });
  } catch (error) {
    return {
      status: 'ERROR',
      retryable: true,
      reason: `réseau LinkedIn indisponible : ${String(error)}`,
    };
  }

  if (response.status === 201) {
    try {
      const body = (await response.json()) as LinkedInUgcResponse;
      return { status: 'SENT', externalId: body.id };
    } catch {
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
    reason: `POST /v2/ugcPosts → ${String(response.status)} : ${detail}`,
  };
};
