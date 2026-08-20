#!/usr/bin/env node
// FrancePassoire — append-registry : ajoute des événements « ajout » pour les
// fiches NON ENCORE CHAÎNÉES d'un répertoire, à la suite du registre existant.
//
// C'est l'outil manuel qui remplace, jusqu'à la tâche 47, le hook CI
// d'ajout automatique à chaque fusion de PR backfill (décision épinglée n° 6 :
// aucune fiche publique sans entrée de chaîne PRÉALABLE ; la chaîne est
// append-only, jamais réécrite — genesis.mjs refuse tout réajustement
// rétroactif, cet outil ne fait qu'ajouter en queue).
//
//   node scripts/append-registry.mjs --fiches-dir data/catalog [--registre registre.jsonl] [--date AAAA-MM-JJ]
//
// Règles :
//  - vérifie d'abord l'intégrité de la chaîne existante (refuse sinon) ;
//  - ignore les fiches dont le slug figure déjà comme fiche_du (idempotent) ;
//  - trie les nouveaux événements par slug (déterministe, comme genesis) ;
//  - imprime la nouvelle empreinte de tête.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { appendLigne, canonique, parseJsonl, verifierChaine } from './registre-lib.mjs';

function analyserArgs(argv) {
  const opts = { fichesDir: null, registre: 'registre.jsonl', date: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fiches-dir') opts.fichesDir = argv[++i];
    else if (a === '--registre') opts.registre = argv[++i];
    else if (a === '--date') opts.date = argv[++i];
    else {
      console.error(`option inconnue : ${a} (usage : --fiches-dir <dir> [--registre <chemin>] [--date AAAA-MM-JJ])`);
      process.exit(2);
    }
  }
  if (!opts.fichesDir) {
    console.error('usage : node scripts/append-registry.mjs --fiches-dir <dir> [--registre <chemin>] [--date AAAA-MM-JJ]');
    process.exit(2);
  }
  return opts;
}

function lireFiches(dir) {
  const noms = readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  const fiches = [];
  for (const nom of noms) {
    const fiche = JSON.parse(readFileSync(`${dir}/${nom}`, 'utf8'));
    if (typeof fiche.slug !== 'string' || typeof fiche.entity !== 'string') {
      throw new Error(`${nom} : champs requis « slug » et « entity » absents`);
    }
    fiches.push(fiche);
  }
  return fiches;
}

function main() {
  const opts = analyserArgs(process.argv.slice(2));
  if (!existsSync(opts.registre)) {
    console.error(`${opts.registre} introuvable — lancer d'abord scripts/genesis.mjs (pas de réécriture de genèse ici)`);
    return 1;
  }
  const brut = readFileSync(opts.registre, 'utf8');
  const lignes = parseJsonl(brut);
  const integrite = verifierChaine(lignes);
  if (!integrite.valide) {
    console.error(`chaîne existante invalide (${opts.registre}) : ${integrite.erreur} — refus d'ajout`);
    return 1;
  }
  const dejaChaines = new Set(lignes.map((l) => l.fiche_du));
  const nouvelles = lireFiches(opts.fichesDir)
    .filter((f) => !dejaChaines.has(f.slug))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  if (nouvelles.length === 0) {
    console.log(`aucune nouvelle fiche à chaîner (tous les slugs figurent déjà dans ${opts.registre})`);
    return 0;
  }
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`--date invalide : ${date} (attendu AAAA-MM-JJ)`);
    return 2;
  }
  const derniere = lignes[lignes.length - 1];
  let empreintePrecedente = derniere.empreinte;
  let seq = derniere.seq;
  const ajouts = [];
  for (const fiche of nouvelles) {
    const ligne = appendLigne(
      { date, type: 'ajout', entite: fiche.entity, fiche_du: fiche.slug },
      empreintePrecedente,
      seq + 1,
    );
    ajouts.push(ligne);
    empreintePrecedente = ligne.empreinte;
    seq = ligne.seq;
  }
  const sortie =
    brut.trimEnd() + '\n' + ajouts.map((l) => canonique(l)).join('\n') + '\n';
  writeFileSync(opts.registre, sortie, 'utf8');
  console.log(`ajout(s) chaîné(s) : ${ajouts.length} — nouvelle tête : ${empreintePrecedente}`);
  return 0;
}

process.exit(main());
