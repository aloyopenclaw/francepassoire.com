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
//
// DÉDUP GUID — même pattern que cnil.ts (fix soak 1f32779) : chaque
// revendication reçoit un guid stable (jointure déterministe victim ⊕ group
// ⊕ date de publication, cf. guidRevendication) exposé sur le candidat, et
// fetchCandidates(fetchFn, knownGuids?) filtre les guids déjà vus (guid_set
// KV câblé par le runner). Sans ce filtre, chaque pass réinsérait les
// victimes FR encore présentes dans /recentvictims (constat du soak).

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

/**
 * Guid stable d'une revendication : jointure déterministe victim ⊕ group ⊕
 * date de publication, séparateur \u0000 absent des valeurs — même règle de
 * clé que guidSanction (cnil.ts). /recentvictims n'expose pas de champ
 * post_date : la date retenue est postdate/post_date si présente, sinon
 * attackdate (champ effectif vérifié sur la cassette fixture 2026-08-20).
 */
function guidRevendication(victim: string, group: unknown, record: VictimRecord): string {
  const groupe = typeof group === 'string' ? group : '';
  const postDate =
    typeof record.post_date === 'string'
      ? record.post_date
      : typeof record.postdate === 'string'
        ? record.postdate
        : typeof record.attackdate === 'string'
          ? record.attackdate
          : '';
  return [victim, groupe, postDate].join('\u0000');
}

/** Filtre FR (insensible à la casse) + mappage vers le contrat Candidate
 *  (guid toujours assigné) ; null = à écarter. */
function toCandidate(record: VictimRecord): (Candidate & { guid: string }) | null {
  if (typeof record.country !== 'string' || record.country.trim().toUpperCase() !== 'FR') {
    return null;
  }
  const victim = typeof record.victim === 'string' ? record.victim.trim() : '';
  return {
    source: 'ransomware.live',
    guid: guidRevendication(victim, record.group, record),
    source_url: toSourceUrl(record.url),
    raw: JSON.stringify(record),
    entity_name: victim !== '' ? victim : null,
  };
}

/** SourceAdapter + dédup guid optionnelle (même contrat que RssAdapter). */
export interface RansomwareLiveAdapter extends SourceAdapter {
  fetchCandidates(fetchFn: typeof fetch, knownGuids?: Set<string>): Promise<Candidate[]>;
}

export const ransomwareLiveAdapter: RansomwareLiveAdapter = {
  id: 'ransomware.live',
  async fetchCandidates(fetchFn, knownGuids?) {
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

    const candidats: Candidate[] = [];
    const vus = new Set<string>();
    for (const record of payload) {
      if (typeof record !== 'object' || record === null) continue;
      const candidat = toCandidate(record as VictimRecord);
      if (candidat === null) continue;
      if (vus.has(candidat.guid)) continue;
      vus.add(candidat.guid);
      if (knownGuids?.has(candidat.guid)) continue;
      candidats.push(candidat);
    }
    return candidats;
  },
};
