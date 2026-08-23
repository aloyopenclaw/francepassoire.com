// Gestion de la paire de clés Nostr d'ancrage FrancePassoire — clé en
// quarantaine HORS dépôt : le secret vit dans ~/.config/francepassoire/nostr.key
// (chmod 600, hex, 64 caractères), JAMAIS commité, JAMAIS affiché. Seul le npub
// (clé publique) est publié (docs/ancrages.md, profil, worker social).
//
//   import { chargerCle, npubDepuisHex } from './nostr-key.mjs'
//
// chargerCle()           → { secretHex, npub }   (échoue si absente)
// genererSiAbsent()      → { npub, cree }        (idempotent : réutilise une clé existante)
//
// Génération manuelle : node scripts/verify-anchors.mjs --gen
// Pour le worker social (tâches 38/40) : wrangler secret put NOSTR_NSEC
// (l'utilisateur convertit le hex en nsec lors du backup — voir docs/social-setup.md).

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

// Chemin de la clé : variable d'env (runners VPS multi-users, groupe partagé)
// sinon ~/.config/francepassoire/nostr.key (poste de travail).
export const CHEMIN_CLE =
  process.env.FRANCEPASSOIRE_NOSTR_KEY ??
  join(homedir(), '.config', 'francepassoire', 'nostr.key');

// Relais épinglés (décision du plan tâche 27) — jamais un seul relais.
// Édition = changement de contrat public : mettre à jour docs/ancrages.md.
export const RELAIS_EPINGLES = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  // 4e relais (21/08) : damus rate-limitait les rafales de republication,
  // laissant certains ancrages à 1/3 — redondance rétablie à 4.
  'wss://relay.dottore.eu',
];

const HEX_RE = /^[0-9a-f]{64}$/;

export function npubDepuisHex(pubkeyHex) {
  return nip19.npubEncode(pubkeyHex);
}

/** getPublicKey (nostr-tools 2.x) exige un Uint8Array, pas un hex. */
function secretDepuisHex(secretHex) {
  return new Uint8Array(Buffer.from(secretHex, 'hex'));
}

/** Génère la clé si absente, sinon réutilise (idempotent). Jamais de secret en sortie. */
export function genererSiAbsent() {
  if (existsSync(CHEMIN_CLE)) {
    const secretHex = readFileSync(CHEMIN_CLE, 'utf8').trim();
    if (!HEX_RE.test(secretHex)) {
      throw new Error(`${CHEMIN_CLE} : contenu inattendu (hex 64 caractères attendu) — clé non régénérée, à inspecter à la main`);
    }
    return { npub: npubDepuisHex(getPublicKey(secretDepuisHex(secretHex))), cree: false };
  }
  const secret = generateSecretKey();
  const secretHex = Buffer.from(secret).toString('hex');
  mkdirSync(join(homedir(), '.config', 'francepassoire'), { recursive: true });
  writeFileSync(CHEMIN_CLE, secretHex + '\n', { mode: 0o600 });
  chmodSync(CHEMIN_CLE, 0o600);
  return { npub: npubDepuisHex(getPublicKey(secret)), cree: true };
}

/** Charge la clé existante ; message d'aide si absente. */
export function chargerCle() {
  if (!existsSync(CHEMIN_CLE)) {
    throw new Error(
      `paire de clés absente : ${CHEMIN_CLE} — exécuter d'abord « node scripts/verify-anchors.mjs --gen »`,
    );
  }
  const secretHex = readFileSync(CHEMIN_CLE, 'utf8').trim();
  if (!HEX_RE.test(secretHex)) {
    throw new Error(`${CHEMIN_CLE} : hex 64 caractères attendu`);
  }
  return { secretHex, npub: npubDepuisHex(getPublicKey(secretDepuisHex(secretHex))) };
}
