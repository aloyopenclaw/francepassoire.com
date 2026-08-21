#!/usr/bin/env node
// Publication des ancrages Nostr du registre FrancePassoire — exécuté UNIQUEMENT
// au moment de la genèse (étape d du runbook dans docs/ancrages.md), puis à
// chaque fusion si le hook CI l'appelle. Signe des notes kind-1 avec la clé en
// quarantaine (~/.config/francepassoire/nostr.key) :
//   - une note par fiche : « ANCRAGE <slug> <empreinte> »
//   - une note de tête  : « ANCRAGE TETE <empreinte> … »
// et les envoie au mieux (best-effort) sur les 3 relais épinglés, puis enregistre
// les ids d'événements dans le tableau « Ancrages publiés » de docs/ancrages.md.
//
//   node scripts/publish-anchors.mjs [--registre registre.jsonl]
//                                    [--ancrages docs/ancrages.md]
//                                    [--relays wss://…,wss://…]
//                                    [--dry-run]
//
// --dry-run : construit et signe les notes, les affiche, ne touche ni aux
// relais ni au document (répétition sans effet de bord).
//
// Exit 0 si chaque note est acceptée par ≥1 relais (hors dry-run) ; exit 1 sinon.
// L'exigence « ≥2 relais » est contrôlée a posteriori par verify-anchors.mjs.

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { finalizeEvent, verifyEvent } from 'nostr-tools';
import { RELAIS_EPINGLES, chargerCle } from './nostr-key.mjs';
import { parseJsonl, verifierChaine } from './registre-lib.mjs';

const USAGE = `usage : node scripts/publish-anchors.mjs [--registre registre.jsonl] [--ancrages docs/ancrages.md] [--relays wss://…,wss://…] [--dry-run]`;

