// workers/api/src/social-dispatch.ts — T38/T47 : le dispatcher social manquant.
//
// Raccorde le balayage instant (watchlist.ts, diff catalogue */15) à la file
// social_outbox que draine le worker social (cron */5). Toute fiche NOUVELLE
// ou tout passage revendiquée → confirmée met quatre lignes en file (x,
// linkedin, bluesky, nostr) — décision propriétaire 23/08 : toutes les
// plateformes, chaque fiche, pas de plafond de rafale. Facebook Page et
// Instagram, branchés en T51, sont retirés le même jour (décision
// propriétaire : plus de produits Meta).
//
// CHOIX DE RENDU (contrainte : la garde du drain exige la mention exacte
// MENTION_REVENDICATION pour statut « revendiquée », et le gabarit COURT est
// plafonné à 280 — les deux ne tiennent pas ensemble) :
//   - LONG (linkedin) : gabarit propriétaire
//     renderSocialPost (mention intégrée à la ligne Statut depuis ce jour) ;
//   - COURT confirmée (x, bluesky, nostr) : gabarit propriétaire
//     renderSocialPostCourt ;
//   - COURT revendiquée : renderNewFichePost (format natif de la file, mention
//     intégrée, validé ≤ 260) ;
//   - changement de statut (les quatre) : renderStatusChangePost (transitions
//     légales de la taxonomie uniquement, sinon refus explicite).
//
// Idempotence : id DÉTERMINISTE « sw:<slug>:<plateforme> » (nouvelle fiche) ou
// « sw:maj:<slug>:<plateforme> » (changement) + INSERT OR IGNORE — un même
// tick rejoué ou un état KV qui n'avance pas ne double-jamais la file. Un
// échec de rendu (entité/volume trop longs, champ vide) saute UNE plateforme
// avec log sonore, jamais le passage entier.

import type { D1Database } from './index';
import type { FicheDigest } from './watchlist';
import {
  renderNewFichePost,
  renderRecapLong,
  renderSocialPost,
  renderSocialPostCourt,
  renderStatusChangePost,
  renderWeeklyDigestTeaser,
} from '../../../src/lib/social-templates';

/** Plateformes destination — l'ordre est celui de workers/social types.ts. */
const PLATFORMES = ['x', 'linkedin', 'bluesky', 'nostr'] as const;
type Plateforme = (typeof PLATFORMES)[number];

const LONGUES: readonly Plateforme[] = ['linkedin'];
const COURTES: readonly Plateforme[] = ['x', 'bluesky', 'nostr'];

/** Porte d'âge (décision propriétaire 23/08 soir, cas france-pare-brise) :
 *  seule une fiche REVENDIQUÉE il y a moins de 7 jours se publie. Une fiche
 *  ancienne qui entre au catalogue est de l'HISTOIRE, pas de l'actualité —
 *  les changements de statut restent publiés sans porte (la transition est
 *  l'événement, même pour une fiche vieille). */
const AGE_MAX_PUBLICATION_MS = 7 * 24 * 3600 * 1000;

export interface DispatchOptions {
  log?: (...args: unknown[]) => void;
  now?: Date;
}

/** Vrai si la fiche est assez récente pour être publiée (porte d'âge). */
export function publiable(fiche: FicheDigest, maintenant: Date): boolean {
  const revendiquee = Date.parse(fiche.dates.revendication);
  return !Number.isNaN(revendiquee) && maintenant.getTime() - revendiquee < AGE_MAX_PUBLICATION_MS;
}

/** Texte rendu pour une plateforme : LONG, COURT (confirmée) ou natif-file
 * (revendiquée). Peut lever ( SocialTemplateError ) : attrapé par l'appelant. */
/** Budget volume d'un rendu COURT : les gabarits plafonnent à 260 (natif
 *  revendiquée) / 280 (gabarit court confirmée, dont le CTA à lui seul
 *  pèse ~110) et refusaient les volumes longs — 3 fiches fin août ont vu
 *  x/bluesky/nostr sautés pour cette seule raison. La mention de prudence
 *  vit APRÈS le volume dans tous les gabarits : cette coupe ne peut jamais
 *  l'entamer. */
