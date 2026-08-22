// Flux RSS 2.0 par secteur — un fichier /feed/<secteur>.xml pour chaque
// secteur présent dans le catalogue (aucun fichier pour un secteur sans
// fiche : un canal vide n'est jamais publié).
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import {
  buildRss,
  SECTEUR_LABELS,
  SITE_URL,
} from '../../lib/opendata';
import type { Secteur } from '../../lib/stats';

export async function getStaticPaths() {
  const fiches = await getCollection('catalog');
  const secteurs = [...new Set(fiches.map((entry) => entry.data.secteur))]
    .sort();
  return secteurs.map((secteur) => ({ params: { secteur } }));
}

export const GET: APIRoute = async ({ params }) => {
  const secteur = params.secteur as Secteur;
  const fiches = (await getCollection('catalog'))
    .map((entry) => entry.data)
    .filter((fiche) => fiche.secteur === secteur);
  const xml = buildRss(fiches, {
    titre: `FrancePassoire : fuites de données : ${SECTEUR_LABELS[secteur]}`,
    lien: SITE_URL,
    description: `Fuites de données personnelles dans le secteur « ${SECTEUR_LABELS[secteur]} », recensées et sourcées par FrancePassoire.`,
  });
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
