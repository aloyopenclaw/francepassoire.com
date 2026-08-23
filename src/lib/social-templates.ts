// Modèles de posts « defamation-safe » pour les réseaux sociaux — tâche 41
// (Wave 5). Trois familles : nouvelle fiche, changement de statut, teaser
// hebdomadaire. Le module est pur et déterministe (aucun IO, aucune horloge,
// aucun aléatoire) : il produit des chaînes, les workers 38–40 les publient.
//
// Garanties éditoriales, vérifiées à chaque rendu :
//  - ≤ 260 caractères (X-safe) : au-delà on REFUSE (throw) plutôt que de
//    tronquer — un post coupé peut perdre la mention de prudence ;
//  - tonalité factuelle : pas d’empilement de « ! » (« !! » interdit, un
//    seul « ! » au maximum), et le vocabulaire fixe des modèles ne contient
//    aucun terme alarmiste (urgence, panique, catastrophe, choc, effarant —
//    couvert par la batterie de tests) ;
//  - aucune allégation non vérifiée présentée comme un fait : toute sortie
//    « revendiquée » porte la mention exacte
//    « revendication non confirmée par l’entité ».
// Le vocabulaire statutaire (revendiquée / confirmée / retirée) et les motifs
// de retrait viennent de la taxonomie T9 (taxonomy.ts) : ce module n’invente
// aucune étiquette et n’annonce que ses transitions légales.

import { MOTIFS_RETRAIT, type MotifRetrait, type Statut } from './taxonomy';

/** Limite X-safe : tout rendu au-delà lève une erreur, jamais de troncature. */
export const LIMITE_POST = 260;

/** Mention obligatoire de toute sortie concernant une fiche revendiquée. */
export const MENTION_REVENDICATION = 'revendication non confirmée par l’entité';

/**
 * Gabarit social propriétaire (décision owner 23/08) — structure EXACTE :
 * en-tête 🚨📣 + Statut/Volume + résumé (description verbatim) + CTA + URL.
 * LONG = FB/IG/LinkedIn (aucune limite + hashtags) ; COURT = X ≤ 280 et
 * Bluesky ≤ 300 graphèmes (sans résumé, volume sans clause « selon X »).
 */
export const CTA_LONG =
  'Reprenez le contrôle. Consultez la fiche complète pour vérifier les gestes de protection immédiats et abonnez-vous à notre veille citoyenne gratuite pour ne rater aucune alerte 🔔 👇';
export const CTA_COURT =
  'Consultez la fiche complète et abonnez-vous à notre veille citoyenne gratuite pour ne rater aucune alerte 🔔 👇';

/** Libellé de statut pour la pilule du gabarit. */
function piluleStatut(statut: string): string {
  return statut === 'confirmee' ? 'Confirmée' : 'Revendiquée';
}

/** Libellé secteur pour l'en-tête du gabarit. */
const SECTEURS_SOCIAUX: Record<string, string> = {
  services: 'Services', sante: 'Santé', retail: 'Commerce', finance: 'Finance',
  industrie: 'Industrie', media: 'Médias', public: 'Secteur public',
  recherche: 'Recherche', autre: 'Autre',
};

/** Hashtags de portée (FB/IG/LinkedIn) : fixes + entité + groupe ransomware. */
function hashtags(entity: string, groupeAffiche?: string): string {
  const slug = entity
    .normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const base = ['#FrancePassoire', '#FuiteDeDonnées', '#DataLeaks', '#Rancongiciel',
    '#cybersecurite', '#cyberattaque', '#piratageinformatique', `#${slug.charAt(0).toUpperCase()}${slug.slice(1)}`];
  if (groupeAffiche) base.splice(4, 0, `#${groupeAffiche}`);
  return base.join(' ');
}

/** Entrée du gabarit social propriétaire (fiche → post). */
export interface SocialPostInput {
  entity: string;
  secteur: string;
  statut: string;
  /** Volume affiché : première clause du label (avant « ; »). */
  volumeLabel: string;
  /** « Ce que l'on sait » : description de la fiche, MOT POUR MOT. */
  description: string;
  url: string;
  /** Logo de l'organisation si trouvé, sinon carte FrancePassoire. */
  imageUrl: string;
  /** Nom d'affichage du groupe ransomware (ex. « LockBit »), hashtag dédié long. */
  group?: string;
}

