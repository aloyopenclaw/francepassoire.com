import { describe, expect, it } from 'vitest';
import {
  classeStatut,
  dateAttribution,
  descriptionEntite,
  formaterSiren,
  labelSecteur,
  labelStatut,
  ordinalFuite,
  regrouperParEntite,
} from '../src/lib/entity-view';
import type { Fiche } from '../src/lib/fiche-schema';

// Fabrique de fiches valides minimales — seuls les champs utiles à un test
// varient ; le reste reste fidèle au contrat de fiche-schema.ts.
function uneFiche(partial: Partial<Fiche> & Pick<Fiche, 'slug' | 'entity' | 'dates'>): Fiche {
  return {
    secteur: 'sante',
    statut: 'revendiquee',
    volume: { count: 1000, unit: 'personnes', label: '1 000 personnes' },
    data_types: ['identite'],
    sources: [
      { label: 'Article (exemple)', url: 'https://exemple.fr/article', kind: 'article' },
    ],
    description:
      'Description de test suffisamment longue pour satisfaire le minimum du schéma.',
    timeline: [{ date: '2026-08-01', event: 'Événement de test.' }],
    ...partial,
  } as Fiche;
}

describe('regrouperParEntite — regroupement par nom normalisé', () => {
  it('catalogue vide → aucune vue (aucune page générée)', () => {
    expect(regrouperParEntite([])).toEqual([]);
  });

  it('« Alaxione » et « Alaxione SAS » (forme juridique) → une seule entité', () => {
    const vues = regrouperParEntite([
      uneFiche({
        slug: 'alaxione-20260820',
        entity: 'Alaxione',
        dates: { revendication: '2026-08-20' },
      }),
      uneFiche({
        slug: 'alaxione-sas-20260821',
        entity: 'Alaxione SAS',
        dates: { revendication: '2026-08-21' },
      }),
    ]);
    expect(vues).toHaveLength(1);
    expect(vues[0]!.slug).toBe('alaxione');
    expect(vues[0]!.fiches).toHaveLength(2);
  });

  it('accents et ponctuation repliés : « Société Générale » → societe-generale', () => {
    const vues = regrouperParEntite([
      uneFiche({
        slug: 'sg-20260801',
        entity: 'Société Générale',
        dates: { revendication: '2026-08-01' },
      }),
    ]);
    expect(vues[0]!.slug).toBe('societe-generale');
  });

  it('deux entités distinctes → deux vues distinctes (alaxione ≠ dgfip)', () => {
    const vues = regrouperParEntite([
      uneFiche({
        slug: 'alaxione-20260820',
        entity: 'Alaxione',
        dates: { revendication: '2026-08-20' },
      }),
      uneFiche({
        slug: 'dgfip-20260812',
        entity: 'Direction générale des Finances publiques (DGFiP)',
        dates: { revendication: '2026-08-12' },
      }),
    ]);
    expect(vues.map((vue) => vue.slug)).toEqual([
      'alaxione',
      'direction-generale-des-finances-publiques-dgfip',
    ]);
  });
});

