// workers/ingest/adapters/ransomware-live.ts — adapter ransomware.live (T14, Wave 2).
//
// GET https://api.ransomware.live/v2/recentvictims (sans clé, 1 req/min) →
// filtre country = FR → candidats de métadonnées publiques uniquement.
//
// RÈGLE LÉGALE (Art. 323-1/323-3) : jamais de requête vers les sites de fuite.
// Le champ `claim_url` de l'API pointe vers le site onion du groupe : il est
// conservé dans `raw` (métadonnée publique) mais ne devient JAMAIS source_url.
// Seul le permalien ransomware.live (`url`) est éligible comme source_url.
//
// Enregistrement auprès du registre `adapters` : tâche 19 (câblage commun).
//
// NOTE ENDPOINT : l'API v1 (/recentvictims sans préfixe) est retirée du
// service ; la base documentée (www.ransomware.live/apidocs) est /v2. En
// outre, le AAAA de api.ransomware.live sert le site HTML (404) : le runtime
// Workers comme curl doivent résoudre en IPv4 pour joindre l'API réelle.

import type { Candidate, SourceAdapter } from '../src/adapter';

const API_URL = 'https://api.ransomware.live/v2/recentvictims';

/** Enregistrement victime de l'API v2 — champs lus explicitement, reste opaque. */
type VictimRecord = Record<string, unknown>;

/** source_url valable uniquement pour un permalien http(s) hébergé par ransomware.live. */
function toSourceUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url === '') return null;
  try {
    const { protocol, hostname } = new URL(url);
    const host = hostname.toLowerCase();
    if (protocol !== 'https:' && protocol !== 'http:') return null;
    if (host !== 'ransomware.live' && !host.endsWith('.ransomware.live')) return null;
    return url;
  } catch {
    return null;
  }
}

/** Filtre FR (insensible à la casse) + mappage vers le contrat Candidate ; null = à écarter. */
function toCandidate(record: VictimRecord): Candidate | null {
  if (typeof record.country !== 'string' || record.country.trim().toUpperCase() !== 'FR') {
    return null;
  }
  const victim = typeof record.victim === 'string' ? record.victim.trim() : '';
  return {
    source: 'ransomware.live',
    source_url: toSourceUrl(record.url),
    raw: JSON.stringify(record),
    entity_name: victim !== '' ? victim : null,
  };
}

export const ransomwareLiveAdapter: SourceAdapter = {
  id: 'ransomware.live',
  async fetchCandidates(fetchFn: typeof fetch): Promise<Candidate[]> {
    const response = await fetchFn(API_URL);
    // Non-200 (4xx comme 5xx) : rien à extraire. On ne lève pas — le circuit
    // breaker du runner (T13) ne compte que les exceptions (vraies pannes).
    if (!response.ok) return [];
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return []; // corps non-JSON (ex. page HTML servie par le mauvais vhost)
    }
    if (!Array.isArray(payload)) return [];
    return payload
      .filter((record): record is VictimRecord => typeof record === 'object' && record !== null)
      .map(toCandidate)
      .filter((candidat): candidat is Candidate => candidat !== null);
  },
};
