#!/usr/bin/env node
// FrancePassoire — vérifie que les en-têtes de sécurité (public/_headers)
// sont bien appliqués par un runtime Cloudflare Pages sur les routes clés.
// Sortie 0 si tout est conforme ; sortie 1 en nommant chaque écart. Zéro dépendance.
//
// Usage : node scripts/check-headers.mjs (après `npm run build`)
//
// Serveur : `wrangler pages dev dist` (déjà en devDependency). On n'utilise
// PAS `astro preview` : le preview statique d'Astro sert dist/ tel quel et
// n'applique PAS le fichier _headers — seule la runtime Pages (wrangler)
// offre des assertions réelles de bout en bout.
// CSP : phase Report-Only (plan T45) — la présence de Content-Security-Policy-
// Report-Only est exigée ; l'ABSENCE de l'en-tête forceur est acceptée
// (bascule prévue après 48 h de rapports propres, cf. public/_headers).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;

const CSP_BASE =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://api.pwnedpasswords.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
const CSP_SIGNALER =
  "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
const CSP_EMBED = CSP_BASE
  .replace(" connect-src 'self' https://api.pwnedpasswords.com;", " connect-src 'self';")
  .replace("frame-ancestors 'none'", 'frame-ancestors *');

const BASELINE = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'DENY',
};

const ROUTES = [
  { path: '/', status: 200, csp: CSP_BASE },
  { path: '/proteger/', status: 200, csp: CSP_BASE },
  { path: '/signaler/', status: 200, csp: CSP_SIGNALER },
  // Route T35 (branche feat/open-data) : 404 sur main, 200 après merge —
  // les en-têtes de l'exception /embed/* doivent s'appliquer dès aujourd'hui.
  { path: '/embed/compteur', status: [200, 404], csp: CSP_EMBED, noXfo: true },
  // Chemin inconnu : 404 en production Pages ; le wrangler local sert un
  // repli SPA (index.html, 200) — divergence connue du runtime de dev.
  // On accepte les deux : ce qui est asserté strictement, ce sont les en-têtes.
  { path: '/inexistant-t45', status: [200, 404], csp: CSP_BASE },
];

const FONTS = [
  'bricolage-grotesque-var-opsz-wght-latin.woff2',
  'bricolage-grotesque-var-opsz-wght-latin-ext.woff2',
  'instrument-sans-var-wght-latin.woff2',
  'instrument-sans-var-wght-latin-ext.woff2',
  'spline-sans-mono-var-wght-latin.woff2',
  'spline-sans-mono-var-wght-latin-ext.woff2',
];

function fail(msg) {
  console.error(`✗ check-headers: ${msg}`);
  process.exit(1);
}

function startServer() {
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
  const proc = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['wrangler', 'pages', 'dev', 'dist', '--port', String(PORT), '--ip', '127.0.0.1'],
    { cwd: ROOT, env, stdio: 'ignore', detached: true },
  );
  proc.on('error', (e) => fail(`impossible de lancer wrangler pages dev (${e.message})`));
  return proc;
}

async function waitReady(deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`, { redirect: 'manual' });
      if (res.status > 0) return true;
    } catch {
      /* pas encore prêt — nouvelle tentative */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

if (!existsSync(DIST) || !existsSync(resolve(DIST, 'index.html'))) {
  fail(`dist/ introuvable — lancez d'abord \`npm run build\`.`);
}
if (!existsSync(resolve(ROOT, 'public/_headers'))) {
  fail('public/_headers introuvable.');
}

const server = startServer();
let failures = 0;
const rows = [];

try {
  if (!(await waitReady(45000))) fail(`le serveur de test n'a pas répondu sur ${BASE} sous 45 s.`);

  for (const route of ROUTES) {
    const res = await fetch(`${BASE}${route.path}`, { redirect: 'manual' });
    const h = res.headers;
    const expectedStatus = Array.isArray(route.status) ? route.status : [route.status];
    const check = (label, ok, detail = '') => {
      rows.push({ route: route.path, check: label, ok, detail });
      if (!ok) failures++;
    };

    check(
      `statut ${expectedStatus.join('|')}`,
      expectedStatus.includes(res.status),
      `reçu ${res.status}`,
    );

    for (const [name, value] of Object.entries(BASELINE)) {
      if (name === 'X-Frame-Options' && route.noXfo) continue;
      check(name, h.get(name) === value, h.get(name) ?? '(absent)');
    }
    if (route.noXfo) {
      check(
        'X-Frame-Options absent (exception /embed)',
        h.get('x-frame-options') === null,
        h.get('x-frame-options') ?? '(absent)',
      );
    }

    const csp = h.get('content-security-policy-report-only');
    check(
      'CSP-Report-Only',
      csp === route.csp,
      csp ? `OK (${csp.length} car.)` : '(absent)',
    );
    if (csp && csp !== route.csp) rows.push({ route: route.path, check: '  ↳ CSP reçue', ok: null, detail: csp });
    // Anti-concaténation : deux règles qui attachent le même en-tête produisent
    // une jointure par virgule (intersection CSP) — aucune de nos CSP n'a de virgule.
    check(
      'CSP sans concaténation (pas de virgule)',
      csp !== null && !csp.includes(','),
      csp === null ? '(absent)' : !csp.includes(',') ? 'OK' : 'jointe par virgule !',
    );
    // Phase Report-Only : l'absence de l'en-tête forceur est acceptée (48 h).
    if (h.get('content-security-policy')) {
      check('en-tête forceur inattendu (phase Report-Only)', false, h.get('content-security-policy'));
    }
    // Garde anti-commentaire mal parsé : aucune ligne « #ENFORCE » ne doit
    // fuiter dans les en-têtes de réponse.
    for (const [name] of h) {
      if (name.toLowerCase().includes('enforce')) check(`en-tête parasite « ${name} »`, false, '');
    }
  }

  for (const f of FONTS) {
    const res = await fetch(`${BASE}/fonts/${f}`);
    const ct = res.headers.get('content-type') ?? '(sans type)';
    const ok = res.status === 200 && /font\/woff2|octet-stream|binary/i.test(ct);
    rows.push({ route: `/fonts/${f}`, check: `200 + type font (${ct})`, ok, detail: `statut ${res.status}` });
    if (!ok) failures++;
  }
} finally {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    try {
      server.kill('SIGTERM');
    } catch {
      /* déjà arrêté */
    }
  }
}

const W = Math.max(...rows.map((r) => r.route.length + r.check.length)) + 2;
for (const r of rows) {
  const mark = r.ok === null ? ' ' : r.ok ? '✓' : '✗';
  console.log(`${mark} ${r.route} — ${r.check}`.padEnd(W + 4) + r.detail);
}
console.log(
  `\n${failures === 0 ? '✓' : '✗'} ${rows.filter((r) => r.ok === true).length}/${rows.length} vérifications OK` +
    (failures ? ` — ${failures} échec(s)` : ' — tous en-têtes conformes (phase CSP Report-Only).'),
);
process.exit(failures === 0 ? 0 : 1);
