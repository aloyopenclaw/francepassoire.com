import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Adapter ransomware.live PRO (T54b) testé contre une cassette fixture
// enregistrée depuis l'API réelle le 2026-08-23 :
// GET https://api-pro.ransomware.live/victims/recent (en-tête X-API-KEY,
// clé <clé> — jamais dans le dépôt, quarantaine ~/.config/francepassoire/).
//
// PROVENANCE DU FIXTURE : tests/fixtures/adapters/ransomware-live-pro-recent.json
// est la réponse réelle ROGNÉE — la payload live enveloppe 100 victimes dans
// {client, count, order, victims} ; on a gardé les enregistrements d'indices
// 0-48 plus ceux d'indices 54 et 95 (les 2 victimes FR) pour tenir en 51
// entrées en conservant 2 FR + 49 non-FR. Chaque enregistrement est inchangé
// (aucun champ édité) ; seule l'enveloppe perd son champ `client` (email du
// compte de la clé API — écarté du dépôt par prudence, jamais lu par
// l'adapter) et `count` vaut 100 = taille de la réponse COMPLÈTE.
//
// Mapping free→PRO vérifié en live : url→permalink, claim_url→post_url,
// domain→website, +champ id ; tableau nu → enveloppe {victims:[…]}.
import { ransomwareLiveAdapter } from '../../workers/ingest/adapters/ransomware-live';
import type { Candidate } from '../../workers/ingest/src/adapter';

const fixtureText = readFileSync(
  new URL('../fixtures/adapters/ransomware-live-pro-recent.json', import.meta.url),
  'utf-8',
);

/** Clé factice des tests — jamais une vraie clé. */
const CLE_TEST = 'cle-pro-test';

/** Type structurel d'un enregistrement victime tel que renvoyé par l'API PRO. */
interface VictimRecord {
  victim?: unknown;
  group?: unknown;
  country?: unknown;
  permalink?: unknown;
  post_url?: unknown;
  [champ: string]: unknown;
}

const fixtureVictims: VictimRecord[] = (JSON.parse(fixtureText) as { victims: VictimRecord[] }).victims;
const frVictims = fixtureVictims.filter(
  (v) => typeof v.country === 'string' && v.country.toUpperCase() === 'FR',
);
const nonFrCount = fixtureVictims.length - frVictims.length;

const jsonResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ransomware.live adapter — cassette fixture PRO', () => {
  it("interroge l'URL exacte du PRO avec l'en-tête X-API-KEY", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixtureText));
    await ransomwareLiveAdapter(CLE_TEST).fetchCandidates(fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('https://api-pro.ransomware.live/victims/recent', {
      headers: { 'X-API-KEY': CLE_TEST },
    });
  });

  it('garde les victimes FR et mappe les champs du contrat Candidate', async () => {
    // Garde-fou provenance : la cassette doit contenir au moins 2 FR et 3 non-FR.
    expect(frVictims.length).toBeGreaterThanOrEqual(2);
    expect(nonFrCount).toBeGreaterThanOrEqual(3);

    const candidats = await ransomwareLiveAdapter(CLE_TEST).fetchCandidates(
      vi.fn(async () => jsonResponse(fixtureText)),
    );

    expect(candidats).toHaveLength(frVictims.length);
    for (const candidat of candidats) {
      expect(candidat.source).toBe('ransomware.live');
      // L'adapter n'assigne ni id, ni status, ni dedup_score (rôle du runner T13).
      expect(candidat.id).toBeUndefined();
      expect(candidat.status).toBeUndefined();
      expect(candidat.dedup_score).toBeUndefined();
      // Métadonnées complètes de l'enregistrement d'origine, post_url onion inclus.
      const original = JSON.parse(candidat.raw) as VictimRecord;
      expect(frVictims).toContainEqual(original);
      expect(typeof original.post_url).toBe('string');
      // entity_name = champ victim de l'API.
      expect(candidat.entity_name).toBe(original.victim);
      // source_url = uniquement un permalien ransomware.live (jamais un onion).
      expect(candidat.source_url).toBe(original.permalink);
      expect(String(candidat.source_url)).toMatch(/^https:\/\/[\w.-]*ransomware\.live\//);
      expect(String(candidat.source_url)).not.toContain('.onion');
    }
    expect(candidats.map((c) => c.entity_name)).toEqual(frVictims.map((v) => v.victim as string));
  });

  it('abandonne chaque victime hors de France', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixtureText));
    const candidats = await ransomwareLiveAdapter(CLE_TEST).fetchCandidates(fetchFn);
    const nomsGardes = candidats.map((c) => c.entity_name);
    const nomsNonFr = fixtureVictims
      .filter((v) => typeof v.country !== 'string' || v.country.toUpperCase() !== 'FR')
      .map((v) => (typeof v.victim === 'string' ? v.victim : null));
    for (const nom of nomsNonFr) {
      expect(nomsGardes).not.toContain(nom);
    }
    // L'enregistrement FR de la cassette porte un post_url onion : il ne doit
    // apparaître nulle part en source_url (règle légale, métadonnées only).
    for (const candidat of candidats as Candidate[]) {
      expect(candidat.source_url).not.toContain('.onion');
    }
  });
});

