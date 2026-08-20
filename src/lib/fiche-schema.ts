// Schéma zod d'une fiche du catalogue — partagé entre la content
// collection Astro (src/content/config.ts) et les tests vitest.
// Vitest importe ce fichier directement : aucun import astro:*, seul
// le sous-module réel `astro/zod` (ré-export de l'instance zod bundlée
// par Astro, garantissant l'identité d'instance attendue par la
// collection).
import { z } from 'astro/zod';

// Énumérations volontairement fermées. Toute extension (nouveau secteur,
// nouveau type de données, nouvelle unité de volume) est un changement
// de contrat public : exiger une approbation de plan avant d'éditer.
export const secteurEnum = z.enum([
  'sante',
  'finance',
  'retail',
  'recherche',
  'public',
  'industrie',
  'services',
  'media',
  'autre',
]);

export const statutEnum = z.enum(['revendiquee', 'confirmee']);

export const volumeUnitEnum = z.enum([
  'personnes',
  'comptes',
  'enregistrements',
  'lignes',
]);

export const dataTypeEnum = z.enum([
  'identite',
  'coordonnees',
  'sante',
  'financier',
  'credentials',
  'biometrique',
  'documents',
  'geolocalisation',
  'autre',
]);

export const sourceKindEnum = z.enum([
  'article',
  'officiel',
  'revendication',
  'archive',
]);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'date au format AAAA-MM-JJ attendue',
});

export const ficheSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, {
    message: 'slug : minuscules, chiffres et tirets uniquement',
  }),
  entity: z.string().min(1),
  siren: z.string().regex(/^\d{9}$/).optional(),
  secteur: secteurEnum,
  statut: statutEnum,
  dates: z.object({
    revendication: isoDate,
    publication: isoDate.optional(),
    confirmation: isoDate.optional(),
  }),
  volume: z.object({
    count: z.number().int().min(0),
    unit: volumeUnitEnum,
    label: z.string(),
  }),
  data_types: z.array(dataTypeEnum).min(1),
  sources: z
    .array(
      z.object({
        label: z.string(),
        url: z.string().url(),
        kind: sourceKindEnum,
      }),
    )
    .min(1),
  description: z.string().min(50),
  timeline: z
    .array(
      z.object({
        date: isoDate,
        event: z.string(),
      }),
    )
    .min(1),
  // Dossiers ransomware uniquement (ex. groupe revendiquant plusieurs
  // entités françaises) — absent des fiches isolées.
  group: z.string().optional(),
});

export type Fiche = z.infer<typeof ficheSchema>;
