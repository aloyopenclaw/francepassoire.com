// workers/ingest/adapters/cert-fr.ts — flux RSS CERT-FR/ANSSI (T16, Wave 2).
//
// URLs vérifiées en live le 2026-08-20 :
//   - avis + bulletins d'actualité : https://www.cert.ssi.gouv.fr/feed/ (200 direct)
//   - alertes : https://www.cert.ssi.gouv.fr/alerte/feed/ (200)
//     ⚠ le pluriel /alertes/feed/ (et /alertes/) répond 404 : le CERT-FR nomme
//     ses sections au singulier (/avis/, /alerte/), cf. menu de cert.ssi.gouv.fr.
//
// Ces bulletins de vulnérabilités sont des événements de CONTEXTE, rarement
// des candidats-fiches : entity_name reste null sauf si une organisation
// clairement nommée (forme juridique française explicite : SAS, SARL, SA…)
// figure dans le titre — au moindre doute, null (heuristique conservatrice,
// alignée sur T15). raw = métadonnées publiques de l'item (jamais de données
// personnelles de victimes, invariant du contrat adapter.ts).
//
// Parsing RSS 2.0 par regex minimale (zéro dépendance) : les flux CERT-FR
// sont des RSS WordPress plats (title/link/description/guid/pubDate, sans
// CDATA). Limites documentées : tout écart de markup (flux tronqué, page
// HTML) => [] + console.warn, jamais d'exception. Chaque item sans <link>
// ni <guid> est ignoré.

import type { Candidate, SourceAdapter } from '../src/adapter';

export const CERTFR_AVIS_URL = 'https://www.cert.ssi.gouv.fr/feed/';
export const CERTFR_ALERTES_URL = 'https://www.cert.ssi.gouv.fr/alerte/feed/';

/** Source commune des candidats CERT-FR (les ids d'adapter restent distincts). */
const SOURCE = 'cert-fr';

/** Décodage minimal des entités HTML/XML présentes dans les flux CERT-FR. */
function decoderEntites(texte: string): string {
  return texte
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Heuristique conservatrice : une organisation n'est extraite que si une forme
 * juridique française explicite suit un nom propre dans le titre.
 * « Vulnérabilité dans OpenSSL » → null (nom de produit, pas d'organisation).
 */
const ORGANISATION_NOMMEE =
  /\b([A-ZÉÈÊÀÇÎÔ][\p{L}'’-]*(?:\s+[A-ZÉÈÊÀÇÎÔ][\p{L}'’-]*){0,3})\s+(SASU|SAS|SARL|EURL|SNC|GIE|SA)\b/u;

function extraireOrganisation(titre: string): string | null {
  const match = ORGANISATION_NOMMEE.exec(titre);
  return match ? decoderEntites(`${match[1]} ${match[2]}`) : null;
}

interface ItemBrut {
  titre: string;
  lien: string | null;
  guid: string | null;
  description: string;
  pubDate: string;
}

/** Extrait les champs d'un <item> ; retourne null si l'item est inutilisable. */
function parserItem(bloc: string): ItemBrut | null {
  const champ = (nom: string): string => {
    const match = new RegExp(`<${nom}[^>]*>([\\s\\S]*?)</${nom}>`, 'i').exec(bloc);
    return match ? decoderEntites(match[1] ?? '').trim() : '';
  };
  const titre = champ('title');
  const lien = champ('link');
  const guid = champ('guid');
  // Sans lien ni guid, le candidat ne peut pas être rattaché à sa source.
  if (titre === '' || (lien === '' && guid === '')) return null;
  return {
    titre,
    lien: lien || null,
    guid: guid || null,
    description: champ('description'),
    pubDate: champ('pubDate'),
  };
}

/**
 * Parse un corps RSS CERT-FR en candidats de contexte. Pur et total :
 * markup non reconnu ou items illisibles => [] + console.warn.
 */
export function parserFluxCertFr(xml: string, flux: 'avis' | 'alertes'): Candidate[] {
  if (!/<rss[\s>]/i.test(xml)) {
    console.warn(`[cert-fr-${flux}] corps non reconnu comme RSS — flux ignoré`, xml.slice(0, 80));
    return [];
  }
  const blocs = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  if (blocs.length === 0 && /<item[\s>]/.test(xml)) {
    console.warn(`[cert-fr-${flux}] items présents mais illisibles (XML tronqué ?) — flux ignoré`);
    return [];
  }

  const candidats: Candidate[] = [];
  for (const bloc of blocs) {
    const item = parserItem(bloc);
    if (item === null) continue;
    candidats.push({
      source: SOURCE,
      source_url: item.lien ?? item.guid,
      entity_name: extraireOrganisation(item.titre),
      raw: JSON.stringify({
        flux,
        titre: item.titre,
        lien: item.lien,
        guid: item.guid,
        description: item.description,
        pubDate: item.pubDate,
      }),
    });
  }
  return candidats;
}

/** Fabrique d'adapter pour un flux CERT-FR (fetch injecté, contrat T13). */
function adapterCertFr(id: string, url: string, flux: 'avis' | 'alertes'): SourceAdapter {
  return {
    id,
    async fetchCandidates(fetchFn) {
      const response = await fetchFn(url);
      if (!response.ok) {
        console.warn(`[cert-fr-${flux}] HTTP ${response.status} sur ${url} — run ignoré`, id);
        return [];
      }
      return parserFluxCertFr(await response.text(), flux);
    },
  };
}

export const certFrAvisAdapter: SourceAdapter = adapterCertFr(
  'cert-fr-avis',
  CERTFR_AVIS_URL,
  'avis',
);

export const certFrAlertesAdapter: SourceAdapter = adapterCertFr(
  'cert-fr-alertes',
  CERTFR_ALERTES_URL,
  'alertes',
);
