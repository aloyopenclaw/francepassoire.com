// workers/ingest/adapters/ransomware-live.ts — adapter ransomware.live (T14, Wave 2 ; T54b PRO).
//
// GET https://api-pro.ransomware.live/victims/recent (en-tête X-API-KEY, clé
// PRO du secret RANSOMWARE_LIVE_API_KEY) → filtre country = FR → candidats de
// métadonnées publiques uniquement.
//
// MIGRATION PRO (T54b, 23/08/2026) : l'endpoint keyless api.ransomware.live
// /v2/recentvictims (T14) est déprécié/fiable par décision propriétaire —
// le PRO est le chemin durable. Différences de forme vérifiées en live le
// 23/08 (cassette fixture) : réponse ENVELOPPÉE {client, count, order,
// victims:[…]} (l'API free servait un tableau nu) et champs renommés —
// `url`→`permalink`, `claim_url`→`post_url`, `domain`→`website`, plus un
// champ `id`. Le filtre FR, le guid et le contrat Candidate sont inchangés.
//
// RÈGLE LÉGALE (Art. 323-1/323-3) : jamais de requête vers les sites de fuite.
// Le champ `post_url` (ex-`claim_url`) de l'API pointe vers le site du groupe
// (souvent onion) : il est conservé dans `raw` (métadonnée publique) mais ne
// devient JAMAIS source_url. Seul le permalien ransomware.live (`permalink`)
// est éligible comme source_url.
//
// CLÉ ABSENTE = problème de configuration, PAS un jour calme : log fort et
// AUCUN fetch (un appel keyless au PRO ne doit ni partir ni muddle la
// détection de mort T54c avec un 401). Le runner (index.ts, même motif que
// le diff HIBP) instancie cet adapter avec env.RANSOMWARE_LIVE_API_KEY et
// ignore la source sans clé pour que last_success vieillisse — le signal
// honnête du rapport quotidien.
//
// DÉDUP GUID — même pattern que cnil.ts (fix soak 1f32779) : chaque
// revendication reçoit un guid stable (jointure déterministe victim ⊕ group
// ⊕ date de publication, cf. guidRevendication) exposé sur le candidat, et
// fetchCandidates(fetchFn, knownGuids?) filtre les guids déjà vus (guid_set
// KV câblé par le runner). La chaîne de dates (post_date/postdate/attackdate)
// est conservée telle quelle : les guids de l'ère free (attackdate effectif)
// restent identiques côté PRO — la migration ne réinsère pas l'historique.

import type { Candidate, SourceAdapter } from '../src/adapter';

const API_URL = 'https://api-pro.ransomware.live/victims/recent';

/** Enregistrement victime de l'API PRO — champs lus explicitement, reste opaque. */
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
 * clé que guidSanction (cnil.ts). Le PRO n'expose pas de champ post_date :
 * la date retenue est post_date/postdate si présente, sinon attackdate
 * (champ effectif vérifié sur les cassettes free 2026-08-20 et PRO 2026-08-23).
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
    source_url: toSourceUrl(record.permalink),
    raw: JSON.stringify(record),
    entity_name: victim !== '' ? victim : null,
  };
}

/**
 * Enveloppe PRO /victims/recent : {client, count, order, victims:[…]}. Une
 * réponse 200 hors de cette forme (ex. objet d'erreur) n'a rien à extraire.
 */
function extraireVictimes(payload: unknown): unknown[] | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const victimes = (payload as Record<string, unknown>).victims;
  return Array.isArray(victimes) ? victimes : null;
}

/** SourceAdapter + dédup guid optionnelle (même contrat que RssAdapter). */
export interface RansomwareLiveAdapter extends SourceAdapter {
  fetchCandidates(fetchFn: typeof fetch, knownGuids?: Set<string>): Promise<Candidate[]>;
}

/**
 * Factory (T54b) — le runner instancie avec env.RANSOMWARE_LIVE_API_KEY
 * (même motif que hibpDiffAdapter et son snapshot KV). Sans clé (undefined
 * ou vide) : log fort, AUCUN fetch, [] — jamais un appel keyless au PRO.
 */
export function ransomwareLiveAdapter(apiKey: string | undefined): RansomwareLiveAdapter {
  return {
    id: 'ransomware.live',
    // T54c : API JSON attendue (un HTML servi serait un mensonge de transport).
    formatAttendu: 'json',
    async fetchCandidates(fetchFn, knownGuids?) {
      if (apiKey === undefined || apiKey === '') {
        console.error(
          '[ingest] ALERTE config : RANSOMWARE_LIVE_API_KEY absente — ransomware.live ne fetch PAS le PRO sans clé ([] retourné). Créer le secret : npx wrangler secret put RANSOMWARE_LIVE_API_KEY --config workers/ingest/wrangler.jsonc',
        );
        return [];
      }
      const response = await fetchFn(API_URL, { headers: { 'X-API-KEY': apiKey } });
      // Non-200 (401 clé rejetée comme 5xx) : rien à extraire. On ne lève
      // pas — la sonde transport T54c du runner voit le statut et pose le
      // drapeau source_dead (http-401) ; le circuit breaker ne compte que
      // les exceptions (vraies pannes).
      if (!response.ok) return [];
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return []; // corps non-JSON (ex. page HTML servie par le mauvais vhost)
      }
      const victimes = extraireVictimes(payload);
      if (victimes === null) return [];

      const candidats: Candidate[] = [];
      const vus = new Set<string>();
      for (const record of victimes) {
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
}
