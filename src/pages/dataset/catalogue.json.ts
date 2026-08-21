// Point de distribution open-data — même payload que /opendata/v1/fiches.json,
// hébergé à côté des pièces du dataset : /dataset/catalogue.json,
// /dataset/LICENSE (CC-BY-4.0) et /dataset/README.md (provenance et
// licences des sources).
//
// PORTE DE GARDE (plan, tâche 35) : le build ÉCHOUE si le catalogue est
// vide (« catalogue vide — dataset non généré », levée par buildCatalogue)
// — raison du MERGE-HOLD de feat/open-data jusqu'à la première fusion de
// backfill. Voir src/pages/opendata/v1/fiches.json.ts.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { buildCatalogue } from '../../lib/opendata';

export const GET: APIRoute = async () => {
  const entries = await getCollection('catalog');
  const payload = buildCatalogue(entries.map((entry) => entry.data));
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
