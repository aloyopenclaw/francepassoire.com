#!/usr/bin/env node
// Fumée sociale Nostr (tâche 38) — preuve de bout en bout du chemin de
// publication, SANS dépendance utilisateur : UNE note kind 1 « Bonjour depuis
// FrancePassoire — test technique » signée avec la clé d'ancrage en
// quarantaine, envoyée aux 3 relais épinglés, puis RELUE sur les mêmes relais
// (filtre par id) pour prouver la réception. Le secret n'est jamais affiché.
//
//   node scripts/social-smoke.mjs
//
// Exit 0 si ≥ 1 relais a accepté la note ET ≥ 1 relais l'a servie en
// relecture. La note de test reste publiée (vérifiable par son id) — c'est
// le principe d'une fumée : elle témoigne.

import { finalizeEvent, verifyEvent } from 'nostr-tools';
import { RELAIS_EPINGLES, chargerCle } from './nostr-key.mjs';

const TEXTE_TEST = 'Bonjour depuis FrancePassoire — test technique';
const DELAI_MS = 8000;

function secretDepuisHex(secretHex) {
  return new Uint8Array(Buffer.from(secretHex, 'hex'));
}

/** Envoie l'événement à un relais ; résout { relay, ok, message } (jamais de rejet). */
function envoyerAuRelais(relay, event) {
  return new Promise((resoudre) => {
    let ws;
    const fin = (ok, message) => {
      try {
        ws?.close();
      } catch {}
      resoudre({ relay, ok, message });
    };
    const minuteur = setTimeout(() => fin(false, 'expiration du délai'), DELAI_MS);
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

/** Relit l'événement par son id (REQ + filtre ids) ; résout { relay, servi }. */
function relireAuRelais(relay, idEvenement) {
  return new Promise((resoudre) => {
    let ws;
    const fin = (servi) => {
      try {
        ws?.close();
      } catch {}
      resoudre({ relay, servi });
    };
    const minuteur = setTimeout(() => fin(false), DELAI_MS);
    try {
      ws = new WebSocket(relay);
    } catch {
      clearTimeout(minuteur);
      return fin(false);
    }
    ws.onopen = () => ws.send(JSON.stringify(['REQ', 'smoke', { ids: [idEvenement] }]));
    ws.onerror = () => {
      clearTimeout(minuteur);
      fin(false);
    };
    ws.onmessage = (msg) => {
      try {
        const [type, sousId, evenement] = JSON.parse(String(msg.data));
        if (type === 'EVENT' && sousId === 'smoke' && evenement?.id === idEvenement) {
          clearTimeout(minuteur);
          fin(verifyEvent(evenement) && evenement.content === TEXTE_TEST);
        }
      } catch {}
    };
    ws.onclose = () => {
      clearTimeout(minuteur);
      fin(false);
    };
  });
}

const { secretHex, npub } = chargerCle();
const note = finalizeEvent(
  { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: TEXTE_TEST },
  secretDepuisHex(secretHex),
);
if (!verifyEvent(note)) {
  console.error('ERREUR : note auto-signée non vérifiable — abandon');
  process.exit(1);
}
console.log(`note signée (émetteur ${npub}) — id ${note.id}`);

const envois = await Promise.all(RELAIS_EPINGLES.map((relais) => envoyerAuRelais(relais, note)));
for (const { relay, ok, message } of envois) {
  console.log(`envoi  ${relay} : ${ok ? 'ACCEPTÉ' : `échec (${message})`}`);
}
const accepteurs = envois.filter((e) => e.ok);
if (accepteurs.length === 0) {
  console.error('AUCUN relais n’a accepté la note — fumée négative');
  process.exit(1);
}

// Laisse aux relais le temps d'indexer avant la relecture.
await new Promise((r) => setTimeout(r, 1000));
const lectures = await Promise.all(RELAIS_EPINGLES.map((relais) => relireAuRelais(relais, note.id)));
for (const { relay, servi } of lectures) {
  console.log(`lecture ${relay} : ${servi ? 'SERVIE (id + signature + contenu vérifiés)' : 'non servie'}`);
}
const temoins = lectures.filter((l) => l.servi);

console.log(
  `FUMÉE ${temoins.length > 0 ? 'OK' : 'NÉGATIVE'} — acceptée par ${accepteurs.length}/3 relais, relue sur ${temoins.length}/3 — id ${note.id}`,
);
process.exit(temoins.length > 0 ? 0 : 1);
