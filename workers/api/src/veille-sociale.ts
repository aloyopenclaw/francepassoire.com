// workers/api/src/veille-sociale.ts — T52 : veille sociale interne, 2 slots/jour.
//
// Deviation plan (2026-08-22) : le compte gratuit Cloudflare plafonne les
// déclencheurs cron à 5 (tous consommés) — la veille n'a PAS son propre
// worker/cron ; elle est appelée par le balayage */15 du worker api, gate
// horaire Paris ci-dessous (07:00 et 19:00, DST-proof via Intl).
//
// Sources (keyless) : Google News RSS (hl=fr, gl=FR), Bluesky searchPosts
// (public.api.bsky.app, sans auth), Reddit search .rss, Mastodon recherche
// publique (401 éventuel toléré : source déclarée morte, ligne d'avertissement).
// Aucun polling X/Facebook (pas d'API gratuite — contrôle manuel propriétaire).
//
// Pipeline : fetch → normalisation {plateforme, auteur, texte, url, publie} →
// dédup (veille_seen D1 par hash d'URL + fuzzy titre in-run) → classement
// (mention exacte « FrancePassoire » > correspondance entité catalogue >
// générique) → plafond 15 → email interne via expansion du GABARIT ALERTE
// propriétaire (bandeau + cartes ; footer gestion des sources, pas de
// désinscription — mail interne). DIGEST_QUIET absent → heartbeat « la
// passoire est calme » quand rien à signaler (choix propriétaire).

import type { Env } from './index';

const DESTINATAIRE_PAR_DEFAUT = 'contact@francepassoire.com';
export const VEILLE_CAP = 15;
const TIMEOUT_MS = 8000;
const PAUSE_MS = 150;

interface Occurrence {
  plateforme: string;
  auteur: string;
  texte: string;
  url: string;
  publie: string;
  score: number;
}

interface OccurrenceBrute {
  plateforme: string;
  auteur: string;
  texte: string;
  url: string;
  publie: string;
}

/** Gate horaire : vrai sur le tick quart d'heure de 07:00 et 19:00 Europe/Paris. */
export function slotVeilleSociale(now: Date): 'matin' | 'soir' | null {
  const f = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [hh, mm] = f.format(now).split(':');
  if (mm !== '00') return null;
  if (hh === '07') return 'matin';
  if (hh === '19') return 'soir';
  return null;
}

async function hashUrlV(u: string): Promise<string> {
  const norm = u.toLowerCase().split('?')[0]!.split('#')[0]!;
  const bytes = new TextEncoder().encode(norm);
  const b = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(b))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

async function aller(url: string, fetchFn: typeof fetch): Promise<Response | null> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  try {
    return await fetchFn(url, { signal: c.signal, headers: { 'user-agent': 'FrancePassoireVeille/1.0 (+https://francepassoire.com)' } });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function texteXml(s: string): string {
  return s
    .replaceAll('<![CDATA[', '')
    .replaceAll(']]>', '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .trim();
}

async function googleNews(fetchFn: typeof fetch, requete: string): Promise<OccurrenceBrute[]> {
  const res = await aller(
    `https://news.google.com/rss/search?q=${encodeURIComponent(requete)}&hl=fr&gl=FR&ceid=FR:fr`,
    fetchFn,
  );
  if (!res || !res.ok) return [];
  const xml = await res.text();
  const items = xml.split('<item>').slice(1);
  return items.slice(0, 20).map((it) => {
    const titre = texteXml(extract(it, '<title>'));
    const lien = texteXml(extract(it, '<link>'));
    const date = texteXml(extract(it, '<pubDate>'));
    const source = texteXml(extract(it, '<source>'));
    return {
      plateforme: 'Google News',
      auteur: source || 'presse',
      texte: titre,
      url: lien,
      publie: date ? new Date(date).toISOString() : '',
    };
  });
}

async function bluesky(fetchFn: typeof fetch, requete: string): Promise<OccurrenceBrute[]> {
  const res = await aller(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(requete)}&limit=25`,
    fetchFn,
  );
  if (!res || !res.ok) return [];
  const json = (await res.json()) as { posts?: Array<{ author?: { handle?: string }; record?: { text?: string; createdAt?: string }; uri?: string }> };
  return (json.posts ?? []).map((p) => ({
    plateforme: 'Bluesky',
    auteur: p.author?.handle ?? '',
    texte: (p.record?.text ?? '').slice(0, 220),
    url: p.uri ? `https://bsky.app/profile/${p.author?.handle ?? ''}/post/${p.uri.split('/').pop()}` : '',
    publie: p.record?.createdAt ?? '',
  })).filter((o) => o.url !== '');
}

