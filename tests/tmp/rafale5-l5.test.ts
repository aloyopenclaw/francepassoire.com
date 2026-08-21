// Validation temporaire (rafale 5 — L5) : chaque fiche nouvelle du lot doit
// passer le contrat zod public. Fichier de lane — supprimé par la
// consolidation après chaîne, comme les rafales précédentes.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ficheSchema } from '../../src/lib/fiche-schema';

const ici = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(ici, '..', '..', 'data', 'catalog');

const NOUVELLES = [
  'pharmacie-orleans-20240701',
  'msp-givors-presqu-ile-20251127',
  'msp-du-pre-vicinal-20251125',
];

describe('rafale 5 L5 — nouvelles fiches santé & social 2024-2025', () => {
  it('chaque fiche du lot valide le contrat zod', () => {
    for (const slug of NOUVELLES) {
      const fiche = JSON.parse(readFileSync(join(catalogDir, `${slug}.json`), 'utf8'));
      const res = ficheSchema.safeParse(fiche);
      if (!res.success) {
        console.error(slug, JSON.stringify(res.error.issues, null, 2));
      }
      expect(res.success, slug).toBe(true);
    }
  });

  it('description ≤ 120 mots (Ton A factuel sec)', () => {
    for (const slug of NOUVELLES) {
      const fiche = JSON.parse(readFileSync(join(catalogDir, `${slug}.json`), 'utf8'));
      const mots = fiche.description.trim().split(/\s+/).length;
      expect(mots <= 120, `${slug}: ${mots} mots`).toBe(true);
    }
  });

  it('slug unique dans le catalogue de la branche', () => {
    const tous = readdirSync(catalogDir).filter((f) => f.endsWith('.json'));
    expect(new Set(tous).size).toBe(tous.length);
  });
});
