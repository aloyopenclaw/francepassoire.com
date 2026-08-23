// workers/ingest/src/transport-health.ts — détection de mort d'endpoint (T54c).
//
// LEÇON 2026-08-22/23 : deux sources avaient moissonné « rien » en silence —
// hackmanac répondait 202 + page HTML anti-bot (202 EST res.ok, parseur 0
// item, zéro signal d'erreur), gnews répondait 503 (l'adapter renvoie [] sur
// non-2xx). Tous deux ressemblaient à des « jours calmes ». Règle codifiée
// ici (plan T54c) : un non-200, un 202, OU un corps HTML là où du XML/JSON
// était attendu ne doit JAMAIS passer pour un jour calme.
//
// DISTINCT du circuit breaker (index.ts) : le breaker compte les EXCEPTIONS
// (vraies pannes réseau/parseur). Ici on traite les MENSONGES de transport
// qui ne lèvent pas — la source est marquée morte dans KV (drapeau
// source_dead:<id-adapter>), le run n'enregistre AUCUN succès, et le drapeau
// est retiré dès qu'une réponse saine revient.
//
// CONTRAT DRAPEAU (consommé par le rapport quotidien de workers/api, tâche
// 54) : la clé `source_dead:<id-adapter>` du namespace RUN_STATE vaut, quand
// la source est morte, le JSON {"since": "<ISO 8601>", "reason": "<raison>"}.
// `since` = date de PREMIÈRE mort (jamais réécrite tant que la source reste
// morte) ; `reason` ∈ {`http-<code>` (ex. http-404, http-202 — le piège
// hackmanac), `html-ou-xml-attendu`, `html-ou-json-attendu`}. La clé est
// SUPPRIMÉE au premier 2xx sain.

import type { FormatAttendu } from './adapter';
import type { KVNamespace } from './runner-core';

/** Verdict de santé transport d'un fetch : sain, ou mort + raison machine
 *  stable (transportée telle quelle dans le drapeau KV). */
export type VerdictTransport = { ok: true } | { ok: false; reason: string };

/** Valeur du drapeau KV `source_dead:<id-adapter>` (contrat T54c, cf. en-tête). */
export interface SourceDeadFlag {
  /** ISO 8601 de la première mort constatée (stable tant que la source reste morte). */
  since: string;
  /** Raison machine : `http-<code>`, `html-ou-xml-attendu`, `html-ou-json-attendu`. */
  reason: string;
}

export const sourceDeadKey = (adapterId: string): string => `source_dead:${adapterId}`;

/** Statuts sans corps (RFC 9110) : rien à renifler, la Response n'est pas
 *  reconstruite (new Response avec corps sur un 204 lèverait). */
const STATUT_SANS_CORPS = new Set([204, 205, 304]);

/**
 * Verdict de statut : tout non-2xx est mort ; 202 l'est AUSSI bien que
 * res.ok soit vrai (leçon hackmanac : 202 + interstitiel anti-bot =
 * moisson vide sans aucun signal d'erreur).
 */
export function verdictStatut(statut: number): VerdictTransport {
  if (statut < 200 || statut >= 300) return { ok: false, reason: `http-${statut}` };
  if (statut === 202) return { ok: false, reason: 'http-202' };
  return { ok: true };
}

/**
 * Reniflage de corps (pur, tête seule après BOM/blancs de tête) : pour du
 * XML attendu, seules les pages HTML POSITIVES tuent (<!DOCTYPE html / <html>
 * servi là où <?xml / <rss / <feed était attendu) ; pour du JSON attendu,
 * tout corps ouvrant par '<' tue. Corps vide ou non-HTML : pas un mensonge
 * de transport, verdict sain.
 */
export function verdictCorps(formatAttendu: FormatAttendu, corps: string): VerdictTransport {
  const tete = corps
    .slice(0, 256)
    .replace(/^\ufeff/, '')
    .trimStart()
    .toLowerCase();
  if (formatAttendu === 'xml') {
    const estXml = tete.startsWith('<?xml') || tete.startsWith('<rss') || tete.startsWith('<feed');
    const estHtml = tete.startsWith('<!doctype html') || tete.startsWith('<html');
    if (estHtml && !estXml) return { ok: false, reason: 'html-ou-xml-attendu' };
  }
  if (formatAttendu === 'json' && tete.startsWith('<')) {
    return { ok: false, reason: 'html-ou-json-attendu' };
  }
  return { ok: true };
}

/**
 * Sonde de santé transport : enveloppe le fetch injecté d'un run. Chaque
 * réponse est jugée (statut d'abord, corps seulement si un format attendu
 * est déclaré) puis rendue à l'adapter, corps intact — Response
 * reconstruite au besoin, même motif que le tee HIBP de index.ts. Le verdict
 * du run est « morte » dès qu'UN fetch a menti (le premier mensonge gagne) ;
 * un adapter qui ne fetch pas reste sain.
 */
export function sondeTransport(
  formatAttendu: FormatAttendu | undefined,
  fetchFn: typeof fetch,
): { fetchSonde: typeof fetch; verdict: () => VerdictTransport } {
  let verdict: VerdictTransport = { ok: true };

  const fetchSonde: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const reponse = await fetchFn(input, init);
    if (!verdict.ok) return reponse; // un mensonge déjà collecté : plus rien à juger

    const vStatut = verdictStatut(reponse.status);
    if (!vStatut.ok) {
      verdict = vStatut;
      return reponse; // le statut suffit, corps inutile : réponse rendue intacte
    }
    if (formatAttendu === undefined || STATUT_SANS_CORPS.has(reponse.status)) {
      return reponse; // rien à renifler (ex. cnil-sanctions : HTML légitime)
    }
    const corps = await reponse.text();
    const vCorps = verdictCorps(formatAttendu, corps);
    if (!vCorps.ok) verdict = vCorps;
    return new Response(corps, { status: reponse.status, headers: reponse.headers });
  };

  return { fetchSonde, verdict: () => verdict };
}

/**
 * Applique un verdict au drapeau KV + journaux (effets de bord uniquement,
 * KV injecté testable par fakes) :
 *  - morte : pose {"since", "reason"} en TRANSITION seule (console.error
 *    fort avec l'id de la source et la raison ; les runs suivants restent
 *    discrets en console.log et ne réécrivent JAMAIS since) ;
 *  - saine : supprime le drapeau s'il traînait (journal de rétablissement).
 * N'écrit rien d'autre — l'état breaker (ingest:state:<id>) reste intouché.
 */
export async function appliquerVerdict(
  kv: KVNamespace,
  adapterId: string,
  verdict: VerdictTransport,
  maintenant: Date,
): Promise<void> {
  if (verdict.ok) {
    if ((await kv.get(sourceDeadKey(adapterId))) !== null) {
      await kv.delete(sourceDeadKey(adapterId));
      console.log(`[ingest] source ${adapterId} de nouveau joignable — drapeau source_dead retiré`);
    }
    return;
  }
  if ((await kv.get(sourceDeadKey(adapterId))) === null) {
    const drapeau: SourceDeadFlag = { since: maintenant.toISOString(), reason: verdict.reason };
    await kv.put(sourceDeadKey(adapterId), JSON.stringify(drapeau));
    console.error(
      `[ingest] ALERTE source morte : ${adapterId} (${verdict.reason}) — drapeau source_dead posé, jamais un jour calme`,
    );
  } else {
    console.log(`[ingest] source ${adapterId} toujours morte (${verdict.reason}) — drapeau déjà posé`);
  }
}
