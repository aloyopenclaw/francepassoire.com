#!/usr/bin/env node
// Vérificateur hors-ligne du registre chaîné — zéro dépendance (node:crypto).
//
//   node scripts/verify-registry.mjs <registre.jsonl>
//
// Recalcule toute la chaîne d'empreintes de la première à la dernière ligne.
// Exit 0 = registre intact (résumé par fichier + empreinte de tête) ;
// exit 1 = première ligne en défaut, nommée sur stderr ;
// exit 2 = fichier introuvable ou argument absent.
//
// ─── SPÉCIFICATION CANONIQUE (partagée avec src/lib/registry.ts) ───
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
// CHOIX DOCUMENTÉ : cette logique est un miroir JS minimal (~15 lignes) de
// src/lib/registry.ts, car importer un module TS depuis un .mjs exécuté par
// node nu n'est pas praticable sans étape de build. La suite vitest
// (tests/registry.test.ts) exécute ce script sur des chaînes générées par la
// bibliothèque TS et sur le registre réel fuitesinfos : toute divergence du
// miroir casse les tests.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const EMPREINTE_GENESIS = '0'.repeat(64);

function canonique(valeur) {
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

function empreinteDe(ligne) {
  const { empreinte: _omise, ...reste } = ligne;
  return createHash('sha256').update(canonique(reste), 'utf8').digest('hex');
}

function main() {
  const chemin = process.argv[2];
  if (!chemin) {
    console.error('usage : node scripts/verify-registry.mjs <registre.jsonl>');
    return 2;
  }
  let brut;
  try {
    brut = readFileSync(chemin, 'utf8');
  } catch {
    console.error(`${chemin} introuvable ou illisible`);
    return 2;
  }

  const lignes = [];
  const brutes = brut.split('\n');
  for (let i = 0; i < brutes.length; i++) {
    const ligne = brutes[i].trim();
    if (!ligne) continue;
    try {
      lignes.push(JSON.parse(ligne));
    } catch (erreur) {
      console.error(
        `ligne ${i + 1} : JSON invalide — ${erreur instanceof Error ? erreur.message : String(erreur)}`,
      );
      return 1;
    }
  }

  let precedente = EMPREINTE_GENESIS;
  for (let attendu = 1; attendu <= lignes.length; attendu++) {
    const ligne = lignes[attendu - 1];
    if (ligne.seq !== attendu) {
      console.error(
        `ligne ${attendu} : numéro de séquence ${String(ligne.seq)} — une ligne a été insérée ou supprimée`,
      );
      return 1;
    }
    if (ligne.empreinte_precedente !== precedente) {
      console.error(
        `ligne ${attendu} : la chaîne est rompue — cette ligne ne suit pas celle qui la précède`,
      );
      return 1;
    }
    const calculee = empreinteDe(ligne);
    if (calculee !== ligne.empreinte) {
      console.error(
        `ligne ${attendu} : le contenu a été modifié après publication (recalculée ${calculee.slice(0, 12)}… ≠ publiée ${String(ligne.empreinte).slice(0, 12)}…)`,
      );
      return 1;
    }
    precedente = calculee;
  }

  console.log(`registre intact — ${chemin} : ${lignes.length} événements vérifiés`);
  console.log(`empreinte de tête : ${precedente}`);
  return 0;
}

process.exit(main());
