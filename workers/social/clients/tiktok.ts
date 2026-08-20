// workers/social/clients/tiktok.ts — client TikTok, T40 : refus honnête.
//
// CONSTAT STRUCTUREL (docs/social-setup.md §3) : la Content Posting API de
// TikTok est VIDEO-FIRST — le Direct Post exige un média vidéo ; il n'existe
// PAS de post texte. Nos rendus (src/lib/social-templates.ts) sont
// texte + URL de fiche : aucun ne satisfait ce contrat.
//
// Décision : pas de stub 500 ni d'appel condamné — le client retourne
// honnêtement UNSUPPORTED_PAYLOAD tant que la ligne n'a pas de vidéo, et la
// file marque la ligne DEAD avec la raison loguée.
//
// ⚠ ACTIVATION TIKTOK = DÉCISION DE STRATÉGIE ÉDITORIALE PENDANTE (digest
// vidéo hebdomadaire, format à définir) — signalée au propriétaire dans
// docs/social-setup.md §3. Ce client ne doit PAS être « complété » par un
// envoi texte : l'API le refuse. Le jour d'une stratégie vidéo, ce fichier
// deviendra un vrai client (upload vidéo + direct post), avec le scope
// video.publish déjà documenté.

import type { SendFn, SendResult } from '../src/types';

export const send: SendFn = async (
  _payload,
  env,
  _fetchFn,
): Promise<SendResult> => {
  if (!env.TIKTOK_ACCESS_TOKEN) {
    return {
      status: 'PENDING_KEYS',
      reason:
        'TIKTOK_ACCESS_TOKEN absent — TikTok attend la review Content Posting API (scope video.publish)',
    };
  }
  // Aucun appel réseau : sans vidéo, l'API refuserait — on le dit nous-mêmes.
  return {
    status: 'UNSUPPORTED_PAYLOAD',
    reason: 'TikTok exige une vidéo — texte seul non postable',
  };
};
