import { describe, expect, it } from 'vitest';
// Porte CI des fiches (T19) : chaque fichier JSON de data/catalog doit passer
// ficheSchema (zod). C'est ce test que pr-validate.yml exécute sur chaque PR
// touchant data/catalog/** — il réutilise le pipeline TS de vitest (aucun
// script .mjs ne peut importer le schéma TS directement).
//
// Décision #6 : data/catalog/ reste VIDE sur main jusqu'à la genèse du
// registre — un catalogue vide rend ce fichier vert par convention ; dès
// qu'une fiche existe (branche de PR), elle est réellement validée.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ficheSchema } from '../src/lib/fiche-schema';

const catalogDir = fileURLToPath(new URL('../data/catalog/', import.meta.url));

const ficheFiles = readdirSync(catalogDir).filter((name) => name.endsWith('.json'));

describe('catalogue data/catalog — porte ficheSchema (CI pr-validate)', () => {
  if (ficheFiles.length === 0) {
    it('catalogue vide (décision #6) — porte verte par convention', () => {
      expect(ficheFiles).toEqual([]);
    });
    return;
  }

  for (const name of ficheFiles) {
    it(`fiche ${name} valide ficheSchema`, () => {
      const parsed: unknown = JSON.parse(readFileSync(`${catalogDir}${name}`, 'utf-8'));
      const result = ficheSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues
          .map((issue) => `${issue.path.join('.') || '(racine)'}: ${issue.message}`)
          .join(' ; ');
        throw new Error(`${name} invalide — ${issues}`);
      }
      expect(result.success).toBe(true);
    });
  }
});
