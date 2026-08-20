// Content Config API (Astro 5) — collection `catalog`.
//
// Décision #6 : data/catalog/ reste VIDE jusqu'à la genèse du registre
// d'intégrité ; le loader glob est déjà branché pour l'avenir.
// Le schéma zod vit dans src/lib/fiche-schema.ts (source partagée avec
// les tests vitest — ce fichier ne fait que le référencer).
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { ficheSchema } from '../lib/fiche-schema';

const catalog = defineCollection({
  loader: glob({ base: './data/catalog', pattern: '*.json' }),
  schema: ficheSchema,
});

export const collections = { catalog };
