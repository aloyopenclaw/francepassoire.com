// Bibliothèque JS partagée des scripts de genèse / publication / vérification
// d'ancrages — miroir minimal de src/lib/registry.ts (même règle canonique que
// scripts/verify-registry.mjs, qui reste autonome et zéro-dépendance).
//
// ─── SPÉCIFICATION CANONIQUE (partagée avec src/lib/registry.ts et
//     scripts/verify-registry.mjs) ───
//
// empreinte = SHA-256 (hex minuscule) des octets UTF-8 de la sérialisation
// canonique de la ligne, définie ainsi :
//   1. partir de la ligne objet et retirer UNIQUEMENT le champ `empreinte`
//      (le champ `empreinte_precedente` RESTE couvert par le hachage) ;
//   2. sérialiser en JSON avec les clés triées par ordre alphabétique
//      (récursivement dans les objets imbriqués), séparateurs compacts
//      `,` et `:`, caractères non-ASCII conservés tels quels (pas
//      d'échappement \uXXXX) ;
//   3. hacher la chaîne obtenue encodée en UTF-8.
//
// CHOIX DOCUMENTÉ : second miroir JS (le premier est verify-registry.mjs,
// laissé autonome par discipline de périmètre). La suite vitest croise les
// deux miroirs : tests/genesis.test.ts exécute verify-registry.mjs sur la
// sortie de genesis.mjs — toute divergence entre les miroirs casse les tests.

import { createHash } from 'node:crypto';

export const EMPREINTE_GENESIS = '0'.repeat(64);

export function canonique(valeur) {
  if (valeur === null || typeof valeur !== 'object') {
    return JSON.stringify(valeur);
  }
  if (Array.isArray(valeur)) {
    return '[' + valeur.map(canonique).join(',') + ']';
  }
  const cles = Object.keys(valeur).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return (
    '{' +
    cles.map((cle) => JSON.stringify(cle) + ':' + canonique(valeur[cle])).join(',') +
    '}'
  );
}

/** Empreinte d'une ligne (champ `empreinte` omis du hachage). */
export function empreinteDe(ligne) {
  const { empreinte: _omise, ...reste } = ligne;
  return createHash('sha256').update(canonique(reste), 'utf8').digest('hex');
}

/** Ajoute un événement à la suite d'une ligne (null = genèse). */
export function appendLigne(evenement, precedente, seq) {
  const ligne = {
    seq,
    ...evenement,
    empreinte_precedente: precedente,
    empreinte: '',
  };
  ligne.empreinte = empreinteDe(ligne);
  return ligne;
}

/**
 * Vérifie hors-ligne une chaîne complète (même sémantique que
 * verifierChaine de src/lib/registry.ts et que verify-registry.mjs).
 * Retourne { valide, erreur, nbEvenements, empreinteTete }.
 */
export function verifierChaine(lignes) {
  if (lignes.length === 0) {
    return { valide: false, erreur: 'registre vide' };
  }
  let precedente = EMPREINTE_GENESIS;
  for (let attendu = 1; attendu <= lignes.length; attendu++) {
    const ligne = lignes[attendu - 1];
    if (ligne.seq !== attendu) {
      return {
        valide: false,
        erreur: `ligne ${attendu} : numéro de séquence ${String(ligne.seq)} — une ligne a été insérée ou supprimée`,
      };
    }
    if (ligne.empreinte_precedente !== precedente) {
      return {
        valide: false,
        erreur: `ligne ${attendu} : la chaîne est rompue`,
      };
    }
    const calculee = empreinteDe(ligne);
    if (calculee !== ligne.empreinte) {
      return {
        valide: false,
        erreur: `ligne ${attendu} : le contenu a été modifié après publication`,
      };
    }
    precedente = calculee;
  }
  return {
    valide: true,
    nbEvenements: lignes.length,
    empreinteTete: precedente,
  };
}

/** Analyse un texte JSONL ; lève en nommant la première ligne invalide. */
export function parseJsonl(brut) {
  const lignes = [];
  const brutes = brut.split('\n');
  for (let i = 0; i < brutes.length; i++) {
    const ligne = brutes[i].trim();
    if (!ligne) continue;
    try {
      lignes.push(JSON.parse(ligne));
    } catch (erreur) {
      throw new Error(
        `ligne ${i + 1} : JSON invalide — ${erreur instanceof Error ? erreur.message : String(erreur)}`,
      );
    }
  }
  return lignes;
}