function analyserArgs(argv) {
  const opts = {
    registre: 'registre.jsonl',
    ancrages: 'docs/ancrages.md',
    relays: RELAIS_EPINGLES,
    dryRun: false,
    tout: false,
  };
  const connus = new Set(['--registre', '--ancrages', '--relays', '--dry-run', '--tout']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    if (!connus.has(a)) {
      console.error(`option inconnue : ${a}`);
      console.error(USAGE);
      process.exit(2);
    }
    if (a === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (a === '--tout') {
      opts.tout = true;
      continue;
    }
    const valeur = argv[++i];
    if (valeur === undefined) {
      console.error(`${a} attend une valeur`);
      process.exit(2);
    }
    if (a === '--registre') opts.registre = valeur;
    else if (a === '--ancrages') opts.ancrages = valeur;
    else if (a === '--relays') opts.relays = valeur.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return opts;
}

/** Envoie un événement à un relais ; résout {relay, ok, message} (jamais de rejet). */
function envoyerAuRelais(relay, event, timeoutMs = 5000) {
  return new Promise((resoudre) => {
    let ws;
    const fin = (ok, message) => {
      try {
        ws?.close();
      } catch {}
      resoudre({ relay, ok, message });
    };
    const minuteur = setTimeout(() => fin(false, 'expiration du délai'), timeoutMs);
    try {
      ws = new WebSocket(relay);
    } catch (erreur) {
      clearTimeout(minuteur);
      return fin(false, `connexion impossible : ${erreur.message}`);
    }
    ws.onopen = () => ws.send(JSON.stringify(['EVENT', event]));
    ws.onerror = () => {
      clearTimeout(minuteur);
      fin(false, 'erreur de transport');
    };
    ws.onmessage = (msg) => {
      try {
        const [type, id, accepte, message] = JSON.parse(String(msg.data));
        if (type === 'OK' && id === event.id) {
          clearTimeout(minuteur);
          fin(accepte === true, String(message ?? ''));
        }
      } catch {}
    };
    ws.onclose = () => {
      clearTimeout(minuteur);
      resoudre({ relay, ok: false, message: 'connexion fermée avant OK' });
    };
  });
}

/**
 * Ajoute des lignes au tableau « Ancrages publiés » de docs/ancrages.md.
 * Chaque ligne : [ancrage, empreinte, idEvenement]. UPSERT : les lignes
 * existantes voient leur pointeur d'événement rafraîchi (les relais
 * purgent les anciennes notes ; les empreintes, elles, sont permanentes).
 */

// Lecture du tableau « Ancrages publiés » → Map(ancrage → empreinte).
// Utilisée par le mode lacunaire : ne republier QUE ce qui manque.
function lireAncragesTableau(cheminDoc) {
  try {
    const lignesFichier = readFileSync(cheminDoc, 'utf8').split('\n');
    let iTable = -1;
    for (let i = 0; i < lignesFichier.length; i++) {
      if (lignesFichier[i].includes('Ancrages publiés')) { iTable = i; break; }
    }
    if (iTable === -1) return [];
    const paires = [];
    for (let i = iTable + 1; i < lignesFichier.length; i++) {
      const l = lignesFichier[i].trim();
      if (!l.startsWith('|')) { if (paires.length > 0) break; continue; }
      const cols = l.split('|').map((c) => c.trim());
      if (cols[1] && cols[1] !== 'ancrage' && !cols[1].startsWith('-') && /^[0-9a-f]{64}$/.test(cols[2] ?? '')) {
        paires.push([cols[1], cols[2]]);
      }
    }
    return paires;
  } catch {
    return [];
  }
}

function enregistrerAncrages(cheminDoc, lignes) {
  const lignesFichier = readFileSync(cheminDoc, 'utf8').split('\n');
  let iTable = -1;
  for (let i = 0; i < lignesFichier.length; i++) {
    if (lignesFichier[i].includes('Ancrages publiés')) {
      iTable = i;
      break;
    }
  }
  if (iTable === -1) {
    throw new Error(`section « ## Ancrages publiés » introuvable dans ${cheminDoc}`);
  }
  // Bornes du tableau : on saute le prose explicatif sous le titre (borné),
  // puis on consomme les lignes '|' consécutives.
  let debut = iTable + 1;
  while (
    debut < lignesFichier.length &&
    !lignesFichier[debut].trim().startsWith('|') &&
    !lignesFichier[debut].startsWith('#') &&
    debut - iTable <= 20
  ) {
    debut++;
  }
  let fin = debut;
  while (fin < lignesFichier.length && lignesFichier[fin].trim().startsWith('|')) {
    fin++;
  }
  if (fin === debut) {
    throw new Error(`tableau Markdown absent sous « ## Ancrages publiés » dans ${cheminDoc}`);
  }
  // Sémantique UPSERT : chaque passage re-signe et re-publie TOUTES les notes
  // (les relais purgent les anciens événements — seuls les EMPREINTES sont
  // permanentes) puis met à jour chaque ligne du tableau (ajout si absente,
  // remplacement du pointeur d'événement sinon). La ligne « tête » suit
  // naturellement la même règle (référence mobile).
  const parAncrage = new Map(lignes.map(([a, e, id]) => [a, [e, id]]));
  let misesAJour = 0;
  let ajouts = 0;
  for (const [ancrage, [empreinte, id]] of parAncrage) {
    const rendu = `| ${ancrage} | ${empreinte} | ${id} |`;
    const index = lignesFichier.findIndex(
      (l) => l.trim().startsWith('|') && l.split('|')[1]?.trim() === ancrage,
    );
    if (index === -1) {
      lignesFichier.splice(fin + ajouts, 0, rendu);
      ajouts++;
    } else if (lignesFichier[index] !== rendu) {
      lignesFichier[index] = rendu;
      misesAJour++;
    }
  }
  if (ajouts > 0 || misesAJour > 0) {
    writeFileSync(cheminDoc, lignesFichier.join('\n'), 'utf8');
  }
  return { ajoutes: ajouts, misesAJour, ignores: 0 };
}

async function main() {
  const opts = analyserArgs(process.argv.slice(2));

  let brut;
  try {
    brut = readFileSync(opts.registre, 'utf8');
  } catch {
    console.error(`${opts.registre} introuvable — lancer d'abord scripts/genesis.mjs`);
    return 2;
  }
  const lignes = parseJsonl(brut);
  const resultat = verifierChaine(lignes);
  if (!resultat.valide) {
    console.error(`registre invalide (${resultat.erreur}) — aucun ancrage publié`);
    return 1;
  }
  const { secretHex, npub } = chargerCle();
  const secret = new Uint8Array(Buffer.from(secretHex, 'hex'));
  const maintenant = Math.floor(Date.now() / 1000);
  const tag = [['t', 'francepassoire']];

  const modeles = lignes
    .filter((l) => l.type === 'ajout' && typeof l.fiche_du === 'string')
    .map((l) => ({
      ancrage: l.fiche_du,
      empreinte: l.empreinte,
      contenu: `ANCRAGE ${l.fiche_du} ${l.empreinte}`,
    }));
  modeles.push({
    ancrage: 'tête',
    empreinte: resultat.empreinteTete,
    contenu: `ANCRAGE TETE ${resultat.empreinteTete} — FrancePassoire, tête du registre (${resultat.nbEvenements} événements)`,
  });

  // MODE LACUNAIRE (21/08) : re-publier TOUT le troupeau à chaque append
  // faisait throttler les relais (damus/primal) et empêchait les NOUVEAUX
  // ancres de coller. Par défaut on ne publie plus que : la tête + les
  // ancrages absents du tableau ou dont l'empreinte a changé. --tout force
  // l'ancien comportement complet.
  const existants = new Map(lireAncragesTableau(opts.ancrages));
  const aPublier = opts.tout
    ? modeles
    : modeles.filter((m) => existants.get(m.ancrage) !== m.empreinte);

  const evenements = aPublier.map(({ ancrage, empreinte, contenu }) => {
    const event = finalizeEvent({ kind: 1, created_at: maintenant, tags: tag, content: contenu }, secret);
    if (!verifyEvent(event)) {
      throw new Error(`signature invalide pour l'ancrage ${ancrage} — clé corrompue ?`);
    }
    return { ancrage, empreinteContenue: empreinte, event };
  });

  console.log(`clé d'ancrage : ${npub}`);
  console.log(`registre : ${resultat.nbEvenements} événements, tête ${resultat.empreinteTete.slice(0, 16)}…`);
  console.log(`${evenements.length} note(s) kind-1 à publier sur ${opts.relays.length} relais`);

  if (opts.dryRun) {
    for (const { ancrage, event } of evenements) {
      console.log(`[dry-run] ${ancrage} → ${event.id} : « ${event.content} »`);
    }
    console.log('[dry-run] relais ciblés : ' + opts.relays.join(', '));
    return 0;
  }

  let tousAcceptes = true;
  for (const { ancrage, event } of evenements) {
    const resultats = await Promise.all(
      opts.relays.map((r) => envoyerAuRelais(r, event)),
    );
    const accepts = resultats.filter((r) => r.ok);
    for (const r of resultats) {
      const verdict = r.ok ? 'OK' : `ÉCHEC (${r.message})`;
      console.log(`${ancrage} ${event.id} — ${r.relay} : ${verdict}`);
    }
    if (accepts.length === 0) {
      console.error(`ancrage ${ancrage} refusé par tous les relais`);
      tousAcceptes = false;
    }
  }

  if (tousAcceptes) {
    const { ajoutes, misesAJour } = enregistrerAncrages(
      opts.ancrages,
      evenements.map(({ ancrage, empreinteContenue, event }) => [ancrage, empreinteContenue, event.id]),
    );
    console.log(
      `${opts.ancrages} : ${ajoutes} ancrage(s) ajouté(s), ${misesAJour} mis(es) à jour (rajeunissement des pointeurs Nostr)`,
    );
  }
  console.log('contrôle final : node scripts/verify-anchors.mjs');
  return tousAcceptes ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((erreur) => {
    console.error(erreur instanceof Error ? erreur.message : String(erreur));
    process.exit(1);
  });