async function reddit(fetchFn: typeof fetch, requete: string): Promise<OccurrenceBrute[]> {
  const res = await aller(`https://www.reddit.com/search.rss?q=${encodeURIComponent(requete)}&limit=25`, fetchFn);
  if (!res || !res.ok) return [];
  const xml = await res.text();
  const items = xml.split('<entry>').slice(1);
  return items.slice(0, 20).map((it) => ({
    plateforme: 'Reddit',
    auteur: texteXml(extract(it, '<author>')) || 'reddit',
    texte: texteXml(extract(it, '<title>')),
    url: texteXml(extract(it, '<link href="')),
    publie: '',
  })).filter((o) => o.url !== '');
}

async function mastodon(fetchFn: typeof fetch, requete: string): Promise<OccurrenceBrute[]> {
  const res = await aller(
    `https://mastodon.social/api/v2/search?q=${encodeURIComponent(requete)}&type=statuses&resolve=false&limit=20`,
    fetchFn,
  );
  if (!res || !res.ok) return [];
  const json = (await res.json()) as { statuses?: Array<{ account?: { acct?: string }; content?: string; url?: string; created_at?: string }> };
  return (json.statuses ?? []).map((s) => ({
    plateforme: 'Mastodon',
    auteur: s.account?.acct ?? '',
    texte: texteXml((s.content ?? '').replace(/<[^>]+>/g, '')).slice(0, 220),
    url: s.url ?? '',
    publie: s.created_at ?? '',
  })).filter((o) => o.url !== '');
}

function extract(hay: string, tag: string): string {
  const i = hay.indexOf(tag);
  if (i === -1) return '';
  const fin = tag === '<link href="' ? hay.indexOf('"', i + tag.length) : hay.indexOf(tag.replace('<', '</'), i);
  if (fin === -1) return '';
  return hay.slice(i + tag.length, fin);
}

/** Variante de réponse suggérée — taxonomie 8 variantes (docs/social-setup.md à documenter). */
function varianteReponse(o: OccurrenceBrute, catalogue: Set<string>): string {
  const t = o.texte.toLowerCase();
  const mention = t.includes('francepassoire') || t.includes('france passoire');
  const entite = [...catalogue].find((e) => e.length > 3 && t.includes(e.toLowerCase()));
  if (mention && t.includes('merci')) return 'V1-remerciement';
  if (mention && (t.includes('?') || t.includes('comment'))) return 'V2-reponse-technique';
  if (mention) return 'V3-partage-fiche';
  if (entite) return 'V4-fiche-entite';
  if (t.includes('cyberattaque') || t.includes('fuite de données')) return 'V5-contexte-general';
  if (t.includes('ransomware')) return 'V6-angle-ransomware';
  if (t.includes('cnil')) return 'V7-angle-sanction';
  return 'V8-veille';
}

function scoreOccurrence(o: OccurrenceBrute, catalogue: Set<string>): number {
  const t = o.texte.toLowerCase();
  let s = 1;
  if (t.includes('francepassoire') || t.includes('france passoire')) s += 10;
  const entite = [...catalogue].find((e) => e.length > 3 && t.includes(e.toLowerCase()));
  if (entite) s += 5;
  if (t.includes('fuite de données') || t.includes('cyberattaque') || t.includes('ransomware')) s += 2;
  if (o.plateforme === 'Bluesky' || o.plateforme === 'Mastodon') s += 1;
  return s;
}

