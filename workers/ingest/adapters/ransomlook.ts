// workers/ingest/adapters/ransomlook.ts — adapter RansomLook (23/08, vague « 100x »).
//
// Redondance de ransomware.live : agrégateur indépendant, parfois en avance.
// API keyless GET https://www.ransomlook.io/api/recent (100 dernières victimes
// tous groupes, JSON vérifié en session). Sans champ pays sur /recent : le
// filtre France se fait sur jetons du titre + description (même philosophie
// conservatrice que HIBP — faux négatif préféré à faux positif, les autres
// sources rattrapent). Le dédup guid (post_title+group_name+discovered) fait
// le reste ; le filet runner filtre aussi.

import type { Candidate, SourceAdapter } from '../src/adapter';

export const RANSOMLOOK_RECENT_URL = 'https://www.ransomlook.io/api/recent';

interface EntreeRecent {
  post_title?: string;
  discovered?: string;
  description?: string;
  link?: string;
  group_name?: string;
}

/** Jetons France dans titre/description — conservateur. */
const JETONS_FR: readonly string[] = [
  ' france', ' française', ' français', 'french',
  ' paris', 'lyon', 'marseille', 'toulouse', 'bordeaux', 'nantes',
  'saint-étienne', 'strasbourg', 'montpellier', 'lille', 'rennes',
];

function estFrancais(titre: string, description: string): boolean {
  const haystack = `${titre} ${description}`.toLowerCase();
  return JETONS_FR.some((j) => haystack.includes(j));
}

export function ransomlookAdapter(): SourceAdapter {
  return {
    id: 'ransomlook',
    async fetchCandidates(fetchFn: typeof fetch): Promise<Candidate[]> {
      const reponse = await fetchFn(RANSOMLOOK_RECENT_URL, {
        headers: { 'user-agent': 'FrancePassoire-Ingest/1.0 (+https://francepassoire.com)' },
      });
      if (!reponse.ok) {
        throw new Error(`ransomlook /recent → ${String(reponse.status)}`);
      }
      const entrees = (await reponse.json()) as EntreeRecent[];
      if (!Array.isArray(entrees)) return [];

      return entrees
        .filter((e) => typeof e.post_title === 'string' && e.post_title.trim() !== '')
        .filter((e) => estFrancais(e.post_title ?? '', e.description ?? ''))
        .map((e) => ({
          source: 'ransomlook',
          source_url: `https://www.ransomlook.io${e.link ?? ''}`,
          entity_name: (e.post_title ?? '').replace(/\s*NEW$/i, '').trim(),
          raw: {
            titre: e.post_title,
            groupe: e.group_name,
            decouvert: e.discovered,
            description: e.description,
          },
          guid: `ransomlook:${e.group_name ?? ''}:${e.post_title}:${e.discovered ?? ''}`,
        }));
    },
  };
}
