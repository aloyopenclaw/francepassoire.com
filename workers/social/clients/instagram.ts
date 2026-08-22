// workers/social/clients/instagram.ts — client Instagram, T51.
//
// Content Publishing en deux temps (Graph API v21.0, compte Instagram
// professionnel relié à la Page Facebook — même FB_PAGE_TOKEN, cf.
// docs/social-setup.md §Instagram) :
//   1. POST /{ig-user-id}/media        {image_url, caption} → creation_id ;
//   2. POST /{ig-user-id}/media_publish {creation_id}       → post publié.
//
// image_url = la CARTE FICHE générée au build (scripts/generate-fiche-cards.mjs)
// à l'URL publique https://…/fiche/<slug>/card.jpg — Instagram exige JPEG
// (« JPEG is the only image format supported », doc Content Publishing) et
// une URL publique : le slug est dérivé de payload.url (/f/<slug> ou
// /fiche/<slug>).
//
// Garde-taille : caption ≤ 2200 caractères et ≤ 30 hashtags (limites IG,
// tronquade sûre — jamais de mot ou hashtag coupé en surnombre).

import { classifierErreurGraph } from './facebook';
import type { Env, PostPayload, SendFn, SendResult } from '../src/types';

const GRAPH_VERSION = 'v21.0';
const IG_TIMEOUT_MS = 15_000;

const CAPTION_MAX = 2200;
const HASHTAGS_MAX = 30;

/** Slug de fiche depuis l'URL du payload : /fiche/<slug>/… ou /f/<slug>. */
export function slugDepuisUrl(urlFiche: string): string | undefined {
  try {
    const chemin = new URL(urlFiche).pathname.split('/').filter(Boolean);
    const iFiche = chemin.indexOf('fiche');
    if (iFiche !== -1 && chemin[iFiche + 1]) {
      return chemin[iFiche + 1];
    }
    const iF = chemin.indexOf('f');
    if (iF !== -1 && chemin[iF + 1]) {
      return chemin[iF + 1];
    }
    return chemin.at(-1);
  } catch {
    return undefined;
  }
}

/** URL publique de la carte fiche (1080×1080 JPEG) pour l'image du post. */
export function urlCarte(urlFiche: string): string | undefined {
  const slug = slugDepuisUrl(urlFiche);
  if (!slug) {
    return undefined;
  }
  const base = new URL(urlFiche).origin;
  return `${base}/fiche/${slug}/card.jpg`;
}

/** Caption conforme IG : URL embarquée, ≤ 30 hashtags, ≤ 2200 caractères. */
export function limiterCaption(payload: PostPayload): string {
  let caption = payload.text.includes(payload.url)
    ? payload.text
    : `${payload.text} ${payload.url}`;
  const hashtags = caption.match(/#\w+/g) ?? [];
  if (hashtags.length > HASHTAGS_MAX) {
    // Garde les 30 premiers hashtags, retire les suivants (du 31e au dernier).
    let gardees = 0;
    caption = caption.replace(/#\w+/g, (h) => ((gardees += 1) <= HASHTAGS_MAX ? h : ''));
    caption = caption.replace(/ {2,}/g, ' ').trimEnd();
  }
  if (caption.length > CAPTION_MAX) {
    caption = caption.slice(0, CAPTION_MAX).trimEnd();
  }
  return caption;
}

interface ReponseMedia {
  id?: string;
}

export const send: SendFn = async (
  payload: PostPayload,
  env: Env,
  fetchFn: typeof fetch,
): Promise<SendResult> => {
  const igUserId = env.IG_USER_ID;
  const token = env.FB_PAGE_TOKEN;
  const manquants = [
    ...(igUserId ? [] : ['IG_USER_ID']),
    ...(token ? [] : ['FB_PAGE_TOKEN']),
  ];
  if (manquants.length > 0) {
    return {
      status: 'PENDING_KEYS',
      reason: `${manquants.join(' + ')} absent(s) — Instagram non câblé (wrangler secret put ${manquants.join(' / ')})`,
    };
  }

  const carte = urlCarte(payload.url);
  if (!carte) {
    return {
      status: 'UNSUPPORTED_PAYLOAD',
      reason: `URL de fiche inexploitable pour la carte Instagram : ${payload.url}`,
    };
  }
  const caption = limiterCaption(payload);

  const postGraph = async (
    chemin: string,
    corps: Record<string, string>,
  ): Promise<
    | { ok: true; id?: string }
    | { ok: false; retryable: boolean; raison: string }
  > => {
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), IG_TIMEOUT_MS);
    try {
      const reponse = await fetchFn(
        `https://graph.facebook.com/${GRAPH_VERSION}/${chemin}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...corps, access_token: token }),
          signal: controleur.signal,
        },
      );
      if (reponse.status >= 200 && reponse.status < 300) {
        try {
          const corpsReponse = (await reponse.json()) as ReponseMedia;
          return { ok: true, id: corpsReponse.id };
        } catch {
          return { ok: true };
        }
      }
      let code: number | undefined;
      let detail = '';
      try {
        const corps = (await reponse.json()) as {
          error?: { message?: string; code?: number };
        };
        code = corps.error?.code;
        detail =
          corps.error?.message?.slice(0, 300) ??
          JSON.stringify(corps).slice(0, 300);
      } catch {
        detail = `<corps non JSON, statut ${String(reponse.status)}>`;
      }
      const retryable =
        code !== undefined
          ? classifierErreurGraph(code).retryable
          : reponse.status === 429 || reponse.status >= 500;
      return {
        ok: false,
        retryable,
        raison: `POST ${chemin} → ${String(reponse.status)} (code ${String(code)}) : ${detail}`,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        raison: `Graph API Instagram injoignable : ${String(error)}`,
      };
    } finally {
      clearTimeout(minuteur);
    }
  };

  // Étape 1 — conteneur média : image_url (carte fiche) + caption.
  const creation = await postGraph(`${igUserId}/media`, {
    image_url: carte,
    caption,
  });
  if (!creation.ok) {
    return { status: 'ERROR', retryable: creation.retryable, reason: creation.raison };
  }
  const creationId = creation.id;
  if (!creationId) {
    return {
      status: 'ERROR',
      retryable: true,
      reason: `conteneur créé sans creation_id (${igUserId}/media) — rejoué au prochain cron`,
    };
  }

  // Étape 2 — publication du conteneur.
  const publication = await postGraph(`${igUserId}/media_publish`, {
    creation_id: creationId,
  });
  if (!publication.ok) {
    return {
      status: 'ERROR',
      retryable: publication.retryable,
      reason: publication.raison,
    };
  }
  if (publication.id) {
    console.log(`[social][instagram] post publié : id ${publication.id}`);
  }
  return { status: 'SENT', externalId: publication.id };
};

export const __test = {
  slugDepuisUrl,
  urlCarte,
  limiterCaption,
  CAPTION_MAX,
  HASHTAGS_MAX,
};
export type { Env, PostPayload, SendResult };