describe('regrouperParEntite — tri, nom d’affichage, SIREN', () => {
  // Trois graphies distinctes d’une même entité — même clé normalisée « entite ancienne ».
  const fiches = [
    uneFiche({
      slug: 'a-2026',
      entity: 'Entité ancienne',
      dates: { revendication: '2026-01-10' },
    }),
    uneFiche({
      slug: 'a-2027',
      entity: 'Entité Ancienne SAS',
      siren: '123456789',
      dates: { revendication: '2027-02-05', publication: '2027-02-01' },
    }),
    uneFiche({
      slug: 'a-2025',
      entity: 'entité ancienne',
      dates: { revendication: '2025-03-15' },
    }),
  ];

  it('fiches triées par attribution décroissante (publication ?? revendication)', () => {
    const [vue] = regrouperParEntite(fiches);
    expect(vue!.fiches.map((fiche) => fiche.slug)).toEqual(['a-2027', 'a-2026', 'a-2025']);
  });

  it('nom d’affichage = celui de la fiche la plus récente', () => {
    const [vue] = regrouperParEntite(fiches);
    expect(vue!.nom).toBe('Entité Ancienne SAS');
  });

  it('SIREN pris de la fiche la plus récente qui en porte un', () => {
    const [vue] = regrouperParEntite(fiches);
    expect(vue!.siren).toBe('123456789');
  });

  it('SIREN absent de toutes les fiches → undefined', () => {
    const [vue] = regrouperParEntite([
      uneFiche({ slug: 'x-2026', entity: 'X', dates: { revendication: '2026-06-01' } }),
    ]);
    expect(vue!.siren).toBeUndefined();
  });

  it('égalité de dates d’attribution → égalité rompue par slug croissant', () => {
    const [vue] = regrouperParEntite([
      uneFiche({
        slug: 'b-meme-jour',
        entity: 'Même Entité',
        dates: { revendication: '2026-06-01' },
      }),
      uneFiche({
        slug: 'a-meme-jour',
        entity: 'Même Entité SAS',
        dates: { revendication: '2026-06-01' },
      }),
    ]);
    expect(vue!.fiches.map((fiche) => fiche.slug)).toEqual(['a-meme-jour', 'b-meme-jour']);
  });

  it('bornes de l’historique public : revendications extrêmes', () => {
    const [vue] = regrouperParEntite(fiches);
    expect(vue!.premiereDate).toBe('2025-03-15');
    expect(vue!.derniereDate).toBe('2027-02-05');
  });
});

describe('ordinaux de récidive', () => {
  it('1 → 1ʳᵉ, 2 → 2ᵉ, 3 → 3ᵉ, 11 → 11ᵉ', () => {
    expect(ordinalFuite(1)).toBe('1ʳᵉ');
    expect(ordinalFuite(2)).toBe('2ᵉ');
    expect(ordinalFuite(3)).toBe('3ᵉ');
    expect(ordinalFuite(11)).toBe('11ᵉ');
  });
});

describe('descriptionEntite — dérivée, honnête, jamais inventée', () => {
  it('une seule fiche : singulier, pas de borne « entre … et … »', () => {
    const [vue] = regrouperParEntite([
      uneFiche({
        slug: 'ird-20260817',
        entity: 'IRD',
        dates: { revendication: '2026-08-17', publication: '2026-08-19' },
      }),
    ]);
    expect(descriptionEntite(vue!)).toBe(
      'IRD : 1 fuite de données recensée par FrancePassoire le 17 août 2026 — statut de vérification, volume annoncé et sources citées sur la fiche.',
    );
  });

  it('plusieurs fiches : pluriel avec bornes de l’historique', () => {
    const [vue] = regrouperParEntite([
      uneFiche({
        slug: 'e-2025',
        entity: 'Entité',
        dates: { revendication: '2025-03-15' },
      }),
      uneFiche({
        slug: 'e-2026',
        entity: 'Entité',
        dates: { revendication: '2026-08-20' },
      }),
    ]);
    expect(descriptionEntite(vue!)).toBe(
      'Entité : 2 fuites de données recensées par FrancePassoire entre le 15 mars 2025 et le 20 août 2026 — statuts, volumes annoncés et sources citées, fiche par fiche.',
    );
  });
});

describe('libellés et formatage', () => {
  it('secteurs, statuts et classes de pastille', () => {
    expect(labelSecteur('public')).toBe('Public');
    expect(labelStatut('confirmee')).toBe('Confirmée');
    expect(classeStatut('revendiquee')).toBe('pill-revendiquee');
    expect(classeStatut('confirmee')).toBe('pill-confirmee');
  });

  it('SIREN affiché en triples : 811197557 → 811 197 557', () => {
    expect(formaterSiren('811197557')).toBe('811 197 557');
  });

  it('date d’attribution : publication à défaut revendication', () => {
    expect(
      dateAttribution(
        uneFiche({
          slug: 'd-1',
          entity: 'D',
          dates: { revendication: '2026-08-01', publication: '2026-08-05' },
        }),
      ),
    ).toBe('2026-08-05');
    expect(
      dateAttribution(
        uneFiche({ slug: 'd-2', entity: 'D', dates: { revendication: '2026-08-02' } }),
      ),
    ).toBe('2026-08-02');
  });
});
