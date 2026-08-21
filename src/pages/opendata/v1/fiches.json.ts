// API publique v1 — catalogue complet des fiches en JSON.
//
// Contrat : schéma stable « francepassoire/fiches@v1 » (voir
// src/lib/opendata.ts). Toute rupture de compatibilité passe par @v2.
//
// PORTE DE GARDE (plan, tâche 35) : le build ÉCHOUE si le catalogue est
// vide (« catalogue vide — dataset non généré », levée par buildCatalogue).
// C'est la raison du MERGE-HOLD de la branche feat/open-data : fusionner
// vers main tant que data/catalog/ est vide rendrait le build de main
// rouge. Ne pas retirer cette porte — un dataset vide publié
// ressemblerait à un chiffre.
//
// Cache-Control : servi tel quel dès qu'un adaptateur/proxy exécutera ces
// en-têtes ; inoffensif sur l'hébergement statique.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { buildCatalogue } from '../../../lib/opendata';

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
