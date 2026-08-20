import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
// Adapter ransomware.live (T14) testé contre une cassette fixture enregistrée
// depuis l'API réelle le 2026-08-20 : GET https://api.ransomware.live/v2/recentvictims
// (IPv4 — le AAAA de api.ransomware.live sert le site, pas l'API).
//
// PROVENANCE DU FIXTURE : tests/fixtures/adapters/ransomware-live-recent.json
// est la réponse réelle ROGNÉE — la payload live fait 100 entrées (~85 Ko) ;
// on a gardé les enregistrements d'indices 0-48 plus celui d'indice 59
// (victime FR) pour tenir en 50 entrées en conservant 3 FR + 47 non-FR.
// Chaque enregistrement est inchangé (aucun champ édité), seul le tableau est tronqué.
import { ransomwareLiveAdapter } from '../../workers/ingest/adapters/ransomware-live';
import type { Candidate } from '../../workers/ingest/src/adapter';

const fixtureText = readFileSync(
  new URL('../fixtures/adapters/ransomware-live-recent.json', import.meta.url),
  'utf-8',
);

/** Type structurel d'un enregistrement victime tel que renvoyé par l'API v2. */
interface VictimRecord {
  victim?: unknown;
  group?: unknown;
  country?: unknown;
  url?: unknown;
  claim_url?: unknown;
  [champ: string]: unknown;
}

const fixtureVictims: VictimRecord[] = JSON.parse(fixtureText);
const frVictims = fixtureVictims.filter(
  (v) => typeof v.country === 'string' && v.country.toUpperCase() === 'FR',
);
const nonFrCount = fixtureVictims.length - frVictims.length;

const jsonResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } });

describe('ransomware.live adapter — cassette fixture', () => {
  it("interroge l'URL exacte de l'API v2 (sans clé)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixtureText));
    await ransomwareLiveAdapter.fetchCandidates(fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('https://api.ransomware.live/v2/recentvictims');
  });

  it('garde les victimes FR et mappe les champs du contrat Candidate', async () => {
    // Garde-fou provenance : la cassette doit contenir au moins 2 FR et 3 non-FR.
    expect(frVictims.length).toBeGreaterThanOrEqual(2);
    expect(nonFrCount).toBeGreaterThanOrEqual(3);

    const candidats = await ransomwareLiveAdapter.fetchCandidates(vi.fn(async () => jsonResponse(fixtureText)));

    expect(candidats).toHaveLength(frVictims.length);
    for (const candidat of candidats) {
      expect(candidat.source).toBe('ransomware.live');
      // L'adapter n'assigne ni id, ni status, ni dedup_score (rôle du runner T13).
      expect(candidat.id).toBeUndefined();
      expect(candidat.status).toBeUndefined();
      expect(candidat.dedup_score).toBeUndefined();
      // Métadonnées complètes de l'enregistrement d'origine, claim_url onion inclus.
      const original = JSON.parse(candidat.raw) as VictimRecord;
      expect(frVictims).toContainEqual(original);
      expect(typeof original.claim_url).toBe('string');
      // entity_name = champ victim de l'API.
      expect(candidat.entity_name).toBe(original.victim);
      // source_url = uniquement un permalien ransomware.live (jamais un onion).
      expect(candidat.source_url).toBe(original.url);
      expect(String(candidat.source_url)).toMatch(/^https:\/\/[\w.-]*ransomware\.live\//);
      expect(String(candidat.source_url)).not.toContain('.onion');
    }
    expect(candidats.map((c) => c.entity_name)).toEqual(frVictims.map((v) => v.victim as string));
  });

  it('abandonne chaque victime hors de France', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixtureText));
    const candidats = await ransomwareLiveAdapter.fetchCandidates(fetchFn);
    const nomsGardes = candidats.map((c) => c.entity_name);
    const nomsNonFr = fixtureVictims
      .filter((v) => typeof v.country !== 'string' || v.country.toUpperCase() !== 'FR')
      .map((v) => (typeof v.victim === 'string' ? v.victim : null));
    for (const nom of nomsNonFr) {
      expect(nomsGardes).not.toContain(nom);
    }
    // Les enregistrements FR du fixture portent des claim_url onion : ils ne
    // doivent apparaître nulle part en source_url (règle légale, métadonnées only).
    for (const candidat of candidats as Candidate[]) {
      expect(candidat.source_url).not.toContain('.onion');
    }
  });
});

describe('ransomware.live adapter — réponses inutilisables (≠ panne)', () => {
  it('retourne [] sur HTTP 500 sans lever (le circuit breaker reste au repos)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse('internal server error', 500));
    await expect(ransomwareLiveAdapter.fetchCandidates(fetchFn)).resolves.toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1); // pas de retry interne — rôle du runner
  });

  it('retourne [] sur HTTP 404 (4xx ≠ panne)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse('not found', 404));
    await expect(ransomwareLiveAdapter.fetchCandidates(fetchFn)).resolves.toEqual([]);
  });

  it('retourne [] sur JSON malformé (corps HTML)', async () => {
    const fetchFn = vi.fn(
      async () => new Response('<!DOCTYPE html><html>pas du JSON</html>', { status: 200 }),
    );
    await expect(ransomwareLiveAdapter.fetchCandidates(fetchFn)).resolves.toEqual([]);
  });

  it("retourne [] sur payload JSON qui n'est pas un tableau", async () => {
    const fetchFn = vi.fn(async () => jsonResponse('{"error":"rate limit exceeded"}'));
    await expect(ransomwareLiveAdapter.fetchCandidates(fetchFn)).resolves.toEqual([]);
  });
});
