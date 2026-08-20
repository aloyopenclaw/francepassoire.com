// Vue « confiance » de la page /methode — tâche 43 (Wave 6).
//
// Lit le registre réel (registre.jsonl à la racine du dépôt) au moment du
// build, revalide la chaîne entière et expose les artefacts publics :
// nombre d'événements, empreinte de tête, npub d'ancrage et relais épinglés.
//
// PORTE DE GARDE (même logique que buildCatalogue dans opendata.ts) : la
// vérification utilise verifierChaine, miroir TS canonique de
// `node scripts/verify-registry.mjs` (parité garantie par
// tests/registry.test.ts qui exécute les deux sur les mêmes chaînes).
// Registre illisible, vide, chaîne rompue ou empreinte de tête divergente
// → erreur FR → LE BUILD ÉCHOUE. La page ne peut pas publier une empreinte
// que le vérificateur hors-ligne ne confirmerait pas.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseJsonl, verifierChaine, type LigneRegistre } from './registry';

const CHEMIN_REGISTRE = fileURLToPath(new URL('../../registre.jsonl', import.meta.url));

/** Identité publique d'ancrage Nostr (docs/ancrages.md — jamais le secret). */
export const NPUB_ANCRAGE =
  'npub1c4s8aye7ye8vmwa39zllytlj8rqcz4gqwtp30vw0vlk9ksj3u5uqqyjymd';

/** Relais épinglés (docs/ancrages.md — jamais un seul relais). */
export const RELAIS_EPINGLES = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
] as const;

export interface VueRegistre {
  /** Nombre d'événements chaînés (lignes du JSONL). */
  nbEvenements: number;
  /** Dernière empreinte recalculée = empreinte publiée en dernière ligne. */
  empreinteTete: string;
  /** Empreinte de la première ligne (chaînon fondateur après la genèse). */
  empreintePremiere: string;
  /** Empreinte de l'avant-dernière ligne (chaînon précédant la tête). */
  empreintePrecedente: string;
}

/** Empreinte raccourcie pour les puces de chaîne (format « A7B2…9F »). */
export function raccourcirEmpreinte(empreinte: string): string {
  return `${empreinte.slice(0, 4)}…${empreinte.slice(-2)}`.toUpperCase();
}

function chargerLignes(): LigneRegistre[] {
  let brut: string;
  try {
    brut = readFileSync(CHEMIN_REGISTRE, 'utf8');
  } catch {
    throw new Error(
      `registre d'intégrité introuvable (${CHEMIN_REGISTRE}) — « node scripts/verify-registry.mjs registre.jsonl » doit sortir 0 avant tout build`,
    );
  }
  return parseJsonl(brut) as LigneRegistre[];
}

const lignes = chargerLignes();
const derniere = lignes[lignes.length - 1];
if (!derniere) {
  throw new Error(
    'registre d\'intégrité vide — la page /methode refuse de publier une chaîne sans événement',
  );
}

const verification = await verifierChaine(lignes);
if (!verification.valide || verification.empreinteTete !== derniere.empreinte) {
  throw new Error(
    `registre d'intégrité en défaut (${verification.erreur ?? 'empreinte de tête ≠ dernière ligne publiée'}) — « node scripts/verify-registry.mjs registre.jsonl » doit sortir 0 avant tout build`,
  );
}

export const vueRegistre: VueRegistre = {
  nbEvenements: verification.nbEvenements ?? lignes.length,
  empreinteTete: verification.empreinteTete ?? derniere.empreinte,
  empreintePremiere: lignes[0].empreinte,
  empreintePrecedente: lignes[lignes.length - 2]?.empreinte ?? lignes[0].empreinte,
};
