// workers/api/src/queue-watchdog.ts — chien de garde de la file éditoriale.
//
// Objectif : un calme apparent ne doit plus pouvoir passer inaperçu. Si le
// plus ancien candidat NEW attend depuis plus de 24 h (ingest mort, drafting
// bloqué, PR jamais mergée), le propriétaire est alerté.
//
// Déclenché par le cron « */15 » EXISTANT du worker api (plafond gratuit :
// 5 déclencheurs cron/compte, tous consommés — aucun nouveau déclencheur ;
// le chien de garde autonome workers/watchdog reste, lui, dédié à la sonde
// du site). Chaque tick :
//   1. un SELECT D1 (compteurs NEW/DRAFT + plus ancien NEW) ;
//   2. si âge du plus ancien NEW > 24 h : garde KV « une fois par jour »
//      (watchdog:queue-alerted:<AAAAMMJJ Paris>) puis, si la garde du jour
//      n'existe pas encore, alerte sur LES DEUX canaux :
//        - email Brevo au propriétaire (helper partagé sendBrevoEmail,
//          même expéditeur que la veille watchlist/sociale) ;
//        - push téléphone Pushinator (MÊME contrat que notify.yml :
//          POST https://api.pushinator.com/api/v2/notifications/send,
//          Authorization: Bearer, JSON {channel_id, content} — notify.yml
//          est la source de vérité de cette API).
//
// La garde KV est posée AVANT les envois (convention veille-sociale : un
// échec réseau ne re-déclenche pas l'alerte au tick suivant — pas de spam,
// le lendemain réessaie). Aucun canal configuré → mode DÉTECTION SEULE
// (console.error, garde NON posée : le signal reste visible jusqu'à
// configuration, comme workers/watchdog sans NOSTR_NSEC).
//
// Testabilité : fetch injectable, horloge injectable, D1/KV structurels
// (fakes node:sqlite / Map en vitest — mêmes approches que veille-sociale).

import { sendBrevoEmail } from './watchlist';
import type { D1Database, Env } from './index';

/** Seuil de signalement : plus ancien NEW strictement plus vieux que 24 h. */
export const SEUIL_FILE_MS = 24 * 3600 * 1000;

const PREFIXE_GARDE = 'watchdog:queue-alerted:';
const PUSHINATOR_SEND_URL = 'https://api.pushinator.com/api/v2/notifications/send';
const DESTINATAIRE_PAR_DEFAUT = 'contact@francepassoire.com';
const TIMEOUT_MS = 8000;

/** Compteurs + plus ancien NEW, lus en deux requêtes D1 (status indexé). */
export interface EtatFile {
  nbNew: number;
  nbDraft: number;
  /** created_at (UTC SQLite « AAAA-MM-JJ HH:MM:SS ») du plus ancien NEW. */
  plusAncienNew: string | null;
}

export interface FileVerdict {
  nbNew: number;
  nbDraft: number;
  plusAncienNew: string | null;
  /** Âge du plus ancien NEW en heures (arrondi 0,1) — null sans NEW. */
  ageH: number | null;
  /** true si âge > SEUIL_FILE_MS. */
  bloquee: boolean;
  /** true si l'alerte du jour vient d'être déclenchée (garde posée). */
  alerte: boolean;
  /** true si la garde du jour existait déjà (aucun envoi). */
  dejaAlerte: boolean;
  /** true si aucun canal n'est configuré (garde non posée, log seul). */
  detectOnly: boolean;
  emailOk: boolean | null;
  pushOk: boolean | null;
}

export interface FileOptions {
  fetchFn?: typeof fetch;
  now?: () => Date;
  log?: (...args: unknown[]) => void;
}

/** Date created_at SQLite (UTC, espace) ou ISO → epoch ms ; 0 si illisible. */
function versEpoch(valeur: string): number {
  if (valeur.endsWith('Z') || valeur.includes('T')) return Date.parse(valeur);
  return Date.parse(`${valeur.replace(' ', 'T')}Z`);
}

/** Âge en ms du plus ancien NEW ; 0 sans NEW ou date illisible. */
export function ageFileMs(plusAncienNew: string | null, maintenant: Date): number {
  if (!plusAncienNew) return 0;
  const epoch = versEpoch(plusAncienNew);
  if (Number.isNaN(epoch)) return 0;
  return Math.max(0, maintenant.getTime() - epoch);
}

