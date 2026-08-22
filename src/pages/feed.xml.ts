// Flux RSS 2.0 global — 50 dernières fiches du catalogue.
// Porte de garde identique au dataset : aucun canal vide n'est publié
// (voir src/lib/opendata.ts).
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { buildRss, SITE_URL } from '../lib/opendata';

export const GET: APIRoute = async () => {
  const fiches = (await getCollection('catalog')).map((entry) => entry.data);
  const xml = buildRss(fiches, {
    titre: 'FrancePassoire : fuites de données personnelles en France',
    lien: SITE_URL,
    description:
      'Dernières fuites de données personnelles touchant la France, recensées et sourcées par FrancePassoire : métadonnées publiques uniquement, aucune donnée volée hébergée.',
  });
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
