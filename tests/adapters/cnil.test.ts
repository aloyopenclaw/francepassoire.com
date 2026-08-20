import { afterEach, describe, expect, it, vi } from 'vitest';
// Adapters CNIL (T16) — sanctions (HTML réel enregistré) + stats trimestrielles
// data.gouv (CSV Windows-1252 rogné). Vérifications à la main faites sur le
// contenu exact des fixtures (voir assertions datées ci-dessous).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CNIL_DATASET_API_URL,
  CNIL_MAX_RUNS_PER_DAY,
  CNIL_SANCTIONS_URL,
  cnilDataGouvAdapter,
  cnilSanctionsAdapter,
  isDailyRateOk,
  parseCnilSanctions,
  parseCnilStats,
} from '../../workers/ingest/adapters/cnil';

const fixturesDir = fileURLToPath(new URL('../fixtures/adapters/', import.meta.url));
const fixture = (name: string): string => readFileSync(`${fixturesDir}${name}`, 'utf8');
/** Le CSV CNIL est encodé Windows-1252, pas UTF-8 (vérifié sur le téléchargement réel). */
const fixtureCp1252 = (name: string): string =>
  new TextDecoder('windows-1252').decode(readFileSync(`${fixturesDir}${name}`));

const fetchServant =
  (body: string, status = 200): typeof fetch =>
  (async () => new Response(body, { status })) as unknown as typeof fetch;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cnil sanctions — page réelle enregistrée (2026-08-20)', () => {
  it('parse la totalité des 16 tableaux annuels : 395 sanctions', () => {
    const candidats = parseCnilSanctions(fixture('cnil-sanctions.html'));

    // 396 lignes <td> dans la page, dont 1 note de bas de tableau colspan
    // (« * Recours pendant devant le Conseil d'Etat ») qui n'est pas une
    // sanction — vérifié à la main sur la fixture.
    expect(candidats).toHaveLength(395);
    expect(candidats.every((c) => c.source === 'cnil-sanctions')).toBe(true);
    expect(candidats.every((c) => typeof c.raw === 'string' && c.raw.length > 0)).toBe(true);
  });

  it('première ligne 2026 vérifiée à la main : entité + date + lien Légifrance + manquements', () => {
    const candidats = parseCnilSanctions(fixture('cnil-sanctions.html'));
    const sanction = candidats.find(
      (c) => c.source_url === 'https://www.legifrance.gouv.fr/cnil/id/CNILTEXT000053352594',
    );

    expect(sanction).toBeDefined();
    expect(sanction?.entity_name).toBe('OPÉRATEUR DE TÉLÉPHONIE MOBILE');
    const raw = JSON.parse(sanction?.raw ?? '{}') as {
      date: string;
      organisme: string;
      manquements: string[];
      decision: string;
    };
    expect(raw.date).toBe('08/01/2026');
    expect(raw.organisme).toBe('OPÉRATEUR DE TÉLÉPHONIE MOBILE');
    expect(raw.manquements).toContain('Durée de conservation');
    expect(raw.manquements).toContain("Défaut de sécurité des données");
    expect(raw.decision).toContain("27 millions d'euros");
  });

  it('tableau historique 5 colonnes (2017) : ligne BANQUE du 26/01/2017 parsée', () => {
    const candidats = parseCnilSanctions(fixture('cnil-sanctions.html'));
    const banque = candidats.find(
      (c) => c.source_url === 'https://www.legifrance.gouv.fr/cnil/id/CNILTEXT000033954589/',
    );

    expect(banque).toBeDefined();
    expect(banque?.entity_name).toBe('BANQUE');
    const raw = JSON.parse(banque?.raw ?? '{}') as { date: string; theme: string };
    expect(raw.date).toBe('26/01/2017');
    expect(raw.theme).toBe('Fichage banque de France');
  });

  it('markup muté (cellules détruites) → 0 sanction + console.warn, pas d’exception', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mute = fixture('cnil-sanctions.html').replace(/<t[dh]/g, '<tx');

    expect(parseCnilSanctions(mute)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('markup'), expect.anything());
  });

  it('HTML sans aucun tableau → [] + console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parseCnilSanctions('<html><body><h1>Maintenance</h1></body></html>')).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('adapter : HTTP non-200 → [] + avertissement (l’URL réelle est codée en dur)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const candidats = await cnilSanctionsAdapter.fetchCandidates(fetchServant('erreur', 404));

    expect(candidats).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('404'), expect.anything());
  });

  it('adapter : sert bien la page courante /fr/les-sanctions-prononcees-par-la-cnil', async () => {
    expect(CNIL_SANCTIONS_URL).toBe('https://www.cnil.fr/fr/les-sanctions-prononcees-par-la-cnil');
  });
});

describe('cnil — cadence max 1 run/jour (garde pure pour le runner T19)', () => {
  it('constante documentée : exactement 1 run/jour autorisé', () => {
    expect(CNIL_MAX_RUNS_PER_DAY).toBe(1);
  });

  it('même jour UTC que le dernier run → false (3 variantes)', () => {
    expect(isDailyRateOk('2026-08-20T08:00:00.000Z', new Date('2026-08-20T08:00:00.000Z'))).toBe(
      false,
    );
    expect(isDailyRateOk('2026-08-20T00:30:00.000Z', new Date('2026-08-20T23:59:00.000Z'))).toBe(
      false,
    );
    expect(isDailyRateOk('2026-08-20T23:59:00.000Z', new Date('2026-08-20T00:00:00.000Z'))).toBe(
      false,
    );
  });

  it('jamais exécuté, jour écoulé ou état illisible → true', () => {
    expect(isDailyRateOk(null, new Date('2026-08-20T12:00:00.000Z'))).toBe(true);
    expect(isDailyRateOk('2026-08-19T23:59:00.000Z', new Date('2026-08-20T00:00:30.000Z'))).toBe(
      true,
    );
    expect(isDailyRateOk('pas-une-date', new Date('2026-08-20T12:00:00.000Z'))).toBe(true);
  });
});

