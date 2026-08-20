import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ficheSchema } from '../src/lib/fiche-schema';
import {
  computeCompteur,
  countUpTarget,
  type FicheLike,
} from '../src/lib/stats';

// ---------------------------------------------------------------------------
// Fixtures — 5 fiches JSON valides schéma, années révolues (2024-2025).
// La banque n'a PAS de publication (année via revendication) ; le retail est
// en « lignes » et le média en « enregistrements » (jamais sommés en
// personnes) ; identite/coordonnees apparaissent chacune sur 2 fiches.
// ---------------------------------------------------------------------------

const fixturesDir = fileURLToPath(new URL('./fixtures/stats/', import.meta.url));

function loadFiche(name: string): FicheLike {
  return ficheSchema.parse(
    JSON.parse(readFileSync(`${fixturesDir}${name}`, 'utf-8')),
  );
}

const FIXTURES: FicheLike[] = [
  'clinique-soleil-2024.json',
  'banque-exemple-2025.json',
  'retail-lignes-2024.json',
  'media-exemple-2025.json',
  'mairie-exemple-2024.json',
].map(loadFiche);

// ---------------------------------------------------------------------------
// Fabrique dynamique — dates ancrées sur l'année courante du run : les tests
// YTD ne périment jamais au changement d'année.
// ---------------------------------------------------------------------------

const ANNEE = new Date().getFullYear();

interface Fabrique {
  slug: string;
  secteur?: FicheLike['secteur'];
  statut?: FicheLike['statut'];
  revendication: string;
  publication?: string;
  count: number;
  unit: FicheLike['volume']['unit'];
  data_types?: FicheLike['data_types'];
}

function fiche(o: Fabrique): FicheLike {
  return {
    slug: o.slug,
    entity: `Entité ${o.slug} (fictive)`,
    secteur: o.secteur ?? 'services',
    statut: o.statut ?? 'confirmee',
    dates: {
      revendication: o.revendication,
      ...(o.publication !== undefined ? { publication: o.publication } : {}),
    },
    volume: { count: o.count, unit: o.unit, label: `${o.count} ${o.unit}` },
    data_types: o.data_types ?? ['identite'],
    sources: [
      {
        label: 'Source exemple',
        url: 'https://exemple.fr/source',
        kind: 'article',
      },
    ],
    description:
      'Fiche synthétique de test pour le Compteur National : volume, dates et statut variés selon le scénario du test en cours.',
    timeline: [{ date: o.revendication, event: 'Revendication (exemple).' }],
  };
}

// ---------------------------------------------------------------------------
// Catalogue vide
// ---------------------------------------------------------------------------