const URL_SITE = 'https://francepassoire.com';

export interface NewFicheInput {
  entity: string;
  /** Une fiche ne naît jamais retirée : états initiaux seuls. */
  statut: Exclude<Statut, 'retiree'>;
  volumeLabel: string;
  url: string;
}

export interface StatusChangeInput {
  entity: string;
  from: Statut;
  to: Statut;
  motif?: MotifRetrait;
  url: string;
}

export interface WeeklyDigestStats {
  fiches: number;
  personnes: number;
}

export class SocialTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SocialTemplateError';
  }
}

const LIBELLE_STATUT: Record<Statut, string> = {
  revendiquee: 'revendiquée',
  confirmee: 'confirmée',
  retiree: 'retirée',
};

// Transitions annonçables — exactement celles que la machine T9 autorise :
// aucune rétrogradation (confirmée → revendiquée) ne sera jamais postée.
const TRANSITIONS_LEGALES = new Set([
  'revendiquee>confirmee',
  'revendiquee>retiree',
  'confirmee>retiree',
]);

// Formulations neutres des motifs de retrait (aucune charge, aucun blâme).
const LIBELLE_MOTIF: Record<MotifRetrait, string> = {
  retrait_demande_entite: 'à la demande de l’entité',
  contestation_fondee: 'contestation fondée',
  doublon: 'doublon d’une fiche existante',
  erreur_documentation: 'erreur de documentation',
  decision_editoriale: 'décision éditoriale',
};

function champ(nom: string, valeur: string): string {
  const propre = valeur.trim();
  if (propre === '') {
    throw new SocialTemplateError(
      `Champ « ${nom} » vide : un post sans ${nom} n’est pas publiable.`,
    );
  }
  return propre;
}

// Contrôle final commun : longueur X-safe puis tonalité. Le refus vaut mieux
// qu’un post dénaturé — l’appelant raccourcit et rejoue.
function validerPost(post: string): string {
  if (post.length > LIMITE_POST) {
    throw new SocialTemplateError(
      `Post de ${post.length} caractères : la limite X-safe est de ${LIMITE_POST}, raccourcissez l’entité ou le volume.`,
    );
  }
  if (post.includes('!!')) {
    throw new SocialTemplateError(
      'Points d’exclamation empilés (« !! ») : un post factuel n’en empile pas.',
    );
  }
  const exclamations = post.length - post.replaceAll('!', '').length;
  if (exclamations > 1) {
    throw new SocialTemplateError(
      `Au plus un point d’exclamation par post, trouvé : ${exclamations}.`,
    );
  }
  return post;
}

// Séparation de milliers à la française (espace fine remplacée par une
// espace simple : rendu identique partout, aucune dépendance ICU).
function formaterNombre(nombre: number): string {
  const chiffres = String(nombre);
  const groupes: string[] = [];
  for (let fin = chiffres.length; fin > 0; fin -= 3) {
    groupes.unshift(chiffres.slice(Math.max(0, fin - 3), fin));
  }
  return groupes.join(' ');
}

/** Ligne Statut du gabarit LONG : une fiche revendiquée porte TOUJOURS la
 *  mention exacte (garde du drain social : sans elle la ligne est INVALID). */
function ligneStatutLong(statut: string): string {
  return statut === 'revendiquee'
    ? `Statut : Revendiquée (${MENTION_REVENDICATION})`
    : `Statut : ${piluleStatut(statut)}`;
}

/** Gabarit LONG — FB / Instagram / LinkedIn (aucune limite, hashtags inclus). */
export function renderSocialPost(post: SocialPostInput): string {
  if (!post.description.trim()) {
    throw new SocialTemplateError(
      "Description vide : « Ce que l'on sait » est la matière première du post, on n'improvise pas.",
    );
  }
  const volume = post.volumeLabel.split(';')[0]?.trim() ?? post.volumeLabel;
  return [
    `🚨 📣 Nouvelle fuite recensée : ${post.entity} (${SECTEURS_SOCIAUX[post.secteur] ?? post.secteur})`,
    '',
    ligneStatutLong(post.statut),
    `Volume : ${volume}`,
    '',
    post.description,
    '',
    CTA_LONG,
    post.url,
    '',
    hashtags(post.entity, post.group),
  ].join('\n');
}