/** Clé de garde du jour (date Europe/Paris, format AAAAMMJJ du repo). */
export function cleGardeFile(maintenant: Date): string {
  const jour = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(maintenant).replaceAll('-', '');
  return `${PREFIXE_GARDE}${jour}`;
}

async function lireEtatFile(db: D1Database): Promise<EtatFile> {
  const stmtNew = db
    .prepare("SELECT COUNT(*) AS nb, COALESCE(MIN(created_at), '') AS plus_ancien FROM candidates WHERE status = 'NEW'")
    .bind();
  const newLigne = (stmtNew.first ? await stmtNew.first() : null) as
    | { nb?: number; plus_ancien?: string }
    | null;
  const stmtDraft = db.prepare("SELECT COUNT(*) AS nb FROM candidates WHERE status = 'DRAFT'").bind();
  const draftLigne = (stmtDraft.first ? await stmtDraft.first() : null) as { nb?: number } | null;
  return {
    nbNew: Number(newLigne?.nb ?? 0),
    nbDraft: Number(draftLigne?.nb ?? 0),
    plusAncienNew: newLigne?.plus_ancien || null,
  };
}

/** Push téléphone Pushinator — contrat EXACT de notify.yml (v2, Bearer). */
export async function envoyerPush(
  token: string,
  channelId: string,
  contenu: string,
  fetchFn: typeof fetch,
): Promise<{ ok: boolean; status: number }> {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(PUSHINATOR_SEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ channel_id: channelId, content: contenu }),
      signal: controleur.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(minuteur);
  }
}

/** Sujet/texte/push de l'alerte — purs, testables. */
export function textesAlerte(etat: EtatFile, ageH: number, maintenant: Date): {
  sujet: string;
  texte: string;
  push: string;
} {
  const heureFr = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(maintenant);
  const sujet = `File bloquée : le plus ancien candidat NEW attend depuis ${Math.floor(ageH)} h`;
  const texte =
    `Le chien de garde de la file a détecté un calme suspect (${heureFr}, Paris).\n\n` +
    `Plus ancien candidat NEW : ${etat.plusAncienNew ?? '?'} (≈ ${ageH.toFixed(1)} h)\n` +
    `Candidats NEW en attente : ${etat.nbNew}\n` +
    `Candidats DRAFT en cours : ${etat.nbDraft}\n\n` +
    `Causes probables : worker ingest en panne, drafting VPS bloqué ou PR jamais mergée.\n` +
    `Vérifier : actions GitHub « Rédaction candidats » et la file D1 (status NEW).`;
  const push = `FrancePassoire : file bloquée. Le plus ancien NEW attend depuis ${Math.floor(ageH)} h (${etat.nbNew} NEW, ${etat.nbDraft} DRAFT) — vérifier l'ingest et le drafting.`;
  return { sujet, texte, push };
}

