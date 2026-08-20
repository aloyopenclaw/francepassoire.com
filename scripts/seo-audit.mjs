#!/usr/bin/env node
// FrancePassoire — audit SEO pré-lancement (tâche 48). Crawler piloté par le
// sitemap : lit dist/sitemap-index.xml (+ parts), interroge chaque URL en
// production et vérifie, page par page :
//   ERROR : HTTP != 200 ; <title> absent, vide ou multiple ; meta description
//           absente ou vide ; canonical absent ou ne correspondant pas à
//           l'URL du sitemap ; balises OG absentes ; <h1> absent ou multiple.
//   WARN  : <title> présent mais partagé avec une autre page ; description
//           présente mais partagée avec une autre page.
// Tolérance du gate (plan) : 0 erreur, ≤ 5 avertissements.
// Sortie : tableau markdown + résumé ; exit 1 au-delà de la tolérance.
//
// Cible de fetch : https://francepassoire.pages.dev par défaut (Node fetch ne
// peut pas épingler l'IP et le DNS local du domaine apex peut être poussiéreux
// sur ce Mac ; pages.dev sert toujours le dernier build de production).
// Le canonical et le sitemap restent comparés sur l'URL de production.
// Usage :
//   node scripts/seo-audit.mjs                        # contre pages.dev (live)
//   node scripts/seo-audit.mjs http://127.0.0.1:8788  # contre un build local
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://francepassoire.com';
const FETCH_BASE = (process.argv[2] ?? 'https://francepassoire.pages.dev').replace(/\/+$/, '');
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const CONCURRENCY = 8;
const MAX_WARNINGS = 5;

function fail(msg) {
  console.error(`✗ seo-audit: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Sitemap → liste des URLs de production.
// ---------------------------------------------------------------------------
const indexPath = join(distDir, 'sitemap-index.xml');
if (!existsSync(indexPath)) {
  fail(`dist/sitemap-index.xml introuvable — lancez d'abord \`npm run build\`.`);
}
const partLocs = [...readFileSync(indexPath, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
if (partLocs.length === 0) fail('sitemap-index.xml ne référence aucune part.');

const sitemapUrls = [];
for (const partUrl of partLocs) {
  if (!partUrl.startsWith(`${SITE}/`)) fail(`part hors du site déclaré ${SITE} : ${partUrl}`);
  const partPath = join(distDir, partUrl.slice(SITE.length + 1));
  if (!existsSync(partPath)) fail(`part référencée mais absente du build : ${partUrl}`);
  for (const m of readFileSync(partPath, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) {
    sitemapUrls.push(m[1].trim());
  }
}
if (sitemapUrls.length === 0) fail('aucune URL dans le sitemap.');

// ---------------------------------------------------------------------------
// 2. Outils d'analyse HTML (zéro dépendance — le build est du HTML statique
//    régulier généré par Astro ; regex assumées).
// ---------------------------------------------------------------------------
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function tagAttributes(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g)) {
    attrs[(m[1] ?? m[3]).toLowerCase()] = m[2] ?? m[4] ?? '';
  }
  return attrs;
}

function analysePage(html) {
  const titles = [...html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map((m) =>
    decodeEntities(m[1]).replace(/\s+/g, ' ').trim(),
  );
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => tagAttributes(m[0]));
  const metaDescription = metas
    .filter((a) => a.name === 'description')
    .map((a) => decodeEntities(a.content ?? '').replace(/\s+/g, ' ').trim())[0];
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => tagAttributes(m[0]));
  const canonical = links
    .filter((a) => (a.rel ?? '').toLowerCase().split(/\s+/).includes('canonical'))
    .map((a) => (a.href ?? '').trim())[0];
  const og = {};
  for (const a of metas) {
    if (a.property) og[a.property] = decodeEntities(a.content ?? '').trim();
  }
  const h1Count = (html.match(/<h1\b/gi) ?? []).length;
  return { titles, metaDescription, canonical, og, h1Count };
}

function normaliserUrl(u) {
  let out = u.replace(/\/+$/, '');
  if (out === SITE || out === '') return SITE;
  return out;
}

// ---------------------------------------------------------------------------
// 3. Crawl (pool de concurrence, un retry réseau par page).
// ---------------------------------------------------------------------------
async function charger(url, essai = 0) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    return { status: res.status, html: res.status === 200 ? await res.text() : '' };
  } catch (e) {
    if (essai < 1) return charger(url, essai + 1);
    return { status: 0, html: '', erreur: String(e.cause ?? e.message ?? e) };
  }
}

const resultats = [];
let curseur = 0;
async function ouvrier() {
  while (curseur < sitemapUrls.length) {
    const urlProd = sitemapUrls[curseur++];
    const urlFetch = urlProd.replace(SITE, FETCH_BASE);
    const { status, html, erreur } = await charger(urlFetch);
    resultats.push({ urlProd, urlFetch, status, erreur, ...(status === 200 ? analysePage(html) : {}) });
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, ouvrier));
resultats.sort((a, b) => a.urlProd.localeCompare(b.urlProd));

