import { describe, expect, it } from 'vitest';
import {
  composerDossiers,
  phraseDescription,
  phraseIntro,
  slugDeGroupe,
  type DossierGroupe,
} from '../src/lib/group-view';
import type { Fiche } from '../src/lib/fiche-schema';

// ---------------------------------------------------------------------------
// Fabrique — fiches synthétiques valides, seul le champ `group` varie selon
// le scénario (c'est lui qui alimente les dossiers).
// ---------------------------------------------------------------------------

interface Fabrique {
  slug: string;
  entity?: string;
  group?: string;
  statut?: Fiche['statut'];
  revendication: string;
  count: number;
  unit?: Fiche['volume']['unit'];
}

function fiche(o: Fabrique): Fiche {
  return {
    slug: o.slug,
    entity: o.entity ?? `Entité ${o.slug} (fictive)`,
    secteur: 'services',
    statut: o.statut ?? 'revendiquee',
    dates: { revendication: o.revendication },
    volume: {
      count: o.count,
      unit: o.unit ?? 'personnes',
      label: `${o.count} volumes (exemple)`,
    },
    data_types: ['identite'],
    sources: [
      {
        label: 'Source exemple',
        url: 'https://exemple.fr/source',
        kind: 'article',
      },
    ],
    description:
      'Fiche synthétique de test pour les dossiers de groupe : seuls le champ group, les dates, les statuts et les volumes varient selon le scénario.',
    timeline: [{ date: o.revendication, event: 'Revendication (exemple).' }],
    ...(o.group !== undefined ? { group: o.group } : {}),
  };
}

// ---------------------------------------------------------------------------
// slugDeGroupe — contrat slugs.ts
// ---------------------------------------------------------------------------

describe('slugDeGroupe', () => {
  it('replie le nom du groupe en segment [a-z0-9-]', () => {
    expect(slugDeGroupe('Qilin')).toBe('qilin');
    expect(slugDeGroupe('Conti Team')).toBe('conti-team');
    expect(slugDeGroupe('LockBit 3.0')).toBe('lockbit-3-0');
  });
});

// ---------------------------------------------------------------------------
// composerDossiers — regroupement
// ---------------------------------------------------------------------------

describe('composerDossiers — regroupement', () => {
  it('catalogue vide → aucun dossier (0 page générée)', () => {
    expect(composerDossiers([])).toEqual([]);
  });

  it('fiches sans champ group → aucun dossier', () => {
    const fiches = [fiche({ slug: 'a', revendication: '2026-01-01', count: 10 })];
    expect(composerDossiers(fiches)).toEqual([]);
  });

  it('group absent (chaîne blanche) → traité comme non renseigné', () => {
    const fiches = [
      fiche({ slug: 'a', group: '   ', revendication: '2026-01-01', count: 10 }),
    ];
    expect(composerDossiers(fiches)).toEqual([]);
  });

  it('deux groupes distincts → deux dossiers triés par slug', () => {
    const dossiers = composerDossiers([
      fiche({ slug: 'x', group: 'Zeppelin', revendication: '2026-02-02', count: 1 }),
      fiche({ slug: 'y', group: 'Akira', revendication: '2026-03-03', count: 2 }),
    ]);
    expect(dossiers.map((d) => d.slug)).toEqual(['akira', 'zeppelin']);
  });

  it('deux graphies qui replient au même slug → un seul dossier fusionné', () => {
    const dossiers = composerDossiers([
      fiche({ slug: 'a', group: 'Qilin', revendication: '2026-01-01', count: 1 }),
      fiche({ slug: 'b', group: 'qilin', revendication: '2026-02-02', count: 2 }),
      fiche({ slug: 'c', group: 'Qilin', revendication: '2026-03-03', count: 3 }),
    ]);
    expect(dossiers).toHaveLength(1);
    expect(dossiers[0].fiches).toHaveLength(3);
  });

  it('nom d’affichage = graphie la plus fréquente (égalité → alphabétique)', () => {
    const dossiers = composerDossiers([
      fiche({ slug: 'a', group: 'qilin', revendication: '2026-01-01', count: 1 }),
      fiche({ slug: 'b', group: 'QILIN', revendication: '2026-02-02', count: 2 }),
    ]);
    expect(dossiers[0].nom).toBe('QILIN');
  });
});

// ---------------------------------------------------------------------------
// composerDossiers — tri de la chronologie
// ---------------------------------------------------------------------------

