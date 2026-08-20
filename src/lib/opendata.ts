// Données ouvertes FrancePassoire — payload public du catalogue (API v1 et
// dataset) et briques RSS partagées entre le flux global et les flux par
// secteur. Fonctions pures : mêmes fiches en entrée → mêmes sorties.
//
// PORTE DE GARDE « aucun dataset vide » (plan, tâche 35) : publier un
// fichier API/dataset vide casserait la promesse d'honnêteté du site (un
// zéro qui ressemble à un chiffre publié). buildCatalogue et buildRss
// lèvent donc une erreur FR au build tant que le catalogue est vide —
// c'est la raison du MERGE-HOLD de la branche feat/open-data : le build
// de main (catalogue vide) échouerait jusqu'à la première fusion de
// backfill. Ne pas retirer cette porte.

import type { FicheLike, Secteur } from './stats';

/** Identifiant de contrat du payload public. Toute rupture de
 *  compatibilité ouvre francepassoire/fiches@v2 — jamais de changement
 *  silencieux dans @v1. */
export const DATASET_SCHEMA = 'francepassoire/fiches@v1';

export const SITE_URL = 'https://francepassoire.com';

/** Flux RSS : nombre maximal d'items par canal. */
export const FEED_MAX_ITEMS = 50;

/** Libellés français des secteurs (énumération fermée de fiche-schema.ts). */
export const SECTEUR_LABELS: Readonly<Record<Secteur, string>> = {
  sante: 'Santé',
  finance: 'Finance',
  retail: 'Retail',
  recherche: 'Recherche',
  public: 'Secteur public',
  industrie: 'Industrie',
  services: 'Services',
  media: 'Médias',
  autre: 'Autre',
};

export interface CataloguePayload {
  schema: typeof DATASET_SCHEMA;
  /** Horodatage du build, ISO 8601 UTC. */
  generated_at: string;
  count: number;
  fiches: FicheLike[];
}

/** Date d'attribution d'une fiche : publication à défaut revendication
 *  (même règle que anneeAttribution dans stats.ts). */
export function dateAttribution(fiche: FicheLike): string {
  return fiche.dates.publication ?? fiche.dates.revendication;
}

/** Payload public du catalogue : fiches triées par date d'attribution
 *  décroissante puis slug (ordre déterministe). Échoue sur catalogue vide. */
export function buildCatalogue(
  fiches: readonly FicheLike[],
  now: Date = new Date(),
): CataloguePayload {
  if (fiches.length === 0) {
    throw new Error('catalogue vide — dataset non généré');
  }
  const triees = [...fiches].sort(
    (a, b) =>
      dateAttribution(b).localeCompare(dateAttribution(a)) ||
      a.slug.localeCompare(b.slug),
  );
  return {
    schema: DATASET_SCHEMA,
    generated_at: now.toISOString(),
    count: triees.length,
    fiches: triees,
  };
}

/** URL canonique d'une fiche (contrat d'URL de slugs.ts : /fuite/<slug>/). */
export function ficheUrl(fiche: FicheLike): string {
  return `${SITE_URL}/fuite/${fiche.slug}/`;
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Date RFC 822 exigée par RSS (« Wed, 20 Aug 2026 00:00:00 GMT »)
 *  depuis une date ISO AAAA-MM-JJ garantie par le schéma. */
export function rfc822(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toUTCString();
}

export interface FeedOptions {
  /** Titre du canal (ex. « FrancePassoire — Santé »). */
  titre: string;
  /** <link> du canal : page HTML correspondante. */
  lien: string;
  description: string;
}

/** Flux RSS 2.0 : au plus FEED_MAX_ITEMS fiches, par date d'attribution
 *  décroissante. Même porte de garde que le dataset : un canal vide
 *  n'est jamais publié. */
export function buildRss(
  fiches: readonly FicheLike[],
  options: FeedOptions,
  now: Date = new Date(),
): string {
  if (fiches.length === 0) {
    throw new Error('catalogue vide — flux non généré');
  }
  const items = [...fiches]
    .sort((a, b) => dateAttribution(b).localeCompare(dateAttribution(a)))
    .slice(0, FEED_MAX_ITEMS)
    .map((fiche) => {
      const lien = ficheUrl(fiche);
      const tronquee =
        fiche.description.length > 200
          ? `${fiche.description.slice(0, 200)}…`
          : fiche.description;
      return [
        '    <item>',
        `      <title>${escapeXml(`${fiche.entity} — ${fiche.volume.label}`)}</title>`,
        `      <link>${lien}</link>`,
        `      <guid isPermaLink="true">${lien}</guid>`,
        `      <pubDate>${rfc822(dateAttribution(fiche))}</pubDate>`,
        `      <description>${escapeXml(tronquee)}</description>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(options.titre)}</title>
    <link>${options.lien}</link>
    <description>${escapeXml(options.description)}</description>
    <language>fr</language>
    <lastBuildDate>${now.toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}
