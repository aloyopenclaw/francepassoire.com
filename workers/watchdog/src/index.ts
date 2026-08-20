// workers/watchdog/src/index.ts — chien de garde autonome (T50, Wave Gate).
//
// Les Zone Health Checks du compte sont désactivés au plan (erreur 1002) :
// ce worker sonde lui-même, toutes les 10 minutes (cron), les 4 cibles du
// lancement et compare à l'état KV précédent. Une note Nostr (kind 1, npub
// du projet — T27, même clé que les ancrages) part UNIQUEMENT sur
// transition ok→down ou down→ok : jamais d'état stable, jamais de spam.
//
//   Surveillance FrancePassoire : <cible> inaccessible depuis <heure UTC>
//   Surveillance FrancePassoire : <cible> rétablie à <heure UTC> (…)
//
// KV (namespace WATCHDOG) :
//   watchdog:state:<cible> = {ok, since, lastCheck}   — « since » = début de
//     l'état courant, c'est lui qui alimente le « depuis » de la note ;
//   watchdog:history = tampon circulaire des 100 derniers contrôles (FIFO),
//     pour le bilan du jour du lancement (4 cibles × 25 passages ≈ 4 h).
//
// NOSTR_NSEC absent → mode DÉTECTION SEULE : états KV mis à jour, alerte en
// console.error, aucun crash (même conditionnel que le worker social, T38).
//
// Structure : cibles/constantes/textes purs dans src/cibles.ts (l'entrypoint
// workerd n'accepte que des fonctions en exports nommés) ; publication dans
// src/nostr.ts. Testabilité : fetch injectable (options.fetchFn), publication
// injectable (options.publish) et horloge injectable (options.now) — aucun
// réseau, ni WebSocket, ni KV réel sous vitest.

import {
  CIBLES,
  CLE_HISTORIQUE,
  DELAI_FETCH_MS,
  TAILLE_HISTORIQUE,
  texteAlerte,
  type EntreeHistorique,
  type EtatCible,
  type Target,
} from './cibles';
import { publierTexte } from './nostr';

/** KV structurel minimal (même discipline que les autres workers : aucune
 * dépendance @cloudflare/workers-types, fakes triviaux en test). */
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface Env {
  WATCHDOG: KVNamespace;
  /**
   * Secret Nostr (T27) : hex 64 caractères — la valeur exacte de
   * ~/.config/francepassoire/nostr.key — ou son équivalent nsec. Se pose via
   * `npx wrangler secret put NOSTR_NSEC --config workers/watchdog/wrangler.jsonc`.
   */
  NOSTR_NSEC?: string;
}

export interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export type Transition = 'vers-hors-ligne' | 'vers-en-ligne' | null;

export interface CheckResultat {
  cible: string;
  ok: boolean;
  transition: Transition;
  /** Id de la note publiée (si publication réussie). */
  noteId?: string;
  /** true quand l'alerte n'a été que consignée (NOSTR_NSEC absent). */
  detectOnly?: boolean;
}

/** Publication injectable pour les tests — reçoit le texte final de la note. */
export type PublishFn = (texte: string) => Promise<{ ok: boolean; id?: string; detail: string }>;

export interface CheckOptions {
  fetchFn?: typeof fetch;
  publish?: PublishFn;
  now?: () => Date;
}

/** Sonde une cible : fetch 15 s max (AbortController), toute erreur réseau
 * (DNS, TLS, timeout…) vaut hors ligne. Ne rejette jamais. */
export async function sonder(cible: Target, fetchFn: typeof fetch): Promise<boolean> {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), DELAI_FETCH_MS);
  try {
    const reponse = await fetchFn(cible.url, {
      signal: controleur.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'FrancePassoire-Watchdog/1.0 (+https://francepassoire.com)' },
    });
    const corps = await reponse.text();
    return cible.verifier(reponse.status, corps);
  } catch {
    return false;
  } finally {
    clearTimeout(minuteur);
  }
}

function cleEtat(id: string): string {
  return `watchdog:state:${id}`;
}

async function lireEtat(env: Env, id: string): Promise<EtatCible | null> {
  const brut = await env.WATCHDOG.get(cleEtat(id));
  if (!brut) {
    return null;
  }
  try {
    const etat = JSON.parse(brut) as Partial<EtatCible>;
    if (typeof etat.ok !== 'boolean' || typeof etat.since !== 'string') {
      return null;
    }
    return { ok: etat.ok, since: etat.since, lastCheck: etat.lastCheck ?? etat.since };
  } catch {
    return null; // JSON corrompu : on repart d'une première observation
  }
}

/**
 * Publie (ou consigne) l'alerte de transition. Best-effort : un échec relais
 * ne bloque JAMAIS l'écriture de l'état — sinon le cron suivant republierait
 * la même transition (spam). La note perdue est nommée en console.error.
 */
