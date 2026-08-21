#!/usr/bin/env node
// Vérification des ancrages Nostr FrancePassoire — croise le document
// docs/ancrages.md, le registre chaîné publié et ≥2 relais Nostr.
//
//   node scripts/verify-anchors.mjs [--ancrages docs/ancrages.md]
//                                   [--registre registre.jsonl]
//                                   [--relays wss://…,wss://…]
//                                   [--timeout-ms 8000]
//   node scripts/verify-anchors.mjs --gen   # génère/réutilise la paire de clés
//
// --gen : crée la clé d'ancrage si absente (~/.config/francepassoire/nostr.key,
//   chmod 600) ou réutilise la clé existante (idempotent) ; affiche UNIQUEMENT
//   le npub public — le secret n'est jamais affiché ni commité.
//
// Sans --gen :
//   1. lit le tableau « ## Ancrages publiés » de docs/ancrages.md
//      (colonnes : ancrage | empreinte | id d'événement Nostr ; ligne « tête »
//      = ancre de l'empreinte de tête du registre) ;
//   2. vérifie hors-ligne le registre (--registre) et re-situe chaque empreinte
//      ancrée dans la chaîne recalculée (ligne de fiche ou tête) ;
//   3. interroge chaque relais (WebSocket natif node ≥ 22, filtre {"ids":[…]})
//      et exige que chaque événement d'ancrage, signé par NOTRE npub et
//      contenant l'empreinte, soit retourné par ≥2 relais.
//
// Exit 0 = tous les ancrages retrouvés sur ≥2 relais ; exit 1 = manque nommé
// (relais/empreinte) ; exit 2 = usage / fichiers.

import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { nip19, verifyEvent } from 'nostr-tools';
import { RELAIS_EPINGLES, genererSiAbsent } from './nostr-key.mjs';
import { parseJsonl, verifierChaine } from './registre-lib.mjs';

const USAGE = `usage : node scripts/verify-anchors.mjs [--ancrages docs/ancrages.md] [--registre registre.jsonl] [--relays …] [--timeout-ms 8000] | --gen`;

function analyserArgs(argv) {
  const opts = {
    ancrages: 'docs/ancrages.md',
    registre: 'registre.jsonl',
    relays: RELAIS_EPINGLES,
    timeoutMs: 8000,
    gen: false,
  };
  const connus = new Set(['--ancrages', '--registre', '--relays', '--timeout-ms', '--gen']);
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
    if (a === '--gen') {
      opts.gen = true;
      continue;
    }
    const valeur = argv[++i];
    if (valeur === undefined) {
      console.error(`${a} attend une valeur`);
      process.exit(2);
    }
    if (a === '--ancrages') opts.ancrages = valeur;
    else if (a === '--registre') opts.registre = valeur;
    else if (a === '--relays') opts.relays = valeur.split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--timeout-ms') opts.timeoutMs = Number(valeur);
  }
  return opts;
}

/** Extrait { npub, ancres: [{ancrage, empreinte, idEvenement}] } du document. */
function lireAncrages(cheminDoc) {
  if (!existsSync(cheminDoc)) {
    console.error(`${cheminDoc} introuvable`);
    process.exit(2);
  }
  const texte = readFileSync(cheminDoc, 'utf8');
  const npub = (texte.match(/npub1[023456789acdefghjklmnpqrstuvwxyz]+/) ?? [])[0] ?? null;
  const lignesFichier = texte.split('\n');
  let iTable = -1;
  for (let i = 0; i < lignesFichier.length; i++) {
    if (lignesFichier[i].includes('Ancrages publiés')) {
      iTable = i;
      break;
    }
  }
  const ancres = [];
  if (iTable !== -1) {
    for (let i = iTable + 1; i < lignesFichier.length; i++) {
      const l = lignesFichier[i].trim();
      if (!l.startsWith('|')) {
        if (ancres.length > 0) break; // fin du tableau
        continue;
      }
      const cols = l.split('|').map((c) => c.trim());
      const [ancrage, empreinte, idEvenement] = [cols[1], cols[2], cols[3]];
      if (
        !ancrage || ancrage === 'ancrage' || ancrage.startsWith('-') ||
        !/^[0-9a-f]{64}$/.test(empreinte ?? '') ||
        !/^[0-9a-f]{64}$/.test(idEvenement ?? '')
      ) {
        continue; // en-tête, séparateur ou ligne incomplète
      }
      ancres.push({ ancrage, empreinte, idEvenement });
    }
  }
  return { npub, ancres };
}

/**
 * Interroge un relais par filtre {"ids":[…]} ; résout { relay, events: Map<id, event> }
 * sans jamais rejeter. Collecte jusqu'à EOSE ou expiration du délai.
 */
function interrogerRelais(relay, ids, timeoutMs) {
  return new Promise((resoudre) => {
    const events = new Map();
    let ws;
    const fin = () => {
      try {
        ws?.close();
      } catch {}
      resoudre({ relay, events });
    };
    const minuteur = setTimeout(fin, timeoutMs);
    try {
      ws = new WebSocket(relay);
    } catch {
      clearTimeout(minuteur);
      return fin();
    }
    ws.onopen = () =>
      ws.send(JSON.stringify(['REQ', 'verif-' + Math.random().toString(36).slice(2, 8), { ids }]));
    ws.onerror = () => {};
    ws.onmessage = (msg) => {
      try {
        const parse = JSON.parse(String(msg.data));
        if (parse[0] === 'EVENT' && parse[2]?.id) {
          events.set(parse[2].id, parse[2]);
        } else if (parse[0] === 'EOSE' || parse[0] === 'CLOSED') {
          clearTimeout(minuteur);
          fin();
        }
      } catch {}
    };
    ws.onclose = () => {
      clearTimeout(minuteur);
      resoudre({ relay, events });
    };
  });
}

