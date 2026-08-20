import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ficheSchema } from '../src/lib/fiche-schema';

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${fixturesDir}${name}`, 'utf-8'));
}

describe('ficheSchema (catalogue)', () => {
  it('accepte une fiche valide', () => {
    const result = ficheSchema.safeParse(loadFixture('fiche-valid.json'));
    expect(result.success).toBe(true);
  });

  it('rejette une fiche dont le statut est hors énumération, en nommant le champ', () => {
    const result = ficheSchema.safeParse(
      loadFixture('fiche-invalid-statut.json'),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = JSON.stringify(result.error.issues);
      expect(message).toContain('statut');
    }
  });
});
