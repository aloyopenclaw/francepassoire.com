import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Assertions de niveau chaîne : l'exécution réelle du SQL est prouvée par
// `wrangler d1 migrations apply` (--remote et --local) consigné dans le
// journal d'évidence de la tâche 7.
const sql = readFileSync(
  fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url)),
  'utf-8',
);

describe('migrations/0001_init.sql', () => {
  it('existe et contient les 5 tables de staging', () => {
    for (const table of [
      'candidates',
      'events',
      'subscribers',
      'social_outbox',
      'registry',
    ]) {
      expect(sql).toMatch(
        new RegExp(`CREATE TABLE ${table}\\s*\\(`, 'i'),
      );
    }
  });

  it("contraint candidates.status à l'énumération éditoriale", () => {
    expect(sql).toMatch(/CHECK\(status IN \('NEW','DRAFT','PUBLISHED','REJECTED'\)\)/);
  });

  it("interdit en commentaire toute donnée personnelle de victimes", () => {
    expect(sql).toMatch(/données\s+personnelles\s+de\s+victimes/i);
  });
});
