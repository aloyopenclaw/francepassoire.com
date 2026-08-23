// tests/ma-veille-state.test.ts — cœur pur de la page « Ma veille »
// (/ma-veille/, tâche 56a) : machine d'états sans DOM (normalisation des
// préférences, détection de modification, détection « plus rien de coché »).
// Le rendu et les fetch restent couverts par l'E2E Playwright post-déploiement.
import { describe, expect, it } from 'vitest';
import {
  DATA_TYPES,
  SECTEURS,
  normaliserPrefs,
  prefsEgales,
  prefsVides,
} from '../src/lib/ma-veille-state';

describe('ma-veille-state — normaliserPrefs', () => {
  it('conserve les valeurs connues du worker (secteurs, types, fréquence)', () => {
    expect(
      normaliserPrefs({ sectors: ['sante', 'finance'], data_types: ['identite'], freq: 'quotidien' }),
    ).toEqual({ sectors: ['finance', 'sante'], data_types: ['identite'], freq: 'quotidien' });
  });

  it('jette les valeurs hors énumération (prefs_json ancien ou corrompu)', () => {
    const p = normaliserPrefs({ sectors: ['sante', 'banque', 'education'], data_types: ['email', 'nir', 'credentials'], freq: 'imm' });
    expect(p.sectors).toEqual(['sante']);
    expect(p.data_types).toEqual(['credentials']);
    // Freq hors contrat → « hebdo », même défaut que parsePrefs côté worker.
    expect(p.freq).toBe('hebdo');
  });

  it('trie et déduplique pour une comparaison stable', () => {
    expect(normaliserPrefs({ sectors: ['media', 'sante', 'media'], data_types: [] }).sectors)
      .toEqual(['media', 'sante']);
  });

  it('tolère les champs absents ou non-listes', () => {
    expect(normaliserPrefs({})).toEqual({ sectors: [], data_types: [], freq: 'hebdo' });
    expect(normaliserPrefs({ sectors: 'sante', data_types: null }).sectors).toEqual([]);
  });
});

describe('ma-veille-state — prefsEgales (activation du bouton Enregistrer)', () => {
  it('indépendant de l’ordre des puces', () => {
    const a = normaliserPrefs({ sectors: ['sante', 'media'], data_types: ['identite'], freq: 'hebdo' });
    const b = normaliserPrefs({ sectors: ['media', 'sante'], data_types: ['identite'], freq: 'hebdo' });
    expect(prefsEgales(a, b)).toBe(true);
  });

  it('détecte un secteur, un type et une fréquence modifiés', () => {
    const base = normaliserPrefs({ sectors: ['sante'], data_types: ['identite'], freq: 'hebdo' });
    expect(prefsEgales(base, normaliserPrefs({ sectors: ['sante', 'media'], data_types: ['identite'], freq: 'hebdo' }))).toBe(false);
    expect(prefsEgales(base, normaliserPrefs({ sectors: ['sante'], data_types: ['identite', 'sante'], freq: 'hebdo' }))).toBe(false);
    expect(prefsEgales(base, normaliserPrefs({ sectors: ['sante'], data_types: ['identite'], freq: 'quotidien' }))).toBe(false);
  });

  it('état initial identique à lui-même (bouton désactivé)', () => {
    const p = normaliserPrefs({ sectors: SECTEURS, data_types: DATA_TYPES, freq: 'quotidien' });
    expect(prefsEgales(p, { ...p, sectors: [...p.sectors] })).toBe(true);
  });
});

describe('ma-veille-state — prefsVides (bandeau « Vous ne suivez plus rien »)', () => {
  it('vide = aucun secteur ET aucun type coché', () => {
    expect(prefsVides({ sectors: [], data_types: [], freq: 'quotidien' })).toBe(true);
  });

  it('un seul secteur coché suffit à sortir de l’état vide', () => {
    expect(prefsVides({ sectors: ['autre'], data_types: [], freq: 'hebdo' })).toBe(false);
  });

  it('un seul type coché suffit aussi (fréquence jamais comptée)', () => {
    expect(prefsVides({ sectors: [], data_types: ['autre'], freq: 'hebdo' })).toBe(false);
  });
});