function normaliserTitre(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9à-öø-ÿ ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export async function runVeilleSociale(
  env: Env,
  slot: 'matin' | 'soir',
  options: { fetchFn?: typeof fetch; now?: Date; log?: (...a: unknown[]) => void } = {},
): Promise<{ opportunities: number; envoye: boolean; sourcesMortes: string[] }> {
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? new Date();
  const log = options.log ?? console.log;

  if (!env.BREVO_API_KEY || !env.DB) {
    log('veille-sociale: secrets/bindings absents — sortie propre');
    return { opportunities: 0, envoye: false, sourcesMortes: [] };
  }

  const requete = '"FrancePassoire" OR "fuite de données" France cyberattaque';
  const sources: Array<[string, (f: typeof fetch, q: string) => Promise<OccurrenceBrute[]>]> = [
    ['Google News', googleNews],
    ['Bluesky', bluesky],
    ['Reddit', reddit],
    ['Mastodon', mastodon],
  ];
  const brutes: OccurrenceBrute[] = [];
  const mortes: string[] = [];
  await Promise.all(
    sources.map(async ([nom, fn]) => {
      const avant = brutes.length;
      try {
        const r = await fn(fetchFn, requete);
        r.forEach((o) => brutes.push(o));
        if (r.length === 0) mortes.push(nom);
      } catch {
        mortes.push(nom);
      }
      void avant;
    }),
  );

  // Correspondances catalogue (top entités pour le scoring) : catalogue public.
  let catalogue = new Set<string>();
  try {
    const res = await fetchFn('https://francepassoire.com/opendata/v1/fiches.json', {
      headers: { accept: 'application/json' },
    });
    if (res.ok) {
      const p = (await res.json()) as { fiches?: Array<{ entity: string }> };
      catalogue = new Set((p.fiches ?? []).map((f) => f.entity));
    }
  } catch {
    /* scoring dégradé sans catalogue */
  }

  // Dédup in-run : URL puis titre fuzzy.
  const vuesUrl = new Set<string>();
  const vuesTitre = new Set<string>();
  const uniques: OccurrenceBrute[] = [];
  for (const o of brutes) {
    const cle = o.url.toLowerCase().split('?')[0]!;
    if (vuesUrl.has(cle)) continue;
    const titre = normaliserTitre(o.texte);
    if (titre && vuesTitre.has(titre)) continue;
    vuesUrl.add(cle);
    if (titre) vuesTitre.add(titre);
    uniques.push(o);
  }

  // Dédup persistant D1 + persistance des vues nouvelles.
  const nouvelles: OccurrenceBrute[] = [];
  for (const o of uniques) {
    const h = await hashUrlV(o.url);
    const stmtV = env.DB.prepare('SELECT 1 AS x FROM veille_seen WHERE url_hash = ?').bind(h);
    const deja = stmtV.first ? await stmtV.first() : null;
    if (!deja) {
      nouvelles.push(o);
      await env.DB.prepare('INSERT OR IGNORE INTO veille_seen (url_hash, first_seen) VALUES (?, ?)')
        .bind(h, now.toISOString())
        .run();
    }
  }

  const classees: Occurrence[] = nouvelles
    .map((o) => ({ ...o, score: scoreOccurrence(o, catalogue) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, VEILLE_CAP);

  const dateFr = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full' }).format(now);
  const dest = env.VEILLE_SOCIALE_DEST ?? DESTINATAIRE_PAR_DEFAUT;

  const envoyer = async (subject: string, html: string, text: string): Promise<boolean> => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), TIMEOUT_MS);
    try {
      const res = await fetchFn('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY!, 'content-type': 'application/json' },
        body: JSON.stringify({
          sender: { name: 'France Passoire', email: 'alerte@francepassoire.com' },
          to: [{ email: dest }],
          subject,
          htmlContent: html,
          textContent: text,
        }),
        signal: c.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  };

  if (classees.length === 0) {
    const ok = await envoyer(
      `Veille sociale ${slot} — la passoire est calme (${dateFr})`,
      renderVeilleHtml([], { slot, dateFr, mortes, catalogue }),
      `Rien à signaler ce slot : la passoire est calme.\nSources mortes : ${mortes.join(', ') || 'aucune'}\nGérer les sources : https://francepassoire.com/methode/`,
    );
    log(`veille-sociale: heartbeat ${slot} envoyé=${ok}`);
    return { opportunities: 0, envoye: ok, sourcesMortes: mortes };
  }

  const ok = await envoyer(
    `Veille sociale ${slot} — ${classees.length} opportunité(s) (${dateFr})`,
    renderVeilleHtml(classees, { slot, dateFr, mortes, catalogue }),
    renderVeilleText(classees, { slot, dateFr }),
  );
  log(`veille-sociale: ${classees.length} opportunité(s), email=${ok}`);
  return { opportunities: classees.length, envoye: ok, sourcesMortes: mortes };
}

function pillPlateforme(p: string): string {
  const couleurs: Record<string, string> = {
    'Google News': '#241405',
    Bluesky: '#1d9bf0',
    Reddit: '#ff4500',
    Mastodon: '#6364ff',
  };
  return `<span style="font-family:'Courier New',monospace;font-size:11px;padding:2px 8px;border-radius:12px;color:#fff;background-color:${couleurs[p] ?? '#241405'};font-weight:bold;">${p}</span>`;
}

/** Expansion du gabarit ALERTE propriétaire : bandeau conservé, cartes = opportunités. */
function renderVeilleHtml(occ: Occurrence[], ctx: { slot: string; dateFr: string; mortes: string[]; catalogue: Set<string> }): string {
  const cartes = occ
    .map(
      (o) => `              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;background-color:#FFF9F2;border:3px solid #241405;border-radius:12px;box-shadow:4px 4px 0px 0px #241405;">
                <tr><td style="padding:18px 22px;">
                  <p style="margin:0 0 8px;">${pillPlateforme(o.plateforme)} <span style="font-family:'Courier New',monospace;font-size:12px;color:#6b5b45;">${o.auteur.slice(0, 40)}</span></p>
                  <p style="margin:0 0 10px;font-size:15px;line-height:1.5;">${o.texte.slice(0, 180)}</p>
                  <p style="margin:0;font-size:13px;"><a href="${o.url}" style="color:#E85A0C;font-weight:bold;">Ouvrir le contexte &rarr;</a> <span style="font-family:'Courier New',monospace;font-size:11px;color:#6b5b45;">variante suggérée : ${varianteReponse(o, ctx.catalogue)}</span></p>
                </td></tr>
              </table>`,
    )
    .join('\n');
  const alerte = occ.length === 0 ? 'LA PASSOIRE EST CALME' : `${occ.length} OPPORTUNITÉ(S)`;
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Veille sociale ${ctx.slot}</title></head>
<body style="margin:0;padding:0;background-color:#FFF9F2;font-family:Arial,Helvetica,sans-serif;color:#241405;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF9F2;padding:40px 16px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#FFF6EA;border:3px solid #241405;border-radius:20px;box-shadow:6px 6px 0px 0px #241405;overflow:hidden;">
      <tr><td style="background-color:#FF6B1A;background-image:radial-gradient(circle,#241405 1.5px,transparent 1.5px);background-size:22px 22px;border-bottom:3px solid #241405;padding:28px;text-align:center;">
        <p style="margin:0;font-family:'Arial Black',Impact,sans-serif;font-size:24px;font-weight:900;color:#fff;letter-spacing:-1px;text-transform:uppercase;">VEILLE SOCIALE</p>
        <p style="margin:8px 0 0;font-family:'Courier New',monospace;font-size:13px;font-weight:bold;color:#241405;background-color:#FFF6EA;display:inline-block;padding:4px 12px;border:2px solid #241405;border-radius:50px;">${ctx.slot.toUpperCase()} &middot; ${ctx.dateFr}</p>
        <p style="margin:8px 0 0;font-family:'Courier New',monospace;font-size:12px;color:#fff;">${alerte}</p>
      </td></tr>
      <tr><td style="padding:32px 28px 16px;font-size:15px;line-height:1.6;">
${cartes || '<p style="margin:0 0 20px;">Rien à signaler ce slot : la passoire est calme.</p>'}
        ${ctx.mortes.length > 0 ? `<p style="margin:12px 0 0;font-family:'Courier New',monospace;font-size:12px;color:#6b5b45;">Sources indisponibles ce slot : ${ctx.mortes.join(', ')}</p>` : ''}
      </td></tr>
      <tr><td style="padding:20px 28px;background-color:#241405;color:#FFF6EA;border-top:3px solid #241405;">
        <p style="margin:0;font-family:'Courier New',monospace;font-size:12px;line-height:1.5;">
          Email interne FrancePassoire &middot; <a href="https://francepassoire.com/methode/" style="color:#FF6B1A;font-weight:bold;text-decoration:underline;">gérer les sources</a>
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function renderVeilleText(occ: Occurrence[], ctx: { slot: string; dateFr: string }): string {
  const lignes = occ.map((o) => `- [${o.plateforme}] ${o.auteur.slice(0, 30)} : ${o.texte.slice(0, 100)} ${o.url}`);
  return [`Veille sociale ${ctx.slot} — ${ctx.dateFr}`, '', ...(lignes.length > 0 ? lignes : ['Rien à signaler : la passoire est calme.'])].join('\n');
}

export const __test = { scoreOccurrence, normaliserTitre, varianteReponse, hashUrlV, extract, slotVeilleSociale };