describe('computeCompteur — catalogue vide', () => {
  it('zéros partout, toutes les clés des énumérations présentes, countUpTarget null', () => {
    const c = computeCompteur([]);
    expect(c).toEqual({
      personnesYTD: 0,
      personnesLabel: 'chiffres confirmés',
      fichesCount: 0,
      sectorBars: {
        sante: 0,
        finance: 0,
        retail: 0,
        recherche: 0,
        public: 0,
        industrie: 0,
        services: 0,
        media: 0,
        autre: 0,
      },
      dataTypeBars: {
        identite: 0,
        coordonnees: 0,
        sante: 0,
        financier: 0,
        credentials: 0,
        biometrique: 0,
        documents: 0,
        geolocalisation: 0,
        autre: 0,
      },
      statutSplit: { revendiquee: 0, confirmee: 0 },
      parAnnee: {},
    });
    expect(countUpTarget(c)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Jeu de fixtures (5 fiches, années révolues)
// ---------------------------------------------------------------------------

describe('computeCompteur — jeu de fixtures (5 fiches, années révolues)', () => {
  it('fichesCount = 5', () => {
    expect(computeCompteur(FIXTURES).fichesCount).toBe(5);
  });

  it('sectorBars exact : 5 secteurs observés, 4 à zéro (clés complètes)', () => {
    expect(computeCompteur(FIXTURES).sectorBars).toEqual({
      sante: 1,
      finance: 1,
      retail: 1,
      recherche: 0,
      public: 1,
      industrie: 0,
      services: 0,
      media: 1,
      autre: 0,
    });
  });

  it('dataTypeBars exact : une fiche compte dans chacun de ses data_types', () => {
    expect(computeCompteur(FIXTURES).dataTypeBars).toEqual({
      identite: 2, // clinique + mairie
      coordonnees: 2, // retail + mairie
      sante: 1,
      financier: 1,
      credentials: 1,
      biometrique: 0,
      documents: 1,
      geolocalisation: 1,
      autre: 1,
    });
  });

  it('statutSplit exact : 2 revendiquées, 3 confirmées', () => {
    expect(computeCompteur(FIXTURES).statutSplit).toEqual({
      revendiquee: 2,
      confirmee: 3,
    });
  });

  it('parAnnee exact : la fiche sans publication est attribuée via sa revendication', () => {
    expect(computeCompteur(FIXTURES).parAnnee).toEqual({ '2024': 3, '2025': 2 });
  });

  it('personnesYTD = 0 : aucune fiche de l’année courante (2024-2025 révolues)', () => {
    expect(computeCompteur(FIXTURES).personnesYTD).toBe(0);
  });

  it('personnesLabel reste « chiffres confirmés » : les 2 revendiquées ne contribuent pas (années révolues)', () => {
    expect(computeCompteur(FIXTURES).personnesLabel).toBe('chiffres confirmés');
  });

  it('countUpTarget = 0 honnête (catalogue non vide, aucune personne comptée)', () => {
    expect(countUpTarget(computeCompteur(FIXTURES))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// personnesYTD — unités et années (fabriques, année courante)
// ---------------------------------------------------------------------------

describe('personnesYTD — unités et attribution d’année', () => {
  it('somme personnes + comptes de l’année courante ; lignes et enregistrements exclus', () => {
    const fiches = [
      fiche({ slug: 'a', revendication: `${ANNEE}-01-05`, count: 100, unit: 'personnes' }),
      fiche({ slug: 'b', revendication: `${ANNEE}-02-05`, count: 40, unit: 'comptes' }),
      fiche({ slug: 'c', revendication: `${ANNEE}-03-05`, count: 999_999, unit: 'lignes' }),
      fiche({ slug: 'd', revendication: `${ANNEE}-04-05`, count: 888_888, unit: 'enregistrements' }),
    ];
    expect(computeCompteur(fiches).personnesYTD).toBe(140);
  });

  it('anti-stale : ajouter une fiche de 1000 personnes incrémente personnesYTD d’exactement 1000', () => {
    const une = [
      fiche({ slug: 'base', revendication: `${ANNEE}-02-01`, count: 5_000, unit: 'personnes' }),
    ];
    const deux = [
      ...une,
      fiche({ slug: 'ajout', revendication: `${ANNEE}-04-10`, count: 1_000, unit: 'personnes' }),
    ];
    const avant = computeCompteur(une);
    const apres = computeCompteur(deux);
    expect(apres.personnesYTD - avant.personnesYTD).toBe(1_000);
    expect(apres.fichesCount - avant.fichesCount).toBe(1);
  });

  it('attribution : publication absente → revendication utilisée (fiche de l’année courante comptée)', () => {
    const fiches = [
      fiche({ slug: 'sans-pub', revendication: `${ANNEE}-05-01`, count: 250, unit: 'personnes' }),
    ];
    expect(computeCompteur(fiches).personnesYTD).toBe(250);
  });

  it('attribution : publication prime sur revendication (bascule d’année civile)', () => {
    const fiches = [
      fiche({
        slug: 'bascule',
        revendication: `${ANNEE}-12-31`,
        publication: `${ANNEE + 1}-01-05`,
        count: 250,
        unit: 'personnes',
      }),
    ];
    const c = computeCompteur(fiches);
    expect(c.parAnnee).toEqual({ [String(ANNEE + 1)]: 1 });
    expect(c.personnesYTD).toBe(0);
  });

  it('fiche de personnes d’une année révolue non comptée dans YTD', () => {
    const fiches = [
      fiche({ slug: 'vieux', revendication: `${ANNEE - 1}-06-01`, count: 10_000, unit: 'personnes' }),
    ];
    expect(computeCompteur(fiches).personnesYTD).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// personnesLabel — règle d'honnêteté des volumes (« chiffres revendiqués »)
// ---------------------------------------------------------------------------

describe('personnesLabel — honnêteté des volumes', () => {
  it('toutes les contributrices confirmées → « chiffres confirmés »', () => {
    const fiches = [
      fiche({ slug: 'ok', statut: 'confirmee', revendication: `${ANNEE}-03-01`, count: 100, unit: 'personnes' }),
    ];
    expect(computeCompteur(fiches).personnesLabel).toBe('chiffres confirmés');
  });

  it('une seule contributrice revendiquée suffit → « chiffres revendiqués, non confirmés »', () => {
    const fiches = [
      fiche({ slug: 'ok', statut: 'confirmee', revendication: `${ANNEE}-03-01`, count: 100, unit: 'personnes' }),
      fiche({ slug: 'nk', statut: 'revendiquee', revendication: `${ANNEE}-04-01`, count: 200, unit: 'personnes' }),
    ];
    expect(computeCompteur(fiches).personnesLabel).toBe(
      'chiffres revendiqués, non confirmés',
    );
  });
});

// ---------------------------------------------------------------------------
// Déterminisme (fonction pure : mêmes fiches → même compteur)
// ---------------------------------------------------------------------------

describe('déterminisme (mêmes fiches → même compteur)', () => {
  it('fixtures ×2 → deep-equal', () => {
    expect(computeCompteur(FIXTURES)).toEqual(computeCompteur(FIXTURES));
  });

  it('fabriques ×2 → deep-equal', () => {
    const fiches = [
      fiche({ slug: 'a', statut: 'revendiquee', revendication: `${ANNEE}-01-01`, count: 10, unit: 'comptes' }),
      fiche({
        slug: 'b',
        revendication: `${ANNEE - 1}-01-01`,
        count: 20,
        unit: 'personnes',
        data_types: ['sante', 'financier'],
      }),
    ];
    expect(computeCompteur(fiches)).toEqual(computeCompteur(fiches));
  });
});