describe('cnil stats — CSV data.gouv (fixture réelle rognée, cp1252)', () => {
  it('agrège par trimestre × secteur avec des types corrects (14 lignes, 40 violations)', () => {
    const lignes = parseCnilStats(fixtureCp1252('cnil-datagouv-stats.csv'));

    expect(lignes).toHaveLength(14);
    expect(lignes.reduce((n, l) => n + l.violations_notifiees, 0)).toBe(40);
    for (const l of lignes) {
      expect(l.trimestre).toMatch(/^\d{4}-T[1-4]$/);
      expect(l.secteur.length).toBeGreaterThan(0);
      expect(Number.isInteger(l.violations_notifiees)).toBe(true);
      expect(l.violations_notifiees).toBeGreaterThan(0);
    }
    // Chiffres recalculés à la main sur la fixture (voir évidence T16) :
    expect(lignes).toContainEqual({
      trimestre: '2025-T4',
      secteur: 'Administration publique',
      violations_notifiees: 4,
    });
    expect(lignes).toContainEqual({
      trimestre: '2025-T4',
      secteur: "Activités financières et d'assurance", // accents cp1252 + « '' » dé-échappé
      violations_notifiees: 6,
    });
    expect(lignes.filter((l) => l.trimestre === '2024-T2')).toHaveLength(2);
  });

  it('CSV sans ligne d’en-tête CNIL → [] + console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parseCnilStats('a;b;c\n1;2;3\n')).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('lignes de données invalides (mois hors bornes) ignorées sans fausser l’agrégat', () => {
    const csv =
      'Extraction générée le 18 mars 2026;;;;\n' +
      'Date de réception de la notification;Secteur d’activité de l’organisme concerné;Natures de la violation;Nombre de personnes impactées;Typologies des données impactées;Données sensibles;Origines de l’incident;Causes de l’incident;Information des personnes\n' +
      '2025-13;Secteur fictif;Perte de la confidentialité;Entre 0 et 5 personnes;;;;Acte interne accidentel;Oui\n' + // mois 13 invalide
      'garbage;line\n' +
      '2025-12;Secteur réel;Perte de la confidentialité;Entre 0 et 5 personnes;;;;Autre;Oui\n';

    const lignes = parseCnilStats(csv);
    expect(lignes).toEqual([
      { trimestre: '2025-T4', secteur: 'Secteur réel', violations_notifiees: 1 },
    ]);
  });

  it('champs entre guillemets contenant des « ; » : découpe CSV correcte', () => {
    const entete =
      'Date de réception de la notification;Secteur d’activité de l’organisme concerné;Natures de la violation;Nombre de personnes impactées;Typologies des données impactées;Données sensibles;Origines de l’incident;Causes de l’incident;Information des personnes\n';
    const csv =
      entete +
      '2024-06;"Commerce ; réparation d’automobiles et de motocycles";Perte de la confidentialité;Entre 6 et 50 personnes;;;;Autre;Oui\n';

    expect(parseCnilStats(csv)).toEqual([
      {
        trimestre: '2024-T2',
        secteur: 'Commerce ; réparation d’automobiles et de motocycles',
        violations_notifiees: 1,
      },
    ]);
  });
});

describe('cnilDataGouvAdapter — résolution API datasets puis CSV (stats ≠ candidats)', () => {
  it('résout le CSV via l’API, le décode cp1252, et ne produit AUCUN candidat (log du volume)', async () => {
    const csvBytes = readFileSync(`${fixturesDir}cnil-datagouv-stats.csv`);
    const appels: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      appels.push(url);
      if (url === CNIL_DATASET_API_URL) {
        return new Response(fixture('cnil-datagouv-dataset.json'), { status: 200 });
      }
      return new Response(new Uint8Array(csvBytes), { status: 200 });
    }) as unknown as typeof fetch;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const candidats = await cnilDataGouvAdapter.fetchCandidates(fetchFn);

    expect(cnilDataGouvAdapter.id).toBe('cnil-datagouv-stats');
    expect(candidats).toEqual([]); // les stats alimentent /chiffres (T36), pas la file de fiches
    expect(appels).toHaveLength(2); // 1) API datasets 2) CSV statique résolu
    expect(appels[1]).toBe(
      'https://static.data.gouv.fr/resources/notifications-a-la-cnil-de-violations-de-donnees-a-caractere-personnel/20260519-161327/opencnil-violationsdcpnotifiees-20251231.csv',
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining('14'));
  });

  it('API datasets non-200 → [] + avertissement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = (async () => new Response('oops', { status: 500 })) as unknown as typeof fetch;

    expect(await cnilDataGouvAdapter.fetchCandidates(fetchFn)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('500'), expect.anything());
  });

  it('API 200 mais sans ressource CSV → [] + avertissement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = (async () =>
      new Response(JSON.stringify({ resources: [{ title: 'x.xlsx', format: 'xlsx', url: 'https://x/x.xlsx' }] }), {
        status: 200,
      })) as unknown as typeof fetch;

    expect(await cnilDataGouvAdapter.fetchCandidates(fetchFn)).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});