const VOLUME_COURT_REVENDIQUEE = 48;
const VOLUME_COURT_CONFIRMEE = 12;

/** Volume compact pour teaser : nombre + unité du catalogue quand fournis,
 *  sinon nombre+mot extraits en tête de clause, sinon troncature au mot
 *  près. La nuance complète reste dans la fiche et la version LONGUE. */
function volumeCourt(fiche: FicheDigest, cap: number): string {
  const premiere = (fiche.volume.label.split(';')[0] ?? fiche.volume.label).trim();
  if (fiche.volume.count && fiche.volume.unit) {
    const compact = `${frNumVolume(fiche.volume.count)} ${fiche.volume.unit}`;
    if (compact.length <= cap) return compact;
  }
  const extraction = premiere.match(/^([\d\s.,]+)\s*([a-zA-Zàâäéèêëîïôöùûüç'’-]+)/);
  if (extraction) {
    const extrait = `${extraction[1]!.trim()} ${extraction[2]}`.replace(/\s+/g, ' ');
    if (extrait.length <= cap) return extrait;
  }
  if (premiere.length <= cap) return premiere;
  const coupe = premiere.slice(0, cap);
  const borne = coupe.lastIndexOf(' ');
  return `${borne > 0 ? coupe.slice(0, borne) : coupe}…`;
}

/** Séparateur de milliers à la française (espace simple, sûr partout). */
function frNumVolume(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function rendre(fiche: FicheDigest, plateforme: Plateforme): string {
  const url = `https://francepassoire.com/fiche/${fiche.slug}/`;
  const entree = {
    entity: fiche.entity,
    secteur: fiche.secteur,
    statut: fiche.statut ?? 'revendiquee',
    volumeLabel: fiche.volume.label,
    description: fiche.description ?? '',
    url,
    imageUrl: `${url}card.jpg`,
  };
  if (LONGUES.includes(plateforme)) {
    return renderSocialPost(entree);
  }
  if (entree.statut === 'revendiquee') {
    return renderNewFichePost({
      entity: entree.entity,
      statut: 'revendiquee',
      volumeLabel: volumeCourt(fiche, VOLUME_COURT_REVENDIQUEE),
      url,
    });
  }
  return renderSocialPostCourt({ ...entree, statut: 'confirmee', volumeLabel: volumeCourt(fiche, VOLUME_COURT_CONFIRMEE) });
}

/** Une ligne en file : INSERT OR IGNORE (id déterministe = idempotence). */
async function enfiler(
  db: D1Database,
  id: string,
  plateforme: Plateforme,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const res = (await db
    .prepare(
      'INSERT OR IGNORE INTO social_outbox (id, platform, payload, status, scheduled_at) VALUES (?, ?, ?, ?, NULL)',
    )
    .bind(id, plateforme, JSON.stringify(payload), 'PENDING')
    .run()) as unknown as { meta?: { changes?: number } };
  return res.meta?.changes !== 0;
}

/** Met en file les quatre plateformes pour chaque fiche nouvelle / changée.
 *  Ne lève JAMAIS : chaque (fiche × plateforme) est isolée. */
export async function dispatcherInstantSocial(
  db: D1Database,
  nouveaux: readonly FicheDigest[],
  changes: readonly FicheDigest[],
  options: DispatchOptions = {},
): Promise<void> {
  const log = options.log ?? console.log;
  const maintenant = options.now ?? new Date();

  for (const fiche of nouveaux) {
    if (!publiable(fiche, maintenant)) {
      log(`social: ${fiche.slug} non publiée (porte d'âge : revendication du ${fiche.dates.revendication}, > 7 jours)`);
      continue;
    }
    for (const plateforme of PLATFORMES) {
      try {
        const text = rendre(fiche, plateforme);
        const url = `https://francepassoire.com/fiche/${fiche.slug}/`;
        const payload: Record<string, unknown> = {
          text,
          url,
          statut: fiche.statut,
          metadata: { origine: 'instant-sweep' },
        };
        if (LONGUES.includes(plateforme)) {
          payload.imageUrl = `${url}card.jpg`;
          payload.description = fiche.description ?? '';
        }
        const posee = await enfiler(db, `sw:${fiche.slug}:${plateforme}`, plateforme, payload);
        if (posee) log(`social: ${plateforme} en file pour ${fiche.slug}`);
      } catch (error) {
        console.error(
          `social: ${plateforme} IMPOSSIBLE pour ${fiche.slug} (rendu refusé, fiche sautée sur cette plateforme) :`,
          error,
        );
      }
    }
  }

  for (const fiche of changes) {
    const url = `https://francepassoire.com/fiche/${fiche.slug}/`;
    let texte: string;
    try {
      texte = renderStatusChangePost({ entity: fiche.entity, from: 'revendiquee', to: 'confirmee', url });
    } catch (error) {
      console.error(`social: maj ${fiche.slug} non postable (rendu refusé) :`, error);
      continue;
    }
    for (const plateforme of PLATFORMES) {
      try {
        const posee = await enfiler(
          db,
          `sw:maj:${fiche.slug}:${plateforme}`,
          plateforme,
          {
            text: texte,
            url,
            statut: 'confirmee',
            metadata: { origine: 'instant-sweep', type: 'maj' },
          },
        );
        if (posee) log(`social: ${plateforme} en file (maj) pour ${fiche.slug}`);
      } catch (error) {
        console.error(`social: ${plateforme} maj ${fiche.slug} non enfilée (D1) :`, error);
      }
    }
  }
}

export interface RecapDispatchOptions {
  log?: (...args: unknown[]) => void;
  /** Numéro d'édition du Récap (semaines écoulées depuis le n°1) — clé d'idempotence. */
  numero: number;
  fiches: number;
  personnes: number;
  libellePersonnes: string;
  exemples: ReadonlyArray<{ entity: string; statut: string; volume: string }>;
}

/**
 * Récap hebdo social (décision propriétaire 25/08) : quand le digest email
 * « Le Récap Passoire » part (lundi 09:00 Paris, même garde KV), sa
 * contrepartie part en file — LinkedIn en version longue (exemples + mention
 * exacte pour toute revendiquée citée), X et Bluesky en teaser COURT.
 * Ids déterministes sw:recap:<numero>:<plateforme> + INSERT OR IGNORE : un
 * lundi rejoué ne double-jamais la file. Ne lève JAMAIS.
 */
export async function dispatcherRecapHebdo(
  db: D1Database,
  options: RecapDispatchOptions,
): Promise<void> {
  const log = options.log ?? console.log;
  const url = 'https://francepassoire.com';
  let court = '';
  let long = '';
  try {
    court = renderWeeklyDigestTeaser({ fiches: options.fiches, personnes: options.personnes });
    long = renderRecapLong({
      numero: options.numero,
      fiches: options.fiches,
      personnes: options.personnes,
      libellePersonnes: options.libellePersonnes,
      exemples: options.exemples.map((e) => ({
        entity: e.entity,
        statut: e.statut === 'confirmee' ? 'confirmee' : 'revendiquee',
        volume: e.volume,
      })),
    });
  } catch (error) {
    console.error('social: récap hebdo non rendu (gabarit refusé) :', error);
    return;
  }
  const destinations: ReadonlyArray<{ plateforme: Plateforme; text: string; image: boolean }> = [
    { plateforme: 'linkedin', text: long, image: true },
    { plateforme: 'x', text: court, image: false },
    { plateforme: 'bluesky', text: court, image: false },
  ];
  for (const dest of destinations) {
    try {
      const payload: Record<string, unknown> = {
        text: dest.text,
        url,
        metadata: { origine: 'digest-hebdo', type: 'recap', numero: options.numero },
      };
      if (dest.image) payload.imageUrl = `${url}/og-image.jpg`;
      const posee = await enfiler(db, `sw:recap:${options.numero}:${dest.plateforme}`, dest.plateforme, payload);
      if (posee) log(`social: récap N°${options.numero} en file pour ${dest.plateforme}`);
    } catch (error) {
      console.error(`social: récap ${dest.plateforme} non enfilé (D1) :`, error);
    }
  }
}