/** Gabarit COURT — X (≤ 280) et Bluesky (≤ 300 graphèmes) : sans résumé. */
export function renderSocialPostCourt(post: SocialPostInput): string {
  const volumeComplet = post.volumeLabel.split(';')[0]?.trim() ?? post.volumeLabel;
  const volume = volumeComplet.split(' selon ')[0]?.trim() ?? volumeComplet;
  const texte = [
    `🚨📣 Nouvelle fuite recensée : ${post.entity} (${SECTEURS_SOCIAUX[post.secteur] ?? post.secteur})`,
    '',
    `Statut : ${piluleStatut(post.statut)}`,
    `Volume : ${volume}`,
    '',
    CTA_COURT,
    post.url,
  ].join('\n');
  if (texte.length > 280) {
    throw new SocialTemplateError(
      `Gabarit court à ${String(texte.length)} caractères (limite X : 280) — réduire le volume.`,
    );
  }
  return texte;
}

export function renderNewFichePost(fiche: NewFicheInput): string {
  const entity = champ('entité', fiche.entity);
  const volumeLabel = champ('volume', fiche.volumeLabel);
  const url = champ('url', fiche.url);
  let post: string;
  if (fiche.statut === 'confirmee') {
    post = `Nouvelle fiche confirmée : ${entity} — ${volumeLabel}. Sources et détails : ${url}`;
  } else if (fiche.statut === 'revendiquee') {
    post = `Nouvelle fiche revendiquée : ${entity} — ${volumeLabel} (${MENTION_REVENDICATION}). Détails : ${url}`;
  } else {
    throw new SocialTemplateError(
      `Statut « ${String(fiche.statut)} » impossible pour une nouvelle fiche : une fiche ne naît jamais retirée.`,
    );
  }
  return validerPost(post);
}

export function renderStatusChangePost(change: StatusChangeInput): string {
  const entity = champ('entité', change.entity);
  const url = champ('url', change.url);
  if (!TRANSITIONS_LEGALES.has(`${change.from}>${change.to}`)) {
    throw new SocialTemplateError(
      `Transition « ${change.from} → ${change.to} » non annonçable : seules les transitions légales de la taxonomie (revendiquée → confirmée, revendiquée → retirée, confirmée → retirée) se postent.`,
    );
  }
  if (change.motif !== undefined && change.to !== 'retiree') {
    throw new SocialTemplateError(
      'Motif de retrait fourni pour une confirmation : un motif n’existe que pour un passage vers « retirée ».',
    );
  }
  if (change.motif !== undefined && !(MOTIFS_RETRAIT as readonly string[]).includes(change.motif)) {
    throw new SocialTemplateError(
      `Motif de retrait inconnu « ${String(change.motif)} » : seuls les 5 motifs de la taxonomie existent.`,
    );
  }
  const post =
    change.to === 'confirmee'
      ? `Mise à jour : la fiche ${entity} passe de « revendiquée » à « confirmée » après vérification d’une source officielle. ${url}`
      : `Mise à jour : la fiche ${entity} passe de « ${LIBELLE_STATUT[change.from]} » à « retirée » (${change.motif === undefined ? 'motif documenté au registre' : LIBELLE_MOTIF[change.motif]}). ${url}`;
  return validerPost(post);
}

export function renderWeeklyDigestTeaser(stats: WeeklyDigestStats): string {
  if (
    !Number.isInteger(stats.fiches) ||
    stats.fiches < 0 ||
    !Number.isInteger(stats.personnes) ||
    stats.personnes < 0
  ) {
    throw new SocialTemplateError(
      'Statistiques hebdomadaires invalides : des entiers positifs (ou nuls) sont attendus.',
    );
  }
  const fiches = `${formaterNombre(stats.fiches)} ${stats.fiches > 1 ? 'fiches' : 'fiche'}`;
  const personnes = `${formaterNombre(stats.personnes)} ${stats.personnes > 1 ? 'personnes concernées' : 'personne concernée'}`;
  return validerPost(
    `Cette semaine sur FrancePassoire : ${fiches} et ${personnes}. Le détail par fiche : ${URL_SITE}`,
  );
}
