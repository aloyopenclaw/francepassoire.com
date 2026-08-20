#!/usr/bin/env node
// Genèse du registre d'intégrité chaîné FrancePassoire — hors-ligne.
//
//   node scripts/genesis.mjs --fiches-dir <dir> [--anchors-dir <dir>]
//                            [--out registre.jsonl] [--date AAAA-MM-JJ]
//
// Lit toutes les fiches JSON des répertoires fournis (ancrages + première
// tranche de backfill), les trie par slug (ordre de code-point — le
// déterminisme est contractuel), puis émet UN événement `ajout` par fiche :
//   { date: date de genèse (UTC, ou --date), type: "ajout",
//     entite: fiche.entity, fiche_du: fiche.slug }
// chaîné depuis la genèse (empreinte_precedente = 64 zéros), au format
// fuitesinfos (voir la spécification canonique dans scripts/registre-lib.mjs,
// miroir de src/lib/registry.ts — vérifiable par scripts/verify-registry.mjs).
//
// RÈGLE DURE : REFUSE de s'exécuter si le fichier de sortie existe et contient
// des octets — aucun chaînage rétroactif, jamais. Il n'existe PAS d'option
// --force : la genèse est unique, les ajouts ultérieurs passeront par le hook
// CI d'ajout d'événements (plan tâche 27). Un fichier de sortie vide (0 octet)
// est par contre accepté (déjà tronqué, aucun contenu écrasé).
//
// --date force la date des événements (tests de déterminisme / rejeu) ;
//   par défaut : date UTC du jour.
//
// Dépendances : node seul (la clé Nostr et les relais ne sont PAS touchés
// ici — voir scripts/publish-anchors.mjs, exécuté au moment de la genèse).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import process from 'node:process';
import { EMPREINTE_GENESIS, appendLigne, canonique } from './registre-lib.mjs';

const SLUG_RE = /^[a-z0-9-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const USAGE = `usage : node scripts/genesis.mjs --fiches-dir <dir> [--anchors-dir <dir>] [--out registre.jsonl] [--date AAAA-MM-JJ]`;

function analyserArgs(argv) {
  const opts = { fichesDir: null, anchorsDir: null, out: 'registre.jsonl', date: null };
  const connus = new Set(['--fiches-dir', '--anchors-dir', '--out', '--date']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    if (!connus.has(a)) {
      console.error(`option inconnue : ${a} (aucune porte de sortie n'existe — pas de --force)`);
      console.error(USAGE);
      process.exit(2);
    }
    const valeur = argv[++i];
    if (valeur === undefined) {
      console.error(`${a} attend une valeur`);
      console.error(USAGE);
      process.exit(2);
    }
    if (a === '--fiches-dir') opts.fichesDir = valeur;
    else if (a === '--anchors-dir') opts.anchorsDir = valeur;
    else if (a === '--out') opts.out = valeur;
    else if (a === '--date') opts.date = valeur;
  }
  if (!opts.fichesDir) {
    console.error('--fiches-dir est requis');
    console.error(USAGE);
    process.exit(2);
  }
  if (opts.date && !DATE_RE.test(opts.date)) {
    console.error(`--date : format AAAA-MM-JJ attendu (reçu « ${opts.date} »)`);
    process.exit(2);
  }
  return opts;
}

/** Lit tous les .json d'un répertoire ; chaque fichier doit être une fiche slug+entity. */
function lireFiches(dir) {
  if (!existsSync(dir)) {
    console.error(`répertoire introuvable : ${dir}`);
    process.exit(2);
  }
  const st = statSync(dir);
  if (!st.isDirectory()) {
    console.error(`pas un répertoire : ${dir}`);
    process.exit(2);
  }
  const fiches = [];
  const noms = readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  for (const nom of noms) {
    let fiche;
    try {
      fiche = JSON.parse(readFileSync(join(dir, nom), 'utf8'));
    } catch (erreur) {
      console.error(`${join(dir, nom)} : JSON invalide — ${erreur.message}`);
      process.exit(2);
    }
    if (typeof fiche.slug !== 'string' || !SLUG_RE.test(fiche.slug)) {
      console.error(`${join(dir, nom)} : champ slug absent ou invalide (minuscules, chiffres, tirets)`);
      process.exit(2);
    }
    if (typeof fiche.entity !== 'string' || fiche.entity.length === 0) {
      console.error(`${join(dir, nom)} : champ entity absent ou vide`);
      process.exit(2);
    }
    fiches.push({ source: join(dir, nom), fiche });
  }
  return fiches;
}

function main() {
  const opts = analyserArgs(process.argv.slice(2));

  if (existsSync(opts.out) && statSync(opts.out).size > 0) {
    console.error(
      `refus : ${opts.out} existe déjà et contient des octets — ` +
        `aucun chaînage rétroactif, jamais (pas d'option --force). ` +
        `Les ajouts postérieurs à la genèse passent par l'ajout d'événements en bout de chaîne.`,
    );
    return 1;
  }

  const fiches = lireFiches(opts.fichesDir);
  if (opts.anchorsDir) {
    fiches.push(...lireFiches(opts.anchorsDir));
  }
  if (fiches.length === 0) {
    console.error('aucune fiche JSON trouvée — la genèse chaîne au moins une fiche');
    return 2;
  }

  // Tri par slug (ordre de code-point, identique au tri des clés canoniques).
  fiches.sort((a, b) =>
    a.fiche.slug < b.fiche.slug ? -1 : a.fiche.slug > b.fiche.slug ? 1 : 0,
  );
  const vus = new Set();
  for (const { fiche, source } of fiches) {
    if (vus.has(fiche.slug)) {
      console.error(`slug dupliqué entre les répertoires : ${fiche.slug} (${source})`);
      return 2;
    }
    vus.add(fiche.slug);
  }

  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  let precedente = EMPREINTE_GENESIS;
  const lignes = fiches.map(({ fiche }, i) => {
    const ligne = appendLigne(
      { date, type: 'ajout', entite: fiche.entity, fiche_du: fiche.slug },
      precedente,
      i + 1,
    );
    precedente = ligne.empreinte;
    return ligne;
  });

  const contenu = lignes.map((l) => canonique(l)).join('\n') + '\n';
  const absolu = isAbsolute(opts.out) ? opts.out : join(process.cwd(), opts.out);
  mkdirSync(dirname(absolu), { recursive: true });
  writeFileSync(absolu, contenu, 'utf8');

  console.log(`genèse écrite : ${opts.out} — ${lignes.length} événements « ajout » (tri par slug)`);
  console.log(`empreinte de tête : ${precedente}`);
  console.log(`vérification : node scripts/verify-registry.mjs ${opts.out}`);
  return 0;
}

process.exit(main());
