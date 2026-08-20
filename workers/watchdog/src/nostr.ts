// workers/watchdog/src/nostr.ts — publication des alertes du chien de garde
// (T50) sur Nostr, depuis le npub du projet (docs/ancrages.md). Même patron
// de signature que workers/social/clients/nostr.ts (normalizeSecret +
// finalizeEvent + 3 relais épinglés, accepté par ≥ 1), volontairement
// autonome : chaque worker est déployable seul, sans couplage de bundle.
//
//   npx wrangler secret put NOSTR_NSEC --config workers/watchdog/wrangler.jsonc
//     Valeur : le hex de ~/.config/francepassoire/nostr.key (64 caractères).
//     L'équivalent nsec est aussi accepté (normalisé via nip19).
//
// Sans NOSTR_NSEC, le worker reste en mode « détection seule » (cf. src/index.ts)
// — la clé ne manquera jamais au lancement : c'est celle des ancrages (T27).
//
// Testabilité : normalizeSecret/buildAlerteNote sont purs et exportés ;
// l'envoi relais accepte une fabrique de sockets injectable (setFabriqueWs) —
// aucun réseau sous vitest.

import { finalizeEvent, nip19, type VerifiedEvent } from 'nostr-tools';
import { hexToBytes } from 'nostr-tools/utils';

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

/** Alerte kind 1 signée, prête à l'envoi — texte intégral, jamais retouché. */
export function buildAlerteNote(texte: string, secretKey: Uint8Array): VerifiedEvent {
  return finalizeEvent(
    { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: texte },
    secretKey,
  );
}

/** Socket minimale structurelle : satisfaite par le WebSocket natif
 * (Workers, Node 22) comme par un fake de test. */
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

/**
 * Publie un texte d'alerte avec le secret déjà validé. La garde « secret
 * absent » (mode détection seule) est amont, dans src/index.ts — ici le
 * secret existe forcément. Lève si le secret est mal formé (permanent).
 */
export async function publierTexte(
  texte: string,
  brut: string,
): Promise<{ ok: boolean; id: string; detail: string }> {
  const note = buildAlerteNote(texte, normalizeSecret(brut));
  const accueil = await publierAuxRelais(note, fabriqueWs);
  return { ok: accueil.ok, id: note.id, detail: accueil.detail };
}
