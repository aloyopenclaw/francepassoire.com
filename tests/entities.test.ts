import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  dedupScore,
  normalizeName,
  resolveSiren,
  similarity,
  type EntityRecord,
  type FetchFn,
} from '../src/lib/entities';

const fixturesDir = fileURLToPath(
  new URL('./fixtures/entities/', import.meta.url),
);

function loadRechercheFixture(): string {
  return readFileSync(`${fixturesDir}recherche-alaxione.json`, 'utf-8');
}

// Adapter d'API injectable : capture l'URL demandée et renvoie une réponse
// contrôlée — aucun réseau n'est touché par ces tests.
function fakeFetch(body: string, status = 200): { fetchFn: FetchFn; lastUrl: () => string } {
  let url = '';
  const fetchFn: FetchFn = async (u) => {
    url = u;
    return new Response(body, { status });
  };
  return { fetchFn, lastUrl: () => url };
}

describe('normalizeName (normalisation française)', () => {
  it('replie les accents : é → e', () => {
    expect(normalizeName('Café SAS')).toBe('cafe');
  });

  it('supprime les formes juridiques en fin de nom : SASU, SARL', () => {
    expect(normalizeName('Alaxione SASU')).toBe('alaxione');
    expect(normalizeName('FOO SARL')).toBe('foo');
  });

  it('conserve la forme juridique en tête de nom (partie de la dénomination)', () => {
    // Documenté : seuls les tokens FINAUX sont retirés — « SAS Services »
    // est une dénomination dont « SAS » est le premier mot, on le garde.
    expect(normalizeName('SAS Services')).toBe('sas services');
  });

  it('convertit les tirets en espaces', () => {
    expect(normalizeName('Pôle-Emploi')).toBe('pole emploi');
  });

  it('ignore la casse', () => {
    expect(normalizeName('aLaXiOnE')).toBe('alaxione');
  });

  it("normalise les apostrophes (élision jointe) : Caisse d'Épargne", () => {
    expect(normalizeName("Caisse d'Épargne")).toBe('caisse depargne');
    // apostrophe typographique U+2019 ≡ apostrophe ASCII
    expect(normalizeName('Caisse d’Épargne')).toBe('caisse depargne');
  });

  it('colle les espaces multiples et retire la ponctuation périphérique', () => {
    expect(normalizeName('  Foo   Bar SARL. ')).toBe('foo bar');
  });

  it('rend « Alaxione SAS » équivalent à « alaxione »', () => {
    expect(normalizeName('Alaxione SAS')).toBe(normalizeName('alaxione'));
  });
});

describe('similarity (token-set ratio sans dépendance)', () => {
  it('noms identiques → 1', () => {
    expect(similarity('Alaxione', 'ALAXIONE')).toBe(1);
  });

  it('noms disjoints → 0', () => {
    expect(similarity('Boulangerie Martin', 'Clinique Saint-Roch')).toBe(0);
  });

  it('inclusion de sous-ensemble → score élevé mais < 1', () => {
    const s = similarity('alaxione', 'alaxione consultants europe');
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(1);
  });

  it('chaîne vide : identiques → 1, disjoints → 0', () => {
    expect(similarity('', '')).toBe(1);
    expect(similarity('', 'alaxione')).toBe(0);
  });
});

