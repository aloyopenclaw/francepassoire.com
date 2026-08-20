#!/usr/bin/env node
// FrancePassoire — balayage horaire du jour de lancement (T50).
// Sonde TOUTES les routes du build (dist/sitemap-0.xml) + les 3 cibles
// « fond de sonde » du chien de garde (feed.xml, registre.jsonl, api/health)
// + la cohérence catalogue (compte API vs URLs /fiche/ du sitemap).
// Sortie 1 en nommant chaque échec ; tableau « markdown-ish » pour le
// journal de lancement. Zéro dépendance.
//
// Usage (cadence horaire du jour J — cron local ou boucle shell) :
//   node scripts/launch-sweep.mjs
//   node scripts/launch-sweep.mjs --base https://<preprod> --api-base https://<api>
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://francepassoire.com';
const API = 'https://api.francepassoire.com';
const DELAI_MS = 15_000;
const CONCURRENCE = 8;

const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

// --- Arguments : --base / --api-base (préproduction, tunnel…) --------------
const args = process.argv.slice(2);
function valeurArg(nom) {
  const i = args.indexOf(`--${nom}`);
  return i !== -1 && args[i + 1] ? args[i + 1].replace(/\/+$/, '') : null;
}
const base = valeurArg('base') ?? SITE;
const apiBase = valeurArg('api-base') ?? API;

const echecs = [];
function echec(message) {
  echecs.push(message);
  console.error(`✗ ${message}`);
}

// --- 1. Lecture du build : sitemap + dataset API ---------------------------
const sitemapPath = join(distDir, 'sitemap-0.xml');
if (!existsSync(sitemapPath)) {
  console.error('✗ dist/sitemap-0.xml introuvable — lancez d’abord `npm run build`.');
  process.exit(1);
}
const urlsSitemap = [...readFileSync(sitemapPath, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(
  (m) => m[1].trim(),
);
if (urlsSitemap.length === 0) echec('dist/sitemap-0.xml ne contient aucune URL (<loc>).');

const fichesPath = join(distDir, 'api', 'v1', 'fiches.json');
let compteApi = null;
if (existsSync(fichesPath)) {
  try {
    const dataset = JSON.parse(readFileSync(fichesPath, 'utf8'));
    compteApi =
      typeof dataset.count === 'number' ? dataset.count : (dataset.fiches ?? []).length;
  } catch (e) {
    echec(`dist/api/v1/fiches.json illisible : ${e.message}`);
  }
} else {
  echec('dist/api/v1/fiches.json introuvable.');
}

// --- 2. Cohérence catalogue : fiches API vs URLs /fiche/ du sitemap --------
const urlsFiches = urlsSitemap.filter((u) => u.includes('/fiche/'));
if (compteApi !== null && urlsFiches.length !== compteApi) {
  echec(
    `cohérence catalogue : ${urlsFiches.length} URLs /fiche/ dans le sitemap contre ${compteApi} fiches dans l’API.`,
  );
}
const coherence =
  compteApi === null
    ? 'indéterminée (dataset API illisible)'
    : `${urlsFiches.length} URLs /fiche/ = ${compteApi} fiches API → OK`;

// --- 3. File de sonde : toutes les routes + cibles profondes ---------------
// Cibles « fond de sonde » : mêmes vérifications de corps que le chien de
// garde (workers/watchdog), plus la sanité RSS (<rss> + au moins un <item>).
const probesProfondes = [
  {
    nom: 'feed.xml (fond : <rss> + <item>)',
    url: `${base}/feed.xml`,
    async verifier(reponse) {
      const corps = await reponse.text();
      if (!corps.includes('<rss')) return 'corps sans <rss';
      if (!/<item[\s>]/.test(corps)) return 'flux RSS sans aucun <item>';
      return null;
    },
  },
  {
    nom: 'registre.jsonl (fond : non vide)',
    url: `${base}/registre.jsonl`,
    async verifier(reponse) {
      return (await reponse.text()).trim() === '' ? 'corps vide' : null;
    },
  },
  {
    nom: 'api/health (fond : {ok:true})',
    url: `${apiBase}/api/health`,
    async verifier(reponse) {
      try {
        return JSON.parse(await reponse.text()).ok === true ? null : 'corps sans {ok:true}';
      } catch {
        return 'corps non-JSON';
      }
    },
  },
];

const sondes = [
  ...urlsSitemap.map((u) => ({
    nom: u,
    url: u.startsWith(SITE) ? base + u.slice(SITE.length) : u,
    verifier: null,
  })),
  ...probesProfondes,
];

async function sonder(sonde) {
  const debut = Date.now();
  try {
    const reponse = await fetch(sonde.url, {
      signal: AbortSignal.timeout(DELAI_MS),
      redirect: 'follow',
      headers: { 'user-agent': 'FrancePassoire-LaunchSweep/1.0' },
    });
    const latence = Date.now() - debut;
    if (reponse.status !== 200) {
      await reponse.body?.cancel().catch(() => {});
      echec(`${sonde.nom} : statut ${reponse.status}.`);
      return `| ✗ | ${reponse.status} | ${latence} ms | ${sonde.nom} |`;
    }
    if (sonde.verifier) {
      const raison = await sonde.verifier(reponse);
      if (raison) {
        echec(`${sonde.nom} : ${raison}.`);
        return `| ✗ | 200 | ${latence} ms | ${sonde.nom} (${raison}) |`;
      }
    } else {
      await reponse.body?.cancel().catch(() => {});
    }
    return `| OK | 200 | ${latence} ms | ${sonde.nom} |`;
  } catch (e) {
    const raison =
      e.name === 'TimeoutError' ? `pas de réponse sous ${DELAI_MS / 1000} s` : e.message;
    echec(`${sonde.nom} : ${raison}.`);
    return `| ✗ | — | ${Date.now() - debut} ms | ${sonde.nom} |`;
  }
}

// --- 4. Passage (concurrence bornée, ordre du sitemap préservé) ------------
const lignes = [];
for (let i = 0; i < sondes.length; i += CONCURRENCE) {
  const lot = sondes.slice(i, i + CONCURRENCE);
  lignes.push(...(await Promise.all(lot.map(sonder))));
}

// --- 5. Bilan ----------------------------------------------------------------
console.log(`# Balayage lancement FrancePassoire — ${new Date().toISOString()}`);
console.log(`Base : ${base} (API : ${apiBase})`);
console.log('');
console.log('## Cohérence catalogue');
console.log(`- ${coherence}`);
console.log('');
console.log(`## Sondes (${String(sondes.length)})`);
console.log('| Verdict | Statut | Latence | Cible |');
console.log('| --- | --- | --- | --- |');
for (const ligne of lignes) console.log(ligne);
console.log('');
const nbOk = lignes.filter((l) => l.startsWith('| OK')).length;
console.log('## Bilan');
console.log(`${nbOk}/${String(sondes.length)} sondes OK, ${String(echecs.length)} échec(s).`);
if (echecs.length === 0) {
  console.log('✓ balayage propre.');
  process.exit(0);
}
for (const e of echecs) console.log(`- ✗ ${e}`);
process.exit(1);
