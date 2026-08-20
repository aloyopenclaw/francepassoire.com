import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
// Adapter HIBP (T17, Wave 2) : diff de catalogue /breaches (keyless) contre un
// snapshot précédent + filtre de pertinence France. Fixtures « recorded-style »
// calquées sur le modèle réel de l'API v3. Aucun réseau ici — fetch mocké.
import { hibpDiffAdapter, type BreachSummary } from '../../workers/ingest/adapters/hibp';
import type { Candidate } from '../../workers/ingest/src/adapter';

const fixturesDir = 'tests/fixtures/adapters/';
const loadJson = (name: string): unknown => JSON.parse(readFileSync(`${fixturesDir}${name}`, 'utf-8'));

const snapshotA = loadJson('hibp-snapshot-a.json') as BreachSummary[];
const snapshotB = loadJson('hibp-snapshot-b.json') as BreachSummary[];
const breachVitte = snapshotB.find((b) => b.Name === 'VitteAuto') as BreachSummary;

const jsonResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } });
const fetchServing = (body: string, status = 200) =>
  vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
      jsonResponse(body, status),
  );

const entityNames = (candidates: Candidate[]): (string | null)[] => candidates.map((c) => c.entity_name);

describe('adapter HIBP — diff de catalogue', () => {
  it('détecte exactement la 1 nouvelle fuite entre snapshot A et B (la modifiée n’est pas un événement)', async () => {
    const fetchMock = fetchServing(JSON.stringify(snapshotB));
    const adapter = hibpDiffAdapter({ previousCatalog: snapshotA });

    const candidates = await adapter.fetchCandidates(fetchMock);

    expect(entityNames(candidates)).toEqual(['VitteAuto']); // Alaxione modifiée ≠ nouvelle
    expect(candidates[0]?.source).toBe('hibp');
    expect(candidates[0]?.source_url).toBeNull();
    expect(candidates[0]?.raw).toBe(JSON.stringify(breachVitte)); // JSON complet de la fuite
  });

  it('interroge l’endpoint keyless /api/v3/breaches avec un User-Agent identifiable', async () => {
    const fetchMock = fetchServing('[]');
    const adapter = hibpDiffAdapter({ previousCatalog: snapshotA });

    await adapter.fetchCandidates(fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://haveibeenpwned.com/api/v3/breaches');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string>)['User-Agent']).toMatch(/FrancePassoire/);
  });

  it('accepte le catalogue précédent sous forme de string JSON (forme stockée en KV)', async () => {
    const fetchMock = fetchServing(JSON.stringify(snapshotB));
    const adapter = hibpDiffAdapter({ previousCatalog: JSON.stringify(snapshotA) });

    const candidates = await adapter.fetchCandidates(fetchMock);

    expect(entityNames(candidates)).toEqual(['VitteAuto']);
  });

  it('sans catalogue précédent → [] : premier run, il ne fait qu’amorcer l’état (persistance KV au T19)', async () => {
    const fetchMock = fetchServing(JSON.stringify(snapshotB));
    const adapter = hibpDiffAdapter();

    const candidates = await adapter.fetchCandidates(fetchMock);

    expect(candidates).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // l’appel a bien lieu : le runner sauvegardera ce snapshot
  });

  it('snapshot précédent illisible (JSON corrompu) → traité comme premier run : [] sans fausse alerte', async () => {
    const fetchMock = fetchServing(JSON.stringify(snapshotB));
    const adapter = hibpDiffAdapter({ previousCatalog: '{"corrompu":' });

    const candidates = await adapter.fetchCandidates(fetchMock);

    expect(candidates).toEqual([]);
  });
});

describe('adapter HIBP — pertinence France (règle conservatrice)', () => {
  it('garde un domaine en .fr, ignore .com et un faux suffixe .frl', async () => {
    const gadget: BreachSummary = {
      Name: 'GadgetHub', Domain: 'gadgethub.com', BreachDate: '2026-08-01', AddedDate: '2026-08-19T00:00:00Z',
    };
    const frl: BreachSummary = {
      Name: 'FrlExample', Domain: 'example.frl', BreachDate: '2026-08-01', AddedDate: '2026-08-19T00:00:00Z',
    };
    const current = [...snapshotA, breachVitte, gadget, frl];
    const adapter = hibpDiffAdapter({ previousCatalog: snapshotA });

    const candidates = await adapter.fetchCandidates(
      fetchServing(JSON.stringify(current)),
    );

    expect(entityNames(candidates)).toEqual(['VitteAuto']);
  });

  it('reconnaît une organisation française par son nom même sans domaine .fr (jeton curé)', async () => {
    const blablacar: BreachSummary = {
      Name: 'BlaBlaCar', Domain: 'corp.com', BreachDate: '2026-08-02', AddedDate: '2026-08-19T00:00:00Z',
    };
    const adapter = hibpDiffAdapter({ previousCatalog: snapshotA });

    const candidates = await adapter.fetchCandidates(
      fetchServing(JSON.stringify([...snapshotA, blablacar])),
    );

    expect(entityNames(candidates)).toEqual(['BlaBlaCar']);
  });

  it('reste conservateur : jeton ambigu volontairement absent (OrangeCountyUtilities ≠ Orange)', async () => {
    const orangeCounty: BreachSummary = {
      Name: 'OrangeCountyUtilities', Domain: '', BreachDate: '2026-08-02', AddedDate: '2026-08-19T00:00:00Z',
    };
    const adapter = hibpDiffAdapter({ previousCatalog: snapshotA });

    const candidates = await adapter.fetchCandidates(
      fetchServing(JSON.stringify([...snapshotA, orangeCounty])),
    );

    expect(candidates).toEqual([]);
  });

  it('ignore sans crash une entrée sans Name (pas un breach exploitable)', async () => {
    const anonyme = { Domain: 'sansnom.fr', PwnCount: 10 } as unknown as BreachSummary;
    const adapter = hibpDiffAdapter({ previousCatalog: snapshotA });

    const candidates = await adapter.fetchCandidates(
      fetchServing(JSON.stringify([...snapshotA, anonyme, breachVitte])),
    );

    expect(entityNames(candidates)).toEqual(['VitteAuto']);
  });
});

describe('adapter HIBP — robustesse (erreurs → [])', () => {
  it('HTTP 500 → []', async () => {
    const adapter = hibpDiffAdapter({ previousCatalog: snapshotA });
    const candidates = await adapter.fetchCandidates(fetchServing('internal error', 500));
    expect(candidates).toEqual([]);
  });

  it('HTTP 200 mais JSON malformé → []', async () => {
    const adapter = hibpDiffAdapter({ previousCatalog: snapshotA });
    const candidates = await adapter.fetchCandidates(fetchServing('{"pas": "un tableau"'));
    expect(candidates).toEqual([]);
  });

  it('HTTP 200 mais corps non-tableau → []', async () => {
    const adapter = hibpDiffAdapter({ previousCatalog: snapshotA });
    const candidates = await adapter.fetchCandidates(fetchServing('{"Name": "ObjetSolitaire"}'));
    expect(candidates).toEqual([]);
  });

  it('fetch qui jette → [] (jamais d’exception vers le runner)', async () => {
    const adapter = hibpDiffAdapter({ previousCatalog: snapshotA });
    const boom = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      throw new Error('network unreachable');
    });
    const candidates = await adapter.fetchCandidates(boom);
    expect(candidates).toEqual([]);
  });
});

describe('verdict de licence fuitesinfos (décision épinglée n° 9)', () => {
  it('docs/registry-license-verdict.md existe et consigne le verdict NON PERMISSIF', () => {
    const verdictPath = 'docs/registry-license-verdict.md';
    expect(existsSync(verdictPath)).toBe(true);
    const verdict = readFileSync(verdictPath, 'utf-8');
    expect(verdict).toContain('NON PERMISSIF');
    expect(verdict).toContain('https://raw.githubusercontent.com/CedHaurus/fuitesinfos-transparence/main/LICENSE');
  });

  it('gate d’exclusion : aucun adapter registre construit tant que la licence est absente', () => {
    expect(existsSync('workers/ingest/adapters/registre.ts')).toBe(false);
    expect(existsSync('docs/license-exclusion.md')).toBe(true);
  });
});
