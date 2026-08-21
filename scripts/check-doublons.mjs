#!/usr/bin/env node
// FrancePassoire — détecteur de doublons pré-fusion (21/08).
//
// Les rafales parallèles minent des sources qui se recouvrent (presse) :
// deux lanes couvrent le même incident (ex. EDF février 2025, rafale 3
// L0/L1) et les fiches doublons n'étaient attrapées qu'AUXSSI par l'audit
// SEO titres. Ce script attrape la collision AVANT la fusion :
//
//   node scripts/check-doublons.mjs [--base main] [--branche <worktree>]
//
// Règle de suspicion : même entité normalisée (accents/casse/formes
// juridiques repliées) ET date de revendication à ±45 jours d'une fiche
// déjà publiée sur la base. Sortie nominative, exit 1 si collision.
// Les fiches NOUVELLES de la branche sont comparées à la base PUBLIÉE.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- normalisation (miroir simplifié de normalizeName de entities.ts) ---
const FORMES_JURIDIQUES = new Set([
  'sas', 'sasu', 'sarl', 'sa', 'eurl', 'ei', 'scm', 'snc', 'gie',
  'association', 'asso',
]);
function normaliserEntite(brut) {
  let s = brut.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[''`´]/g, '').replace(/[-–—_/]/g, ' ');
  s = s.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const mots = s.split(' ').filter(Boolean);
  while (mots.length > 1 && FORMES_JURIDIQUES.has(mots[mots.length - 1])) mots.pop();
  return mots.join(' ');
}

const FENETRE_JOURS = 45;
const MS_JOUR = 24 * 3600 * 1000;

function lireFiches(catalogDir) {
  return readdirSync(catalogDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(catalogDir, f), 'utf8')));
}

function analyserArgs(argv) {
  const opts = { base: 'main', branche: null, intra: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') opts.base = argv[++i];
    else if (argv[i] === '--branche') opts.branche = argv[++i];
    else if (argv[i] === '--intra') opts.intra = true;
    else { console.error(`option inconnue : ${argv[i]}`); process.exit(2); }
  }
  return opts;
}

function extraireCatalogue(rev) {
  const tmp = mkdtempSync(join(tmpdir(), 'fp-cat-'));
  // execFileSync a un buffer stdout par défaut trop petit pour le tar du
  // catalogue (1 Mo+) : maxBuffer 64 Mo + pas d'appel préalable redondant.
  const tar = execFileSync('git', ['archive', '--format=tar', rev, 'data/catalog'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  execFileSync('tar', ['-x', '-C', tmp], { input: tar, stdio: ['pipe', 'ignore', 'ignore'] });
  return join(tmp, 'data/catalog');
}

function main() {
  const opts = analyserArgs(process.argv.slice(2));
  const dirBase = extraireCatalogue(opts.base);
  const dirBranche = opts.branche
    ? extraireCatalogue(opts.branche)
    : 'data/catalog'; // worktree courant par défaut

  const publiees = lireFiches(dirBase);
  const toutes = lireFiches(dirBranche);

  // Seules les fiches NOUVELLES (absentes de la base par slug) sont
  // comparées — base == branche ⇒ 0 nouvelle ⇒ exit 0 (self-test).
  // --intra : audit du catalogue contre lui-même (paires distinctes).
  const slugsBase = new Set(publiees.map((f) => f.slug));
  const intra = opts.intra;
  const nouvelles = intra ? toutes : toutes.filter((f) => !slugsBase.has(f.slug));

  // index base : entité normalisée → [{slug, date}]
  const index = new Map();
  for (const f of publiees) {
    const cle = normaliserEntite(f.entity);
    if (!index.has(cle)) index.set(cle, []);
    index.get(cle).push({ slug: f.slug, date: f.dates.revendication });
  }

  const suspects = [];
  for (const f of nouvelles) {
    const cle = normaliserEntite(f.entity);
    const existantes = index.get(cle);
    if (!existantes) continue;
    const t = Date.parse(`${f.dates.revendication}T00:00:00Z`);
    for (const e of existantes) {
      // La même fiche (self-test base == branche) n'est pas une collision.
      if (e.slug === f.slug) continue;
      const delta = Math.abs(t - Date.parse(`${e.date}T00:00:00Z`)) / MS_JOUR;
      if (delta <= FENETRE_JOURS) {
        suspects.push({ nouvelle: f.slug, publiee: e.slug, entity: f.entity, ecartJours: Math.round(delta) });
      }
    }
  }

  if (dirBase.startsWith(tmpdir())) rmSync(dirBase, { recursive: true, force: true });
  if (opts.branche && dirBranche.startsWith(tmpdir())) rmSync(dirBranche, { recursive: true, force: true });

  if (suspects.length === 0) {
    console.log(`✓ check-doublons : ${nouvelles.length - publiees.length} fiche(s) nouvelle(s), 0 collision (±${FENETRE_JOURS} j, même entité normalisée).`);
    return 0;
  }
  console.error(`✗ check-doublons : ${suspects.length} collision(s) présumée(s) :`);
  for (const s of suspects) {
    console.error(`  - ${s.nouvelle} ↔ ${s.publiee} (${s.entity}, écart ${s.ecartJours} j)`);
  }
  console.error('Fusion BLOQUÉE : arbitrer avant merge (retirer la plus faible via motif doublon, ou fusionner les sources dans une seule fiche).');
  return 1;
}

process.exit(main());
