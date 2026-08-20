#!/usr/bin/env node
// FrancePassoire — effacement RGPD (art. 17) d'un abonné watchlist, exécution
// IMMÉDIATE sans confirmation. Zéro dépendance (Node ≥ 22, wrangler du dépôt).
//
// Usage :
//   node scripts/erase-subscriber.mjs <email-ou-jeton> [--local|--remote]
//
//   --local  (défaut) D1 locale (.wrangler/ du dépôt) — sûr par défaut pour
//                        une opération destructive.
//   --remote          D1 de production (staging partagé) — explicite.
//
// Recherche de la ligne : par email_hash (SHA-256 hex de l'adresse
// normalisée — convention engageante documentée dans docs/rgpd.md §1.2,
// reprise par T30) OU par unsub_token exact. L'adresse en clair n'est jamais
// placée dans le SQL (seulement son hash) ; le jeton et les id sont validés
// par jeu de caractères avant inclusion — aucun échappement ad hoc nécessaire.
//
// Sorties : reçu lisible (id, création, confirmation, horodatage) → exit 0 ;
// cible inexistante → message clair, exit 1 ; usage invalide → exit 2 ;
// échec wrangler → stderr retransmis, exit 1.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

function usageEtSortir(code) {
  console.error(
    'Usage : node scripts/erase-subscriber.mjs <email-ou-jeton> [--local|--remote]\n' +
      '  <email-ou-jeton>  adresse email OU jeton de désinscription (unsub_token)\n' +
      '  --local (défaut)  D1 locale du dépôt — --remote pour la production',
  );
  process.exit(code);
}

function echouer(message) {
  console.error(`✗ erase-subscriber : ${message}`);
  process.exit(1);
}

/** wrangler d1 execute (JSON) → objet results[0] parsé, ou échec propre. */
function d1Execute(command, remote) {
  const args = [
    'wrangler', 'd1', 'execute', 'francepassoire',
    remote ? '--remote' : '--local',
    '--json', '--command', command,
  ];
  const proc = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (proc.error) echouer(`impossible de lancer wrangler (${proc.error.message})`);
  const brut = proc.stdout ?? '';
  // wrangler peut écrire des lignes d'information avant le JSON : on isole le
  // premier document JSON (tableau) de stdout.
  const debut = brut.indexOf('[');
  const fin = brut.lastIndexOf(']');
  if (proc.status !== 0 || debut === -1 || fin === -1) {
    console.error(proc.stderr ?? '(aucun stderr)');
    echouer(`wrangler d1 execute a échoué (exit ${proc.status ?? '?'})`);
  }
  try {
    return JSON.parse(brut.slice(debut, fin + 1))[0];
  } catch (e) {
    echouer(`sortie wrangler illisible : ${e.message}`);
  }
}

const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2) usageEtSortir(2);
const cible = args[0];
const remote = args.includes('--remote');
if (args.includes('--local') && remote) usageEtSortir(2);
const mode = remote ? 'D1 distante (--remote)' : 'D1 locale (--local, défaut)';
if (args[1] !== undefined && args[1] !== '--remote' && args[1] !== '--local') {
  usageEtSortir(2);
}

// Identification de la cible : email → hash SHA-256 (jamais de SQL avec
// l'adresse en clair) ; sinon jeton validé par jeu de caractères.
const estEmail = EMAIL_RE.test(cible);
const estJeton = TOKEN_RE.test(cible);
if (!estEmail && !estJeton) {
  echouer(
    'la cible n’est ni une adresse email ni un jeton valide ' +
      `(attendu : email, ou [A-Za-z0-9_-]{8,128}) — reçu : « ${cible} »)`,
  );
}

const emailHash = estEmail
  ? createHash('sha256').update(cible.trim().toLowerCase()).digest('hex')
  : null;
const ou = estEmail
  ? `email_hash = '${emailHash}'`
  : `unsub_token = '${cible}'`;

const select = d1Execute(
  `SELECT id, confirmed_at, created_at FROM subscribers WHERE ${ou}`,
  remote,
);
const lignes = select.results ?? [];
if (lignes.length === 0) {
  console.error(
    `✗ Aucun abonné correspondant (${estEmail ? 'email → email_hash sha256' : 'jeton'}) en base ${mode}. Rien n’a été supprimé.`,
  );
  process.exit(1);
}
for (const ligne of lignes) {
  if (!ID_RE.test(ligne.id)) echouer(`id de ligne inattendu refusé : « ${ligne.id} »`);
}

const ids = lignes.map((l) => `'${l.id}'`).join(', ');
const suppression = d1Execute(`DELETE FROM subscribers WHERE id IN (${ids})`, remote);
if (suppression.success !== true) {
  echouer('DELETE signalé en échec par wrangler');
}
// Vérification de l'effacement par re-SELECT : la CLI wrangler locale
// n'expose pas toujours meta.changes, on ne dépend donc que de l'état final.
const verification = d1Execute(`SELECT id FROM subscribers WHERE ${ou}`, remote);
if ((verification.results ?? []).length > 0) {
  echouer(
    `des lignes correspondantes subsistent après DELETE (${(verification.results ?? []).length})`,
  );
}

console.log('✓ Effacement exécuté et vérifié (re-SELECT vide) — reçu RGPD (art. 17), conservation nulle.');
console.log(`  base        : ${remote ? 'D1 distante (production)' : 'D1 locale (.wrangler)'} — francepassoire`);
console.log(`  cible       : ${estEmail ? `${cible} (sha256 ${emailHash.slice(0, 12)}…)` : `jeton ${cible.slice(0, 8)}…`}`);
console.log(`  lignes      : ${lignes.length}`);
for (const l of lignes) {
  console.log(
    `  - id ${l.id}, créée le ${l.created_at}, ${l.confirmed_at ? `confirmée le ${l.confirmed_at}` : 'jamais confirmée'}`,
  );
}
console.log(`  horodatage  : ${new Date().toISOString()}`);
