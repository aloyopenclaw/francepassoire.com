import { describe, expect, it } from 'vitest';
import {
  entitySlug,
  ficheSlug,
  groupSlug,
  yearPath,
} from '../src/lib/slugs';

describe('repliement Unicode (accents, casse, ponctuation)', () => {
  it('replie les accents : « Société Générale » → societe-generale', () => {
    expect(entitySlug('Société Générale')).toBe('/entite/societe-generale/');
  });

  it('replie à, ç, î : « Crédit Agricole » et « Français À Paris »', () => {
    expect(entitySlug('Crédit Agricole')).toBe('/entite/credit-agricole/');
    expect(entitySlug('Français À Ça')).toBe('/entite/francais-a-ca/');
  });

  it('conserve chiffres et casse mixte : « ANSSI 2025 » → anssi-2025', () => {
    expect(entitySlug('ANSSI 2025')).toBe('/entite/anssi-2025/');
  });

  it('apostrophes typographique et droite → tiret : « Caisse d’Épargne »', () => {
    expect(entitySlug('Caisse d’Épargne')).toBe('/entite/caisse-d-epargne/');
    expect(entitySlug("Caisse d'Épargne")).toBe('/entite/caisse-d-epargne/');
  });

  it('ligatures œ→oe et æ→ae : « Cœur » → coeur', () => {
    expect(entitySlug('Cœur')).toBe('/entite/coeur/');
    expect(entitySlug('Œuvre Encyclopædique')).toBe(
      '/entite/oeuvre-encyclopaedique/',
    );
  });

  it('esperluettes et ponctuation → tirets, sans tiret résiduel', () => {
    expect(entitySlug('Boulanger & Fils')).toBe('/entite/boulanger-fils/');
    expect(entitySlug('Orange: "Réseau" 5G!')).toBe(
      '/entite/orange-reseau-5g/',
    );
  });

  it('colle les tirets répétés et les espaces multiples', () => {
    expect(entitySlug('Crédit   --   Mutuel')).toBe(
      '/entite/credit-mutuel/',
    );
    expect(entitySlug('  Houplin-Ancoisne\tArras  ')).toBe(
      '/entite/houplin-ancoisne-arras/',
    );
  });

  it('rejette les entrées vides ou blanches avec un message clair en français', () => {
    expect(() => entitySlug('')).toThrow(/vide/);
    expect(() => entitySlug('   \t\n  ')).toThrow(/vide/);
  });

  it('rejette une entrée réduite à de la ponctuation', () => {
    expect(() => entitySlug('?!...')).toThrow(/vide/);
  });

  it('est idempotent sur une entrée déjà slugifiée', () => {
    expect(entitySlug('caisse-d-epargne')).toBe('/entite/caisse-d-epargne/');
    expect(groupSlug('qilin')).toBe('/ransomware/qilin/');
  });
});

describe('ficheSlug', () => {
  it('produit /fuite/<entite>-<aaaammjj>/ avec slashes ouvrant et fermant', () => {
    expect(ficheSlug('Alaxione', '2025-06-11')).toBe(
      '/fuite/alaxione-20250611/',
    );
  });

  it('formate les mois et jours à un chiffre sur deux digits', () => {
    expect(ficheSlug('Alaxione', '2025-03-07')).toBe(
      '/fuite/alaxione-20250307/',
    );
    expect(ficheSlug('Caisse d’Épargne', '2024-12-01')).toBe(
      '/fuite/caisse-d-epargne-20241201/',
    );
  });

  it('rejette une date hors format AAAA-MM-JJ avec un message en français', () => {
    expect(() => ficheSlug('Alaxione', '2025/06/11')).toThrow(/AAAA-MM-JJ/);
    expect(() => ficheSlug('Alaxione', '20250611')).toThrow(/AAAA-MM-JJ/);
    expect(() => ficheSlug('Alaxione', '')).toThrow(/AAAA-MM-JJ/);
  });

  it('sans conflit, retourne la base sans suffixe', () => {
    const slug = ficheSlug('Qilin Corp', '2025-01-15', {
      existingSlugs: new Set(['autre-entite-20250115']),
    });
    expect(slug).toBe('/fuite/qilin-corp-20250115/');
  });

  it('suffixe -2 puis -3 en cas de collision entite+date', () => {
    const existing = new Set(['qilin-corp-20250115']);
    expect(ficheSlug('Qilin Corp', '2025-01-15', { existingSlugs: existing })).toBe(
      '/fuite/qilin-corp-20250115-2/',
    );

    const existing23 = new Set([
      'qilin-corp-20250115',
      'qilin-corp-20250115-2',
    ]);
    expect(
      ficheSlug('Qilin Corp', '2025-01-15', { existingSlugs: existing23 }),
    ).toBe('/fuite/qilin-corp-20250115-3/');
  });

  it('les collisions ne fuient pas entre deux appels (fonction pure)', () => {
    const existing = new Set(['alaxione-20250611']);
    const a = ficheSlug('Alaxione', '2025-06-11', { existingSlugs: existing });
    const b = ficheSlug('Alaxione', '2025-06-11');
    expect(a).toBe('/fuite/alaxione-20250611-2/');
    expect(b).toBe('/fuite/alaxione-20250611/');
    expect(existing.size).toBe(1);
  });
});

describe('groupSlug et yearPath', () => {
  it('groupSlug : « Akira Ransomware » → /ransomware/akira-ransomware/', () => {
    expect(groupSlug('Akira Ransomware')).toBe('/ransomware/akira-ransomware/');
  });

  it('yearPath : 2025 → /2025/ (racine, slashes encadrants)', () => {
    expect(yearPath(2025)).toBe('/2025/');
  });

  it('yearPath rejette une année hors plage AAAA', () => {
    expect(() => yearPath(0)).toThrow(/année/);
    expect(() => yearPath(12345)).toThrow(/année/);
  });
});

describe('déterminisme', () => {
  it('deux séries d’appels identiques produisent des sorties identiques', () => {
    const entites = [
      'Société Générale',
      "Caisse d'Épargne",
      'Œuvre & Associés',
      'ANSSI 2025',
      '  Crédit   --   Mutuel ',
    ];
    const run1 = entites.map((e) => [entitySlug(e), groupSlug(e)]);
    const run2 = entites.map((e) => [entitySlug(e), groupSlug(e)]);
    expect(run1).toEqual(run2);
    expect(run1).toHaveLength(5);
  });
});