async function alerter(
  texte: string,
  cibleId: string,
  env: Env,
  publish?: PublishFn,
): Promise<{ noteId?: string; detectOnly?: boolean }> {
  if (publish) {
    const verdict = await publish(texte);
    if (verdict.ok && verdict.id) {
      console.log(`[watchdog] note ${verdict.id} publiée (${cibleId}) : ${texte}`);
      return { noteId: verdict.id };
    }
    console.error(
      `[watchdog] publication injectée en échec (${cibleId}) : ${verdict.detail} — alerte : ${texte}`,
    );
    return {};
  }
  if (!env.NOSTR_NSEC) {
    console.error(
      `[watchdog] DÉTECT-ONLY (NOSTR_NSEC absent — wrangler secret put NOSTR_NSEC) — alerte : ${texte}`,
    );
    return { detectOnly: true };
  }
  try {
    const verdict = await publierTexte(texte, env.NOSTR_NSEC);
    if (verdict.ok) {
      console.log(`[watchdog] note ${verdict.id} publiée (${cibleId}) : ${texte}`);
      return { noteId: verdict.id };
    }
    console.error(
      `[watchdog] transition (${cibleId}) non publiée, relais muets : ${verdict.detail} — alerte : ${texte}`,
    );
    return {};
  } catch (erreur) {
    // Secret mal formé : permanent — on consigne et on continue (état quand
    // même écrit, sinon spam au cron suivant).
    console.error(
      `[watchdog] NOSTR_NSEC illisible (${cibleId}) — alerte consignée sans publication : ${texte}`,
      erreur instanceof Error ? erreur.message : String(erreur),
    );
    return {};
  }
}

async function verifierCible(
  cible: Target,
  env: Env,
  fetchFn: typeof fetch,
  publish: PublishFn | undefined,
  maintenant: Date,
): Promise<CheckResultat> {
  const ok = await sonder(cible, fetchFn);
  const precedent = await lireEtat(env, cible.id);
  const iso = maintenant.toISOString();

  // Première observation : on pose la baseline sans note (aucune transition
  // connue — et le déploiement initial ne doit pas alerter sur du vide).
  if (!precedent) {
    await env.WATCHDOG.put(
      cleEtat(cible.id),
      JSON.stringify({ ok, since: iso, lastCheck: iso } satisfies EtatCible),
    );
    console.log(`[watchdog] première observation ${cible.id} : ${ok ? 'ok' : 'HORS LIGNE'}`);
    return { cible: cible.id, ok, transition: null };
  }

  if (precedent.ok === ok) {
    await env.WATCHDOG.put(
      cleEtat(cible.id),
      JSON.stringify({ ok, since: precedent.since, lastCheck: iso } satisfies EtatCible),
    );
    return { cible: cible.id, ok, transition: null };
  }

  const transition: Transition = ok ? 'vers-en-ligne' : 'vers-hors-ligne';
  const texte = texteAlerte(cible, ok, maintenant, ok ? new Date(precedent.since) : undefined);
  const publication = await alerter(texte, cible.id, env, publish);
  await env.WATCHDOG.put(
    cleEtat(cible.id),
    JSON.stringify({ ok, since: iso, lastCheck: iso } satisfies EtatCible),
  );
  return {
    cible: cible.id,
    ok,
    transition,
    noteId: publication.noteId,
    detectOnly: publication.detectOnly,
  };
}

/** Ajoute le passage courant au tampon circulaire (FIFO, 100 entrées max). */
export async function ecrireHistorique(
  env: Env,
  resultats: readonly CheckResultat[],
  maintenant: Date,
): Promise<void> {
  let historique: EntreeHistorique[] = [];
  const brut = await env.WATCHDOG.get(CLE_HISTORIQUE);
  if (brut) {
    try {
      const lu = JSON.parse(brut) as unknown;
      if (Array.isArray(lu)) {
        historique = lu.filter(
          (e): e is EntreeHistorique =>
            typeof e === 'object' &&
            e !== null &&
            typeof (e as EntreeHistorique).cible === 'string' &&
            typeof (e as EntreeHistorique).ok === 'boolean' &&
            typeof (e as EntreeHistorique).at === 'string',
        );
      }
    } catch {
      historique = []; // tampon corrompu : on repart propre
    }
  }
  historique.push(
    ...resultats.map((r) => ({ cible: r.cible, ok: r.ok, at: maintenant.toISOString() })),
  );
  await env.WATCHDOG.put(CLE_HISTORIQUE, JSON.stringify(historique.slice(-TAILLE_HISTORIQUE)));
}

/**
 * Un passage complet : les 4 cibles en séquence, puis le tampon historique.
 * Le fetch (options.fetchFn), la publication (options.publish) et l'horloge
 * (options.now) sont injectables — le cron réel n'injecte rien.
 */
export async function runChecks(env: Env, options: CheckOptions = {}): Promise<CheckResultat[]> {
  const fetchFn = options.fetchFn ?? fetch;
  const maintenant = options.now ?? (() => new Date());
  const resultats: CheckResultat[] = [];
  for (const cible of CIBLES) {
    resultats.push(await verifierCible(cible, env, fetchFn, options.publish, maintenant()));
  }
  await ecrireHistorique(env, resultats, maintenant());
  return resultats;
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await runChecks(env);
  },
};