describe('composerDossiers — tri', () => {
  it('fiches triées par date de revendication décroissante, égalité → entité', () => {
    const dossiers = composerDossiers([
      fiche({ slug: 'a', entity: 'Alpha', group: 'Qilin', revendication: '2026-01-01', count: 1 }),
      fiche({ slug: 'b', entity: 'Zulu', group: 'Qilin', revendication: '2026-03-03', count: 2 }),
      fiche({ slug: 'c', entity: 'Beta', group: 'Qilin', revendication: '2026-03-03', count: 3 }),
    ]);
    expect(dossiers[0].fiches.map((f) => f.entity)).toEqual(['Beta', 'Zulu', 'Alpha']);
  });

  it('années couvertes, croissantes et dédupliquées', () => {
    const dossiers = composerDossiers([
      fiche({ slug: 'a', group: 'Qilin', revendication: '2026-01-01', count: 1 }),
      fiche({ slug: 'b', group: 'Qilin', revendication: '2025-11-11', count: 2 }),
      fiche({ slug: 'c', group: 'Qilin', revendication: '2026-05-05', count: 3 }),
    ]);
    expect(dossiers[0].annees).toEqual([2025, 2026]);
  });
});

// ---------------------------------------------------------------------------
// composerDossiers — volumes et honnêteté (règle stats.ts)
// ---------------------------------------------------------------------------

describe('composerDossiers — volumes', () => {
  it('totaux par unité, jamais sommés entre unités, ordre personnes puis lignes', () => {
    const dossiers = composerDossiers([
      fiche({ slug: 'a', group: 'Qilin', revendication: '2026-01-01', count: 100 }),
      fiche({ slug: 'b', group: 'Qilin', revendication: '2026-02-02', count: 50, unit: 'lignes' }),
      fiche({ slug: 'c', group: 'Qilin', revendication: '2026-03-03', count: 25 }),
    ]);
    expect(dossiers[0].volumes).toEqual([
      { unit: 'personnes', count: 125 },
      { unit: 'lignes', count: 50 },
    ]);
  });

  it('une seule fiche revendiquée → étiquette « chiffres revendiqués, non confirmés »', () => {
    const dossiers = composerDossiers([
      fiche({ slug: 'a', group: 'Qilin', revendication: '2026-01-01', count: 1, statut: 'confirmee' }),
      fiche({ slug: 'b', group: 'Qilin', revendication: '2026-02-02', count: 2, statut: 'revendiquee' }),
    ]);
    expect(dossiers[0].volumesLabel).toBe('chiffres revendiqués, non confirmés');
  });

  it('toutes confirmées → étiquette « chiffres confirmés »', () => {
    const dossiers = composerDossiers([
      fiche({ slug: 'a', group: 'Qilin', revendication: '2026-01-01', count: 1, statut: 'confirmee' }),
    ]);
    expect(dossiers[0].volumesLabel).toBe('chiffres confirmés');
  });
});

// ---------------------------------------------------------------------------
// Phrases dérivées
// ---------------------------------------------------------------------------

describe('phrases dérivées', () => {
  const une: DossierGroupe = composerDossiers([
    fiche({ slug: 'a', group: 'Qilin', revendication: '2026-01-01', count: 1 }),
  ])[0];
  const trois: DossierGroupe = composerDossiers([
    fiche({ slug: 'a', group: 'Qilin', revendication: '2026-01-01', count: 1 }),
    fiche({ slug: 'b', group: 'Qilin', revendication: '2026-02-02', count: 2 }),
    fiche({ slug: 'c', group: 'Qilin', revendication: '2026-03-03', count: 3 }),
  ])[0];

  it('phraseIntro — singulier puis pluriel', () => {
    expect(phraseIntro(une)).toBe(
      'Qilin apparaît dans 1 fiche de fuite revendiquée touchant des entités françaises.',
    );
    expect(phraseIntro(trois)).toBe(
      'Qilin apparaît dans 3 fiches de fuites revendiquées touchant des entités françaises.',
    );
  });

  it('phraseDescription — singulier puis pluriel, factuelle', () => {
    expect(phraseDescription(une)).toContain('Qilin : 1 fuite revendiquée');
    expect(phraseDescription(trois)).toContain('Qilin : 3 fuites revendiquées');
  });

  it('aucune glorification dans les phrases dérivées', () => {
    const texte = `${phraseIntro(trois)} ${phraseDescription(trois)}`;
    expect(texte).not.toMatch(/légendaire|puissant|redoutable|sophistiqué/i);
  });
});
