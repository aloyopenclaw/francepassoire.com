import { describe, expect, it, vi } from 'vitest';
import { ransomlookAdapter, RANSOMLOOK_RECENT_URL } from '../../workers/ingest/adapters/ransomlook';

// RansomLook (vague 100x, 23/08) : /recent keyless, filtre France
// conservateur (jetons titre+description), guid post_title+group+discovered.
const fr = (titre: string, groupe = 'qilin', decouvert = '2026-08-23 01:00:00') => ({
  post_title: titre,
  group_name: groupe,
  discovered: decouvert,
  description: '',
  link: '/blog/disclosures/abc',
});

describe('ransomlookAdapter — filtre France conservateur', () => {
  it('garde les victimes avec jeton France, rejette le reste', async () => {
    const fetchFn = vi.fn(async (u: string | URL | Request) => {
      if (String(u) === RANSOMLOOK_RECENT_URL) {
        return new Response(
          JSON.stringify([
            fr('Mairie de Toulouse attaquée'),
            fr('Vietnam Electricity'),
            { ...fr('Banco de Brasil'), description: 'banque brésilienne' },
          ]),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const candidats = await ransomlookAdapter().fetchCandidates(fetchFn);
    expect(candidats).toHaveLength(1);
    expect(candidats[0]?.entity_name).toBe('Mairie de Toulouse attaquée');
    expect(candidats[0]?.source).toBe('ransomlook');
  });

  it('titre NEW nettoyé, guid stable, lien source complet', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify([fr('RXPE Group France\xa0NEW', 'pear')]), { status: 200 }),
    ) as unknown as typeof fetch;
    const candidats = await ransomlookAdapter().fetchCandidates(fetchFn);
    expect(candidats[0]?.entity_name).toBe('RXPE Group France');
    expect(candidats[0]?.source_url).toBe('https://www.ransomlook.io/blog/disclosures/abc');
    expect(candidats[0]?.guid).toContain('pear');
  });

  it('API en erreur → exception (le circuit breaker du runner décide)', async () => {
    const fetchFn = vi.fn(async () => new Response('boom', { status: 503 })) as unknown as typeof fetch;
    await expect(ransomlookAdapter().fetchCandidates(fetchFn)).rejects.toThrow('503');
  });
});
