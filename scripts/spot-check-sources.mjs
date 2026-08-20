#!/usr/bin/env node
// FrancePassoire — spot-check des URLs sources des fiches changées par un PR (T19).
//
// Usage (depuis .github/workflows/pr-validate.yml) :
//   node scripts/spot-check-sources.mjs [fichier1.json fichier2.json …]
//   - fichiers passés en arguments = fiches changées du PR (git diff) ;
//   - sans arguments = tout data/catalog/*.json (workflow_dispatch manuel).
//
// Échantillonne 10 % des URLs sources (minimum 1), curl HEAD (-sIL, suit les
// redirections) ; 2xx/3xx = OK. Leçon T37 : certains sites (SPAs) répondent
// 404/405 au HEAD — repli GET dans ce cas. URL morte → seconde tentative via
// https://web.archive.org/web/<url> : si l'archive répond, PASS AVEC
// AVERTISSEMENT. Sortie : table markdown sur stdout ET dans
// $GITHUB_STEP_SUMMARY ; exit 1 si une URL reste morte.
//
// Zéro dépendance (node + curl système).
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = join(repoRoot, 'data', 'catalog');
const HEAD_TIMEOUT = '20';
const GET_TIMEOUT = '30';
const ARCHIVE_TIMEOUT = '45';

const fail = (msg) => {
  console.error(`✗ spot-check-sources: ${msg}`);
  process.exit(1);
};

// ── 1. Fichiers à vérifier ───────────────────────────────────────────────────
const argFiles = process.argv.slice(2);
const files = argFiles.length > 0 ? argFiles : readdirSync(CATALOG_DIR).filter((f) => f.endsWith('.json'));
if (files.length === 0) {
  console.log('spot-check-sources : aucune fiche .json à vérifier — rien à faire.');
  process.exit(0);
}

// ── 2. Collecte des URLs sources ────────────────────────────────────────────
const urls = [];
for (const file of files) {
  const absolute = file.startsWith('/') ? file : join(repoRoot, file);
  let fiche;
  try {
    fiche = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (err) {
    fail(`${file} illisible ou non-JSON : ${err.message}`);
  }
  for (const source of fiche.sources ?? []) {
    if (typeof source.url === 'string' && /^https?:\/\//.test(source.url)) {
      urls.push({ file: file.replace(/^.*data\/catalog\//, ''), url: source.url });
    }
  }
}
if (urls.length === 0) {
  console.log('spot-check-sources : aucune URL source dans les fiches changées — rien à sonder.');
  process.exit(0);
}

// ── 3. Échantillon : 10 %, min 1 ────────────────────────────────────────────
const sampleSize = Math.max(1, Math.ceil(urls.length / 10));
const sample = urls.slice(0, sampleSize); // déterministe : premier 10 %
console.log(`spot-check-sources : ${urls.length} URL(s) source, échantillon ${sample.length}.`);

// ── 4. Sondage curl ─────────────────────────────────────────────────────────
const curlStatus = (args) => {
  const res = spawnSync('curl', args, { encoding: 'utf8', timeout: 60000 });
  if (res.status !== 0 || res.error) return null;
  const code = parseInt(res.stdout.trim(), 10);
  return Number.isNaN(code) ? null : code;
};

const isPass = (code) => code !== null && code >= 200 && code < 400;

function probe(url) {
  // HEAD d'abord ; 404/405/501 → repli GET (leçon T37 : les SPAs rejettent HEAD).
  const head = curlStatus(['-sIL', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', HEAD_TIMEOUT, url]);
  if (isPass(head)) return { verdict: 'PASS', code: head, via: 'HEAD' };
  const get = curlStatus(['-sL', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', GET_TIMEOUT, url]);
  if (isPass(get)) return { verdict: 'PASS', code: get, via: 'GET (HEAD refusé)' };
  // Archive publique acceptée comme équivalent vivant — pass avec avertissement.
  const archive = curlStatus([
    '-sIL', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', ARCHIVE_TIMEOUT,
    `https://web.archive.org/web/${url}`,
  ]);
  if (isPass(archive)) return { verdict: 'WARN', code: archive, via: 'web.archive.org' };
  return { verdict: 'DEAD', code: get ?? head, via: get !== null ? 'GET' : 'HEAD' };
}

const rows = sample.map(({ file, url }) => ({ file, url, ...probe(url) }));

// ── 5. Rapport markdown (stdout + step summary) ─────────────────────────────
const table = [
  '## Spot-check des sources (10 %, min 1)',
  '',
  '| Verdict | HTTP | Via | Fiche | URL |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map(
    (r) =>
      `| ${r.verdict === 'PASS' ? '✅ PASS' : r.verdict === 'WARN' ? '⚠️ PASS (archive)' : '❌ DEAD'} | ${r.code ?? '—'} | ${r.via} | ${r.file} | ${r.url} |`,
  ),
  '',
].join('\n');

console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
}

const dead = rows.filter((r) => r.verdict === 'DEAD');
if (dead.length > 0) {
  console.error(`✗ spot-check-sources : ${dead.length} URL(s) morte(s) (origine ET archive).`);
  process.exit(1);
}
console.log(`✓ spot-check-sources : ${rows.length - dead.length}/${rows.length} URL(s) vivantes (${rows.filter((r) => r.verdict === 'WARN').length} via archive).`);
