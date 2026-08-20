#!/usr/bin/env node
// FrancePassoire — balayage zéro lien mort sur le build.
// 1. Crawl tous les href internes (nav, pied de page, corps) de dist/**/*.html
//    et résout chacun contre dist/ (index.html, .html, fragment → id cible).
// 2. Sortie 1 en nommant tout lien interne mort ou href="#".
// 3. Sonde aussi les URLs externes (HEAD, puis GET en repli) et rapporte leur statut
//    (⚠ signalement — ne fait pas échouer : les WAF presse renvoient des 403 aux scripts).
// Usage : node scripts/link-sweep.mjs (après `npm run build`). Zéro dépendance.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_HOST = 'francepassoire.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 FrancePassoireLinkSweep/1.0';
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

function fail(msg) {
  console.error(`✗ link-sweep: ${msg}`);
  process.exit(1);
}

if (!existsSync(distDir)) {
  fail(`dist/ introuvable — lancez d'abord \`npm run build\`.`);
}

// 1. Collecter toutes les pages HTML du build.
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.html')) out.push(p);
  }
  return out;
}
const htmlFiles = walk(distDir);
if (htmlFiles.length === 0) fail('aucun fichier .html dans dist/.');

// 2. Extraire chaque href avec sa page source.
const dead = [];
const externalUrls = new Set();
let internalCount = 0;

function isDead(file, href, reason) {
  dead.push(`${rel(file)} → ${href} (${reason})`);
}

function rel(file) {
  return file.slice(distDir.length + 1);
}

// Résout un chemin de lien interne contre dist/ ; null si introuvable.
function resolveInternal(rawPath) {
  let p = rawPath;
  try {
    p = decodeURIComponent(p);
  } catch {
    // chemin avec séquence % invalide — garder la forme brute.
  }
  if (p.endsWith('/')) {
    const idx = join(distDir, p, 'index.html');
    return existsSync(idx) ? idx : null;
  }
  const candidates = [p, `${p}.html`, `${p}/index.html`];
  for (const c of candidates) {
    const abs = join(distDir, c);
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return null;
}

for (const file of htmlFiles) {
  const raw = readFileSync(file, 'utf8');
  // Scanner uniquement le HTML rendu : les îlots Astro embarquent du JS inline
  // contenant des chaînes `href="…"` (faux positifs) — on retire script/style.
  const html = raw
    .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/href=(?:"([^"]*)"|'([^']*)')/g)) {
    const href = m[1] ?? m[2];
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;

    // Ancre pure (même page) : "#", "#id" — validée contre les id de la page.
    if (href.startsWith('#')) {
      internalCount++;
      if (href === '#' || href === '#/') {
        isDead(file, '#', 'href="#" — ancre vide (lien mort)');
      } else if (!ids.has(href.slice(1))) {
        isDead(file, href, `ancre absente de la page (id="${href.slice(1)}" introuvable)`);
      }
      continue;
    }

    let url;
    try {
      url = new URL(href, 'https://example.invalid');
    } catch {
      isDead(file, href, 'URL non parsable');
      continue;
    }

    // URL absolue : externe, ou interne écrite en absolu sur le domaine du site.
    if (/^https?:/i.test(href)) {
      if (url.host === SITE_HOST || url.host === `www.${SITE_HOST}`) {
        checkInternal(file, url.pathname + (url.search ?? ''), url.hash);
      } else {
        externalUrls.add(href);
      }
      continue;
    }
    if (href.startsWith('//')) {
      externalUrls.add(`https:${href}`);
      continue;
    }

    // Chemin relatif (sans barre oblique initiale) : résoudre contre la page courante.
    if (!href.startsWith('/')) {
      const dirRel = dirname(rel(file));
      const [relPath, relHash = ''] = href.split('#');
      checkInternal(file, `/${join(dirRel, relPath.split('?')[0]).replace(/\/$/, '')}`, relHash ? `#${relHash}` : '');
      continue;
    }
    checkInternal(file, url.pathname + (url.search ?? ''), url.hash);
  }

  function checkInternal(sourceFile, pathWithQuery, hash) {
    internalCount++;
    const path = pathWithQuery.split('?')[0];
    const target = resolveInternal(path === '' ? '/' : path);
    if (!target) {
      isDead(sourceFile, path, 'cible absente du build');
      return;
    }
    // Ancre d'un lien interne : vérifier l'id dans la page cible (cibles HTML uniquement).
    if (hash && hash !== '#' && target.endsWith('.html')) {
      const targetHtml = readFileSync(target, 'utf8');
      if (!new RegExp(`\\sid=["']${hash.slice(1)}["']`).test(targetHtml)) {
        isDead(sourceFile, `${path}${hash}`, `ancre absente de la cible (${target})`);
      }
    }
  }
}

// 3. Sonder les URLs externes : HEAD, puis GET en repli (pool de concurrence 6).
async function probe(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      });
      return { status: res.status, method };
    } catch {
      // réessayer en GET ; si les deux échouent → injoignable.
    }
  }
  return { status: null, method: 'HEAD+GET' };
}

const externals = [];
const queue = [...externalUrls];
async function worker() {
  while (queue.length > 0) {
    const url = queue.shift();
    externals.push({ url, ...(await probe(url)) });
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
externals.sort((a, b) => a.url.localeCompare(b.url));

// 4. Verdict.
if (dead.length > 0) {
  for (const d of dead) console.error(`✗ lien interne mort : ${d}`);
  fail(`${dead.length} lien(s) interne(s) mort(s) sur ${internalCount} vérifiés dans ${htmlFiles.length} pages.`);
}

const okExt = externals.filter((e) => e.status >= 200 && e.status < 400);
const warnExt = externals.filter((e) => !(e.status >= 200 && e.status < 400));

console.log(`✓ ${htmlFiles.length} pages · ${internalCount} liens internes vérifiés · 0 lien mort · 0 href="#".`);
console.log(`✓ ${okExt.length}/${externals.length} URLs externes joignables (HEAD, repli GET).`);
for (const e of warnExt) {
  const label = e.status === null ? 'injoignable (HEAD+GET)' : `HTTP ${e.status}`;
  console.log(`⚠ externe ${label} — à vérifier en navigateur (WAF presse possible) : ${e.url}`);
}
if (externals.length > 0) {
  console.log('  URLs externes sondées :');
  for (const e of externals) {
    console.log(`  ${String(e.status ?? 'ERR').padEnd(4)} ${e.url}`);
  }
}
