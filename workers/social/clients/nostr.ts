// workers/social/clients/nostr.ts — client Nostr, T38 : la seule plateforme
// 100 % opérationnelle au jour du lancement — aucune clé à demander au
// propriétaire, la clé d'ancrage en quarantaine suffit (docs/ancrages.md).
//
//   npx wrangler secret put NOSTR_NSEC
//     Valeur : le hex de ~/.config/francepassoire/nostr.key (64 caractères).
//     L'équivalent nsec est aussi accepté (normalisé via nip19).
//
// Publication : note kind 1 signée (nostr-tools finalizeEvent), envoyée aux
// 3 relais épinglés (règle tâche 27 : jamais un seul relais) sur le
// WebSocket natif (Workers comme Node 22). Acceptée par ≥ 1 relais
// (["OK", id, true]) → SENT, l'id d'événement sert d'externalId. Tous les
// relais muets → erreur REJOUABLE (le cron */5 min repassera).
//
// La garde éditoriale (mention « revendication non confirmée ») est celle de
// la file (src/index.ts) — ce client ne la duplique pas.
//
// Testabilité : buildNote/normalizeSecret sont purs et exportés ; l'envoi
// relais accepte une fabrique de sockets injectable (setFabriqueWs) —
// aucun réseau sous vitest.

import { finalizeEvent, nip19, type VerifiedEvent } from 'nostr-tools';
import { hexToBytes } from 'nostr-tools/utils';
import type { Env, PostPayload, SendFn, SendResult } from '../src/types';

/** Relais épinglés (docs/ancrages.md — édition = changement de contrat public). */
export const RELAIS_EPINGLES: readonly string[] = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

/** Délai max par relais : un relais muet ne retient jamais tout un cron. */
export const DELAI_RELAIS_MS = 8_000;

const HEX_SECRET = /^[0-9a-f]{64}$/;

/**
 * NOSTR_NSEC → octets du secret. Accepte le hex canonique (valeur brute de
 * ~/.config/francepassoire/nostr.key) et le nsec bech32 ; lève sinon.
 */
export function normalizeSecret(valeur: string): Uint8Array {
  const v = valeur.trim();
  if (v.startsWith('nsec')) {
    const decode = nip19.decode(v);
    if (decode.type !== 'nsec') {
      throw new Error('NOSTR_NSEC : préfixe nsec sur un autre type de code');
    }
    return decode.data;
  }
  if (!HEX_SECRET.test(v)) {
    throw new Error(
      'NOSTR_NSEC illisible : hex 64 caractères (valeur de ~/.config/francepassoire/nostr.key) ou nsec attendu',
    );
  }
  return hexToBytes(v);
}

/**
 * Note kind 1 signée, prête à l'envoi. Les rendus social-templates portent
 * déjà l'URL de la fiche : on vérifie avant d'ajouter — jamais de doublon.
 */
export function buildNote(payload: PostPayload, secretKey: Uint8Array): VerifiedEvent {
  const contenu = payload.text.includes(payload.url)
    ? payload.text
    : `${payload.text} ${payload.url}`;
  return finalizeEvent(
    { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: contenu },
    secretKey,
  );
}

/** Socket minimale structurelle : satisfaite par le WebSocket natif
 * (Workers, Node 22) comme par un fake de test. L'événement est optionnel
 * car open/error/close n'en portent pas ; seul message a `data`. */
export interface SocketRelais {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    ecouteur: (ev?: { data?: unknown }) => void,
  ): void;
}

export type FabriqueWs = (url: string) => SocketRelais;

let fabriqueWs: FabriqueWs = (url) => new WebSocket(url);

/** Injection pour les tests (aucune sortie réseau sous vitest). */
export function setFabriqueWs(fabrique: FabriqueWs): void {
  fabriqueWs = fabrique;
}

/** Retour à la fabrique natif — afterEach de chaque test. */
export function reinitFabriqueWs(): void {
  fabriqueWs = (url) => new WebSocket(url);
}

/** Un relais : true seulement sur ["OK", id, true] ; fermeture, erreur,
 * OK:false ou délai expiré → false. Ne rejette jamais. */
function publierUnRelais(
  evenement: VerifiedEvent,
  relais: string,
  fabrique: FabriqueWs,
): Promise<boolean> {
  return new Promise((resoudre) => {
    let termine = false;
    let socket: SocketRelais | undefined;
    const minuteur = setTimeout(() => fin(false), DELAI_RELAIS_MS);
    const fin = (ok: boolean): void => {
      if (termine) {
        return;
      }
      termine = true;
      clearTimeout(minuteur);
      socket?.close();
      resoudre(ok);
    };
    try {
      socket = fabrique(relais);
    } catch {
      fin(false);
      return;
    }
    socket.addEventListener('open', () => {
      socket?.send(JSON.stringify(['EVENT', evenement]));
    });
    socket.addEventListener('message', (ev) => {
      try {
        const [type, id, accepte] = JSON.parse(String(ev?.data)) as [
          string?,
          string?,
          boolean?,
        ];
        if (type === 'OK' && id === evenement.id) {
          fin(accepte === true);
        }
      } catch {
        // Trame non JSON (NOTICE, ping…) : ignorée, on attend le OK.
      }
    });
    socket.addEventListener('error', () => fin(false));
    socket.addEventListener('close', () => fin(false));
  });
}

/** Best-effort sur les 3 relais épinglés ; ok = accepté par ≥ 1. */
export async function publierAuxRelais(
  evenement: VerifiedEvent,
  fabrique: FabriqueWs,
): Promise<{ ok: boolean; accepteurs: string[]; detail: string }> {
  const verdicts = await Promise.all(
    RELAIS_EPINGLES.map((relais) => publierUnRelais(evenement, relais, fabrique)),
  );
  const accepteurs = RELAIS_EPINGLES.filter((_, i) => verdicts[i] === true);
  const detail = RELAIS_EPINGLES.map(
    (relais, i) => `${relais} : ${verdicts[i] === true ? 'accepté' : 'refus/indisponible'}`,
  ).join(' ; ');
  return { ok: accepteurs.length > 0, accepteurs, detail };
}

export const send: SendFn = async (
  payload: PostPayload,
  env: Env,
  _fetchFn: typeof fetch,
): Promise<SendResult> => {
  const brut = env.NOSTR_NSEC;
  if (!brut) {
    return {
      status: 'PENDING_KEYS',
      reason:
        'NOSTR_NSEC absent — wrangler secret put NOSTR_NSEC (valeur : le hex de ~/.config/francepassoire/nostr.key)',
    };
  }
  let secret: Uint8Array;
  let note: VerifiedEvent;
  try {
    secret = normalizeSecret(brut);
    note = buildNote(payload, secret);
  } catch (erreur) {
    // Clé mal formée : permanent — re-tenter au cron suivant ne change rien.
    return { status: 'ERROR', retryable: false, reason: String(erreur) };
  }
  const accueil = await publierAuxRelais(note, fabriqueWs);
  if (accueil.ok) {
    return { status: 'SENT', externalId: note.id };
  }
  return {
    status: 'ERROR',
    retryable: true,
    reason: `aucun relais n’a accepté la note (${accueil.detail})`,
  };
};