// ---------------------------------------------------------------------------
// 4. Verdicts (unicités calculées sur l'ensemble du site).
// ---------------------------------------------------------------------------
const titresVus = new Map();
const descriptionsVues = new Map();
for (const r of resultats) {
  if (r.status !== 200) continue;
  const t = r.titles[0] ?? '';
  if (t) titresVus.set(t, (titresVus.get(t) ?? 0) + 1);
  if (r.metaDescription) descriptionsVues.set(r.metaDescription, (descriptionsVues.get(r.metaDescription) ?? 0) + 1);
}

const OG_REQUISES = ['og:title', 'og:description', 'og:url', 'og:type'];
let erreurs = 0;
let avertissements = 0;
const lignes = [];

for (const r of resultats) {
  const cell = { http: '✓', titre: '✓', desc: '✓', canon: '✓', og: '✓', h1: '✓' };
  const problemes = [];

  if (r.status !== 200) {
    cell.http = '✗';
    problemes.push(`ERROR HTTP ${r.status}${r.erreur ? ` (${r.erreur})` : ''} sur ${r.urlFetch}`);
  } else {
    if (r.titles.length !== 1 || !r.titles[0]) {
      cell.titre = '✗';
      problemes.push(`ERROR <title> : ${r.titles.length} balise(s)`);
    } else if ((titresVus.get(r.titles[0]) ?? 0) > 1) {
      cell.titre = '⚠';
      problemes.push(`WARN titre dupliqué (${titresVus.get(r.titles[0])} pages) : « ${r.titles[0]} »`);
    }
    if (!r.metaDescription) {
      cell.desc = '✗';
      problemes.push('ERROR meta description absente ou vide');
    } else if ((descriptionsVues.get(r.metaDescription) ?? 0) > 1) {
      cell.desc = '⚠';
      problemes.push(`WARN description dupliquée (${descriptionsVues.get(r.metaDescription)} pages)`);
    }
    if (!r.canonical) {
      cell.canon = '✗';
      problemes.push('ERROR canonical absent');
    } else if (normaliserUrl(r.canonical) !== normaliserUrl(r.urlProd)) {
      cell.canon = '✗';
      problemes.push(`ERROR canonical « ${r.canonical} » != URL sitemap « ${r.urlProd} »`);
    }
    const ogManquantes = OG_REQUISES.filter((p) => !r.og[p]);
    if (ogManquantes.length > 0) {
      cell.og = '✗';
      problemes.push(`ERROR balises OG absentes : ${ogManquantes.join(', ')}`);
    }
    if (r.h1Count !== 1) {
      cell.h1 = '✗';
      problemes.push(`ERROR <h1> : ${r.h1Count} balise(s)`);
    }
  }

  erreurs += problemes.filter((p) => p.startsWith('ERROR')).length;
  avertissements += problemes.filter((p) => p.startsWith('WARN')).length;
  lignes.push({ r, cell, problemes });
}

// ---------------------------------------------------------------------------
// 5. Sortie : tableau markdown + récapitulatif + verdict.
// ---------------------------------------------------------------------------
console.log(`# Audit SEO — ${sitemapUrls.length} pages du sitemap`);
console.log(`Cible de fetch : ${FETCH_BASE} (canonical comparé à ${SITE})\n`);
console.log('| Page | HTTP | Title | Desc | Canonical | OG | H1 |');
console.log('|---|---|---|---|---|---|---|');
for (const { r, cell } of lignes) {
  const chemin = r.urlProd === SITE ? '/' : r.urlProd.slice(SITE.length);
  console.log(`| \`${chemin}\` | ${cell.http} | ${cell.titre} | ${cell.desc} | ${cell.canon} | ${cell.og} | ${cell.h1} |`);
}

const coupables = lignes.filter((l) => l.problemes.length > 0);
if (coupables.length > 0) {
  console.log('\n## Pages en défaut');
  for (const { r, problemes } of coupables) {
    console.log(`- ${r.urlProd}`);
    for (const p of problemes) console.log(`  - ${p}`);
  }
}

console.log(
  `\nRécapitulatif : ${sitemapUrls.length} pages crawlees, ${erreurs} erreur(s), ${avertissements} avertissement(s).`,
);
const gate = erreurs === 0 && avertissements <= MAX_WARNINGS;
console.log(
  gate
    ? `✓ seo-audit: 0 erreur, ≤ ${MAX_WARNINGS} avertissements — gate pré-lancement OK.`
    : `✗ seo-audit: gate dépassé (0 erreur attendue, ≤ ${MAX_WARNINGS} avertissements) — voir ci-dessus.`,
);
process.exit(gate ? 0 : 1);