/** HTML sobre aux couleurs de la maison (même palette que veille-sociale). */
function htmlAlerte(texte: string): string {
  const lignes = texte
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.5;">${l.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`)
    .join('');
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background-color:#FFF9F2;font-family:Arial,Helvetica,sans-serif;color:#241405;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF9F2;padding:40px 16px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#FFF6EA;border:3px solid #241405;border-radius:20px;box-shadow:6px 6px 0px 0px #241405;overflow:hidden;">
      <tr><td style="background-color:#FF6B1A;border-bottom:3px solid #241405;padding:24px;text-align:center;">
        <p style="margin:0;font-family:'Arial Black',Impact,sans-serif;font-size:22px;font-weight:900;color:#fff;letter-spacing:-1px;text-transform:uppercase;">File bloquée</p>
        <p style="margin:8px 0 0;font-family:'Courier New',monospace;font-size:13px;color:#241405;background-color:#FFF6EA;display:inline-block;padding:4px 12px;border:2px solid #241405;border-radius:50px;">chien de garde de file</p>
      </td></tr>
      <tr><td style="padding:28px;">${lignes}</td></tr>
      <tr><td style="padding:16px 28px;background-color:#241405;color:#FFF6EA;">
        <p style="margin:0;font-family:'Courier New',monospace;font-size:12px;">Email interne FrancePassoire &middot; alerte une fois par jour au-delà de 24 h</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/**
 * Un passage du chien de garde de file : lit D1, décide, alerte au plus une
 * fois par jour (garde KV). Ne rejette jamais — un cron ne doit pas cracher.
 */
export async function runQueueWatchdog(env: Env, options: FileOptions = {}): Promise<FileVerdict> {
  const fetchFn = options.fetchFn ?? fetch;
  const maintenant = options.now ? options.now() : new Date();
  const log = options.log ?? console.log;

  if (!env.DB || !env.RUN_STATE) {
    log('queue-watchdog: bindings DB/RUN_STATE absents — sortie propre');
    return {
      nbNew: 0, nbDraft: 0, plusAncienNew: null, ageH: null,
      bloquee: false, alerte: false, dejaAlerte: false, detectOnly: true,
      emailOk: null, pushOk: null,
    };
  }

  const etat = await lireEtatFile(env.DB);
  const ageMs = ageFileMs(etat.plusAncienNew, maintenant);
  const ageH = etat.plusAncienNew ? ageMs / 3600000 : null;
  const bloquee = ageMs > SEUIL_FILE_MS;

  const verdictBase = {
    nbNew: etat.nbNew,
    nbDraft: etat.nbDraft,
    plusAncienNew: etat.plusAncienNew,
    ageH,
    bloquee,
  };

  if (!bloquee) {
    log(`queue-watchdog: file saine (NEW=${etat.nbNew}, DRAFT=${etat.nbDraft}, plus ancien ${ageH === null ? 'n/a' : `${ageH.toFixed(1)} h`})`);
    return { ...verdictBase, alerte: false, dejaAlerte: false, detectOnly: false, emailOk: null, pushOk: null };
  }

  const cle = cleGardeFile(maintenant);
  if ((await env.RUN_STATE.get(cle)) !== null) {
    log(`queue-watchdog: file toujours bloquée (${Math.floor(ageH ?? 0)} h) — alerte déjà envoyée aujourd'hui (${cle})`);
    return { ...verdictBase, alerte: false, dejaAlerte: true, detectOnly: false, emailOk: null, pushOk: null };
  }

  const peutEmail = Boolean(env.BREVO_API_KEY);
  const peutPush = Boolean(env.PUSHINATOR_TOKEN && env.PUSHINATOR_CHANNEL);
  if (!peutEmail && !peutPush) {
    console.error(
      `queue-watchdog: DÉTECTION SEULE (ni BREVO_API_KEY ni PUSHINATOR_*) — file bloquée depuis ${Math.floor(ageH ?? 0)} h, NEW=${etat.nbNew}, DRAFT=${etat.nbDraft}`,
    );
    return { ...verdictBase, alerte: false, dejaAlerte: false, detectOnly: true, emailOk: null, pushOk: null };
  }

  // Garde posée AVANT les envois (convention veille-sociale : pas de re-spam
  // au tick suivant si le réseau grésille ; le lendemain réessaie).
  await env.RUN_STATE.put(cle, maintenant.toISOString());

  const { sujet, texte, push } = textesAlerte(etat, ageH ?? 0, maintenant);
  let emailOk: boolean | null = null;
  let pushOk: boolean | null = null;

  if (peutEmail) {
    emailOk = (
      await sendBrevoEmail(
        env.BREVO_API_KEY!,
        {
          to: env.VEILLE_SOCIALE_DEST ?? DESTINATAIRE_PAR_DEFAUT,
          subject: sujet,
          textContent: texte,
          htmlContent: htmlAlerte(texte),
        },
        fetchFn,
      )
    ).ok;
  }

  if (peutPush) {
    pushOk = (await envoyerPush(env.PUSHINATOR_TOKEN!, env.PUSHINATOR_CHANNEL!, push, fetchFn)).ok;
  }

  log(`queue-watchdog: ALERTE file bloquée ${Math.floor(ageH ?? 0)} h (NEW=${etat.nbNew}, DRAFT=${etat.nbDraft}) — email=${emailOk}, push=${pushOk}`);
  return { ...verdictBase, alerte: true, dejaAlerte: false, detectOnly: false, emailOk, pushOk };
}