async function main() {
  const opts = analyserArgs(process.argv.slice(2));

  if (opts.gen) {
    const { npub, cree } = genererSiAbsent();
    console.log(`clé d'ancrage ${cree ? 'générée' : 'existante réutilisée'} (idempotent)`);
    console.log(`npub public : ${npub}`);
    console.log('secret : ~/.config/francepassoire/nostr.key (chmod 600) — jamais affiché, jamais commité ; backup utilisateur obligatoire');
    return 0;
  }

  const { npub, ancres } = lireAncrages(opts.ancrages);
  if (ancres.length === 0) {
    console.error(
      'aucun ancrage enregistré dans « ## Ancrages publiés » — la genèse n\'a pas encore été exécutée (voir le runbook de docs/ancrages.md)',
    );
    return 1;
  }
  console.log(`${ancres.length} ancrage(s) lu(s) dans ${opts.ancrages}`);
  if (!npub) {
    console.error('npub d\'ancrage introuvable dans le document (ligne « npub1… » attendue)');
    return 1;
  }
  let pubkeyHex;
  try {
    const decode = nip19.decode(npub);
    pubkeyHex = typeof decode.data === 'string' ? decode.data : Buffer.from(decode.data).toString('hex');
  } catch {
    console.error(`npub illisible : ${npub}`);
    return 1;
  }

  if (!existsSync(opts.registre)) {
    console.error(`${opts.registre} introuvable`);
    return 2;
  }
  const lignes = parseJsonl(readFileSync(opts.registre, 'utf8'));
  const resultat = verifierChaine(lignes);
  if (!resultat.valide) {
    console.error(`registre invalide (${resultat.erreur}) — ancrages non vérifiables`);
    return 1;
  }
  console.log(`registre : ${resultat.nbEvenements} événements vérifiés hors-ligne, tête ${resultat.empreinteTete.slice(0, 16)}…`);

  // Re-situation de chaque empreinte ancrée dans la chaîne recalculée.
  const couples = new Set(lignes.map((l) => `${String(l.fiche_du)}:${String(l.empreinte)}`));
  for (const { ancrage, empreinte } of ancres) {
    const attendu = ancrage === 'tête' ? resultat.empreinteTete === empreinte : couples.has(`${ancrage}:${empreinte}`);
    if (!attendu) {
      console.error(
        `ancrage « ${ancrage} » : empreinte ${empreinte.slice(0, 16)}… absente de la chaîne recalculée du registre`,
      );
      return 1;
    }
  }

  // Présence relais : chaque ancre doit revenir de ≥2 relais, signée par notre npub.
  // Les relais plafonnent la longueur du filtre {"ids":[…]} (~100-256) : au-delà
  // la REQ entière est ignorée et TOUT revient absent (bug 21/08 : 512 ids → 0/4).
  // On interroge donc par LOTS de 64 ids et on fusionne les résultats par relais.
  const TAILLE_LOT = 64;
  const tousLesIds = ancres.map((a) => a.idEvenement);
  const lots = [];
  for (let i = 0; i < tousLesIds.length; i += TAILLE_LOT) {
    lots.push(tousLesIds.slice(i, i + TAILLE_LOT));
  }
  const reponses = await Promise.all(
    opts.relays.map(async (r) => {
      const fusion = new Map();
      for (const lot of lots) {
        const { events } = await interrogerRelais(r, lot, opts.timeoutMs);
        for (const [id, event] of events) fusion.set(id, event);
      }
      return { relay: r, events: fusion };
    }),
  );
  let toutTrouve = true;
  for (const { ancrage, empreinte, idEvenement } of ancres) {
    const relayOk = [];
    const relayKo = [];
    for (const { relay, events } of reponses) {
      const event = events.get(idEvenement);
      if (
        event &&
        event.pubkey === pubkeyHex &&
        typeof event.content === 'string' &&
        event.content.includes(empreinte) &&
        verifyEvent(event)
      ) {
        relayOk.push(relay);
      } else {
        relayKo.push(relay);
      }
    }
    if (relayOk.length >= 2) {
      console.log(`ancrage « ${ancrage} » — ${relayOk.length}/${opts.relays.length} relais : ${relayOk.join(', ')}`);
    } else {
      toutTrouve = false;
      console.error(
        `MANQUANT : ancrage « ${ancrage} » (empreinte ${empreinte.slice(0, 16)}…, événement ${idEvenement.slice(0, 16)}…) ` +
          `retourné par ${relayOk.length}/${opts.relays.length} relais — absent ou non signé de : ${relayKo.join(', ')}`,
      );
    }
  }
  return toutTrouve ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((erreur) => {
    console.error(erreur instanceof Error ? erreur.message : String(erreur));
    process.exit(1);
  });