describe('dedupScore (pondération 0,6 entité / 0,2 date / 0,2 volume)', () => {
  const entry = {
    entity: 'alaxione',
    date: '2026-05-10',
    volume: 800_000,
  };

  it('« Alaxione SAS » vs « alaxione » (même date, même volume) ≥ 0,9', () => {
    const candidate = { entity: 'Alaxione SAS', date: '2026-05-10', volume: 800_000 };
    expect(dedupScore(candidate, entry)).toBeGreaterThanOrEqual(0.9);
  });

  it('« Alaxio » vs « Alaxione » (même date, même volume) < 0,6', () => {
    const candidate = { entity: 'Alaxio', date: '2026-05-10', volume: 800_000 };
    expect(dedupScore(candidate, entry)).toBeLessThan(0.6);
  });

  it('fenêtre d\'incident ±30 jours → points complets', () => {
    const s0 = dedupScore(
      { entity: 'alaxione', date: '2026-05-10', volume: 800_000 },
      entry,
    );
    const s15 = dedupScore(
      { entity: 'alaxione', date: '2026-05-25', volume: 800_000 },
      entry,
    );
    expect(s15).toBe(s0);
  });

  it('décroissance de la fenêtre de date : 0j > 60j > 150j > 200j', () => {
    const mk = (d: string) =>
      dedupScore({ entity: 'alaxione', date: d, volume: 800_000 }, entry);
    const s0 = mk('2026-05-10');
    const s60 = mk('2026-07-09');
    const s150 = mk('2026-10-07');
    const s200 = mk('2026-11-26');
    expect(s0).toBeGreaterThan(s60);
    expect(s60).toBeGreaterThan(s150);
    expect(s150).toBeGreaterThan(s200);
  });

  it('proximité de volume en échelle log : proche ≫ éloigné', () => {
    const close = dedupScore(
      { entity: 'alaxione', date: '2026-05-10', volume: 1_000 },
      { entity: 'alaxione', date: '2026-05-10', volume: 1_100 },
    );
    const far = dedupScore(
      { entity: 'alaxione', date: '2026-05-10', volume: 1_000 },
      { entity: 'alaxione', date: '2026-05-10', volume: 1_200_000 },
    );
    expect(close).toBeGreaterThan(0.99);
    expect(far).toBeLessThan(0.85);
  });

  it('champs manquants : sans date → 0,8 ; sans date ni volume → 0,6', () => {
    const noDate = dedupScore(
      { entity: 'Alaxione SAS', volume: 800_000 },
      entry,
    );
    expect(noDate).toBeCloseTo(0.8, 10);
    const noDateNoVolume = dedupScore({ entity: 'Alaxione SAS' }, entry);
    expect(noDateNoVolume).toBeCloseTo(0.6, 10);
  });

  it('tous les scores restent dans [0, 1] (série de cas)', () => {
    const pairs: Array<[EntityRecord, EntityRecord]> = [
      [{ entity: 'Alaxione SAS', date: '2026-05-10', volume: 800_000 }, entry],
      [{ entity: 'Autre chose', date: '2020-01-01', volume: 3 }, entry],
      [{ entity: '', date: '2026-05-10' }, entry],
      [{ entity: 'alaxione', date: 'pas-une-date', volume: -5 }, entry],
      [{ entity: 'Caisse d’Épargne', volume: 12_000 }, { entity: "Caisse d'Épargne ASSOCIATION", volume: 50 }],
    ];
    for (const [c, e] of pairs) {
      const s = dedupScore(c, e);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it('déterminisme : mêmes entrées → même score deux fois', () => {
    const candidate = { entity: 'Alaxione SAS', date: '2026-05-25', volume: 900_000 };
    expect(dedupScore(candidate, entry)).toBe(dedupScore(candidate, entry));
    expect(similarity('Foo Bar SAS', 'foo bar')).toBe(
      similarity('Foo Bar SAS', 'foo bar'),
    );
  });
});

describe('resolveSiren (adaptateur API recherche-entreprises)', () => {
  it('mappe les champs depuis le fixture enregistré et interroge la bonne URL', async () => {
    const { fetchFn, lastUrl } = fakeFetch(loadRechercheFixture());
    const results = await resolveSiren('alaxione', fetchFn);
    expect(lastUrl()).toBe(
      'https://recherche-entreprises.api.gouv.fr/search?q=alaxione',
    );
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      siren: '811197557',
      denomination: 'ALAXIONE',
      score: 1,
    });
    expect(results[1]?.siren).toBe('414648741');
    expect(results[2]?.denomination).toBe('ALAXION CONSULTANTS EUROPE');
    for (const r of results) {
      if (r.score !== undefined) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    }
  });

  it('encode le nom de la requête', async () => {
    const { fetchFn, lastUrl } = fakeFetch(loadRechercheFixture());
    await resolveSiren('Caisse d’Épargne', fetchFn);
    expect(lastUrl()).toContain(
      `q=${encodeURIComponent('Caisse d’Épargne')}`,
    );
  });

  it('HTTP 500 → tableau vide (jamais d\'exception)', async () => {
    const { fetchFn } = fakeFetch('boom', 500);
    await expect(resolveSiren('alaxione', fetchFn)).resolves.toEqual([]);
  });

  it('JSON malformé → tableau vide', async () => {
    const { fetchFn } = fakeFetch('{oops');
    await expect(resolveSiren('alaxione', fetchFn)).resolves.toEqual([]);
  });

  it('erreur réseau (fetch qui lève) → tableau vide', async () => {
    const fetchFn: FetchFn = async () => {
      throw new Error('network down');
    };
    await expect(resolveSiren('alaxione', fetchFn)).resolves.toEqual([]);
  });
});
