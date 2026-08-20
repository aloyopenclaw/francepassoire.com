#!/usr/bin/env node
// FrancePassoire — vérifie que le sitemap généré couvre exactement les pages HTML du build.
// Compare les URLs de dist/sitemap-index.xml (+ parts) avec les fichiers *.html de dist/.
// Sortie 0 si les deux ensembles sont égaux ; sortie 1 en nommant chaque écart.
// Usage : node scripts/check-sitemap.mjs (après `npm run build`). Zéro dépendance.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://francepassoire.com';
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

function fail(msg) {
  console.error(`✗ check-sitemap: ${msg}`);
  process.exit(1);
}

function normalize(url) {
  return url.replace(/\/+$/, '') || SITE;
}

// 1. Lire l'index du sitemap et extraire les parts référencées.
const indexPath = join(distDir, 'sitemap-index.xml');
if (!existsSync(indexPath)) {
  fail(`dist/sitemap-index.xml introuvable — lancez d'abord \`npm run build\`.`);
}
const indexXml = readFileSync(indexPath, 'utf8');
const partLocs = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
if (partLocs.length === 0) fail('sitemap-index.xml ne référence aucune sitemap-part (aucun <loc>).');

// 2. Résoudre chaque part (URL absolue sur SITE → fichier local dans dist/) et collecter ses URLs.
const sitemapUrls = new Set();
for (const partUrl of partLocs) {
  if (!partUrl.startsWith(`${SITE}/`)) fail(`part hors du site déclaré ${SITE} : ${partUrl}`);
  const partPath = join(distDir, partUrl.slice(SITE.length + 1));
  if (!existsSync(partPath)) {
    fail(`part référencée mais absente du build : ${partUrl} (attendu : ${partPath})`);
  }
  const partXml = readFileSync(partPath, 'utf8');
  for (const m of partXml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    sitemapUrls.add(normalize(m[1].trim()));
  }
}

// 3. Collecter toutes les pages HTML réellement présentes dans dist/.
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.html')) out.push(p);
  }
  return out;
}

const htmlUrls = new Set(
  walk(distDir).map((p) => {
    const rel = p.slice(distDir.length + 1);
    if (rel === 'index.html') return SITE;
    if (rel.endsWith('/index.html')) return `${SITE}/${rel.slice(0, -'/index.html'.length)}`;
    return `${SITE}/${rel}`;
  })
);

// 4. Comparer les deux ensembles.
const inSitemapOnly = [...sitemapUrls].filter((u) => !htmlUrls.has(u));
const onDiskOnly = [...htmlUrls].filter((u) => !sitemapUrls.has(u));

if (inSitemapOnly.length > 0 || onDiskOnly.length > 0) {
  for (const u of inSitemapOnly) console.error(`✗ dans le sitemap mais absent du build : ${u}`);
  for (const u of onDiskOnly) console.error(`✗ page HTML hors sitemap : ${u}`);
  process.exit(1);
}

console.log(`✓ sitemap (${sitemapUrls.size} URLs) == pages HTML du build (${htmlUrls.size}) — cohérent.`);