describe('ransomware.live adapter — clé absente (config, pas jour calme)', () => {
  it('clé undefined : log fort + [] et AUCUN fetch', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchFn = vi.fn(async () => jsonResponse(fixtureText));

    const candidats = await ransomwareLiveAdapter(undefined).fetchCandidates(fetchFn);

    expect(candidats).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled(); // jamais un appel keyless au PRO
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('RANSOMWARE_LIVE_API_KEY'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ransomware.live'));
  });

  it('clé vide : même sémantique qu’absente (log fort + [] sans fetch)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchFn = vi.fn(async () => jsonResponse(fixtureText));

    await expect(ransomwareLiveAdapter('').fetchCandidates(fetchFn)).resolves.toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('RANSOMWARE_LIVE_API_KEY'));
  });
});

describe('ransomware.live adapter — dédup guid (pattern cnil, fix soak)', () => {
  it('chaque candidat FR porte un guid stable et distinct (victim ⊕ group ⊕ date)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixtureText));
    const passe1 = await ransomwareLiveAdapter(CLE_TEST).fetchCandidates(fetchFn);
    const passe2 = await ransomwareLiveAdapter(CLE_TEST).fetchCandidates(fetchFn);

    expect(passe1.map((c) => c.guid)).toEqual(passe2.map((c) => c.guid)); // stable d'une passe à l'autre
    expect(new Set(passe1.map((c) => c.guid)).size).toBe(frVictims.length); // les 2 FR distincts
  });

  it('guid connu filtré via knownGuids, les autres passent', async () => {
    const tous = await ransomwareLiveAdapter(CLE_TEST).fetchCandidates(
      vi.fn(async () => jsonResponse(fixtureText)),
    );
    const cible = tous[0]?.guid as string; // frVictims.length ≥ 2 (garde-fou provenance)
    expect(cible).toBeTruthy();

    const dedupliques = await ransomwareLiveAdapter(CLE_TEST).fetchCandidates(
      vi.fn(async () => jsonResponse(fixtureText)),
      new Set([cible]),
    );

    expect(dedupliques).toHaveLength(frVictims.length - 1);
    expect(dedupliques.map((c) => c.guid)).not.toContain(cible);
  });
});

describe('ransomware.live adapter — réponses inutilisables (≠ panne)', () => {
  it('retourne [] sur HTTP 401 (clé rejetée) sans lever — la sonde T54c du runner posera source_dead', async () => {
    const fetchFn = vi.fn(async () => jsonResponse('unauthorized', 401));
    await expect(ransomwareLiveAdapter(CLE_TEST).fetchCandidates(fetchFn)).resolves.toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1); // pas de retry interne — rôle du runner
  });

  it('retourne [] sur HTTP 500 sans lever (le circuit breaker reste au repos)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse('internal server error', 500));
    await expect(ransomwareLiveAdapter(CLE_TEST).fetchCandidates(fetchFn)).resolves.toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1); // pas de retry interne — rôle du runner
  });

  it('retourne [] sur corps non-JSON (HTML servi, ex. mauvais vhost)', async () => {
    const fetchFn = vi.fn(
      async () => new Response('<!DOCTYPE html><html>pas du JSON</html>', { status: 200 }),
    );
    await expect(ransomwareLiveAdapter(CLE_TEST).fetchCandidates(fetchFn)).resolves.toEqual([]);
  });

  it('retourne [] sur objet JSON sans tableau victims (ex. objet d’erreur)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse('{"error":"rate limit exceeded"}'));
    await expect(ransomwareLiveAdapter(CLE_TEST).fetchCandidates(fetchFn)).resolves.toEqual([]);
  });

  it('retourne [] sur la forme tableau nu de l’ancienne API free (le PRO enveloppe)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(JSON.stringify(fixtureVictims)));
    await expect(ransomwareLiveAdapter(CLE_TEST).fetchCandidates(fetchFn)).resolves.toEqual([]);
  });
});
