// workers/ingest/adapters/cnil.ts — sanctions CNIL (HTML) + stats data.gouv (CSV) (T16, Wave 2).
//
// URLs vérifiées en live le 2026-08-20 :
//   - sanctions : https://www.cnil.fr/fr/les-sanctions-prononcees-par-la-cnil
//     ⚠ l'ancienne page /fr/sanctions répond 404 (restructuration du site
//     CNIL) ; la page courante publie 16 tableaux annuels (2017 → 2026) :
//     4 colonnes « Date | Type d'organisme | Manquements / Thèmes | Décision
//     adoptée » (et 5 colonnes avec thème séparé pour les années ≤ 2017),
//     chaque décision pointant vers Légifrance.
//   - stats : jeu de données data.gouv 5cd42a86634f4147a23df1be
//     « Notifications à la CNIL de violations de données à caractère
//     personnel » (slug : notifications-a-la-cnil-de-violations-de-donnees-
//     a-caractere-personnel). Le nom de la ressource CSV est daté
//     (…-20251231.csv) : l'adapter résout donc l'URL via l'API datasets
//     plutôt qu'une URL statique figée. Encodage du CSV : Windows-1252
//     (décodé via TextDecoder), séparateur « ; », guillemets doubles,
//     apostrophes échappées « '' » (artefact d'export SQL).
//
// LIMITE DE CADENCE — max 1 run/jour contre cnil.fr (CNIL_MAX_RUNS_PER_DAY).
// L'adapter est PUR : il reçoit le HTML/CSV déjà fetché, ne lit ni KV ni
// horloge. C'est le runner (T19) qui DOIT appeler isDailyRateOk(last_run,
// now) avant chaque fetch et stocker last_run dans le KV RUN_STATE (clé
// ingest:state:<id>), conformément au contrat de index.ts.
//
// Parsing par regex minimale (zéro dépendance), limites documentées :
// markup modifié, CSV sans en-tête ou lignes invalides => [] (ou lignes
// ignorées) + console.warn, jamais d'exception. Les stats trimestrielles ne
// sont PAS des candidats (elles alimenteront /chiffres en T36).
//
// DÉDUP GUID — mirroir du pattern knownGuids de rss.ts : chaque ligne de
// sanction reçoit un guid stable (jointure déterministe de toutes les
// colonnes, cf. guidSanction) embarqué dans raw, et
// fetchCandidates(fetchFn, knownGuids?) filtre les guids déjà vus. Les
// lignes strictement identiques au sein d'une même page sont aussi dédupées.
// C'est le runner (T19) qui câble le guid_set persisté en KV
// (ingest:state:<id>) — l'adapter ne touche ni D1 ni KV. Sans ce filtre,
// chaque pass re-insérait les sanctions identiques (constat du soak :
// ~790 doublons/heure).

import type { Candidate, SourceAdapter } from '../src/adapter';

export const CNIL_SANCTIONS_URL = 'https://www.cnil.fr/fr/les-sanctions-prononcees-par-la-cnil';
export const CNIL_DATASET_API_URL =
  'https://www.data.gouv.fr/api/1/datasets/5cd42a86634f4147a23df1be/';

/** Cadence maximale autorisée contre cnil.fr — à faire respecter par le runner (T19). */
export const CNIL_MAX_RUNS_PER_DAY = 1;

/** Source des candidats sanctions (décisions de formation restreinte). */
const SOURCE_SANCTIONS = 'cnil-sanctions';

/**
 * Garde-pure de cadence : true si un run est autorisé (pas encore exécuté
 * aujourd'hui en UTC, ou état absent/illisible), false sinon.
 */
export function isDailyRateOk(lastRunIso: string | null, now: Date): boolean {
  if (lastRunIso === null) return true;
  const dernier = new Date(lastRunIso);
  if (Number.isNaN(dernier.getTime())) return true; // état illisible : on ne bloque pas
  return (
    dernier.getUTCFullYear() !== now.getUTCFullYear() ||
    dernier.getUTCMonth() !== now.getUTCMonth() ||
    dernier.getUTCDate() !== now.getUTCDate()
  );
}

// ─── Helpers HTML (mini-doublon volontaire de cert-fr.ts : pas de fichier
// ─── partagé, la voie étant réservée aux seuls adapters de cette tâche).

function decoderEntites(texte: string): string {
  return texte
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const texteCellule = (html: string): string =>
  decoderEntites(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Cellule « manquements » : une entrée par paragraphe <p>, sinon le texte entier. */
function extraireManquements(html: string): string[] {
  const paragraphes = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi);
  if (paragraphes === null) {
    const texte = texteCellule(html);
    return texte === '' ? [] : [texte];
  }
  return paragraphes.map(texteCellule).filter((t) => t !== '');
}

interface SanctionBrute {
  guid: string;
  date: string;
  organisme: string;
  manquements: string[];
  decision: string;
  url_decision: string | null;
  theme?: string;
}

/**
 * Guid stable d'une ligne de sanction : jointure déterministe de TOUTES les
 * colonnes (date ⊕ organisme ⊕ URL de décision ⊕ décision ⊕ manquements ⊕
 * thème). La jointure réduite date ⊕ organisme ⊕ URL collisionne sur la page
 * réelle (vérifié 2026-08-20 : deux sanctions du même organisme, même date,
 * même décision Légifrance mais manquements distincts). Séparateur \u0000
 * absent du contenu HTML décodé — pas de collision de jointure possible.
 * Même règle de clé que parseCnilStats (trimestre ⊕ secteur).
 */
export function guidSanction(sanction: SanctionBrute): string {
  return [
    sanction.date,
    sanction.organisme,
    sanction.url_decision ?? '',
    sanction.decision,
    sanction.manquements.join('\u0001'),
    sanction.theme ?? '',
  ].join('\u0000');
}

/**
 * Parse les tableaux annuels de sanctions depuis le HTML de la page CNIL.
 * Pur : markup méconnaissable => [] + console.warn, jamais d'exception.
 *
 * @param knownGuids Optionnel : guids déjà vus (guid_set KV câblé par le
 *        runner) — les lignes correspondantes sont filtrées. Le warn « 0
 *        sanction parsée » ne se déclenche que si la page elle-même est
 *        illisible, pas si toutes les lignes sont déjà connues.
 */
export function parseCnilSanctions(html: string, knownGuids?: Set<string>): Candidate[] {
  const candidats: Candidate[] = [];
  let lignesValides = 0;
  const vus = new Set<string>();
  const tableaux = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) ?? [];

  for (const tableau of tableaux) {
    const lignes = tableau.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
    for (const ligne of lignes) {
      const cellules = ligne.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? [];
      if (cellules.length !== 4 && cellules.length !== 5) continue; // en-tête <th> ou format inconnu

      const date = texteCellule(cellules[0] ?? '');
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) continue;

      const legacy = cellules.length === 5;
      const organisme = texteCellule(cellules[1] ?? '');
      const celluleManquements = legacy ? cellules[3] : cellules[2];
      const celluleDecision = legacy ? cellules[4] : cellules[3];
      if (organisme === '' || celluleDecision === undefined) continue;

      const lienDecision = /href="([^"]+)"/.exec(celluleDecision);
      const sanction: SanctionBrute = {
        guid: '',
        date,
        organisme,
        manquements: extraireManquements(celluleManquements ?? ''),
        decision: texteCellule(celluleDecision),
        url_decision: lienDecision ? decoderEntites(lienDecision[1] ?? '') : null,
      };
      if (legacy) sanction.theme = texteCellule(cellules[2] ?? '');
      sanction.guid = guidSanction(sanction);

      lignesValides++;
      // dédup intra-page : 5 lignes strictement identiques existent dans la
      // page réelle (vérifié à la main sur la fixture) — aucun champ ne les
      // distingue, donc un seul candidat.
      if (vus.has(sanction.guid)) continue;
      vus.add(sanction.guid);
      if (knownGuids?.has(sanction.guid)) continue;

      candidats.push({
        source: SOURCE_SANCTIONS,
        source_url: sanction.url_decision,
        entity_name: organisme,
        raw: JSON.stringify(sanction),
      });
    }
  }

  if (lignesValides === 0) {
    console.warn(
      '[cnil-sanctions] 0 sanction parsée — markup CNIL probablement modifié, à ré-inspecter',
      CNIL_SANCTIONS_URL,
    );
    return [];
  }
  return candidats;
}

/** SourceAdapter + dédup guid optionnelle (même contrat que RssAdapter). */
export interface CnilSanctionsAdapter extends SourceAdapter {
  fetchCandidates(fetchFn: typeof fetch, knownGuids?: Set<string>): Promise<Candidate[]>;
}

export const cnilSanctionsAdapter: CnilSanctionsAdapter = {
  id: 'cnil-sanctions',
  /**
   * @param knownGuids Optionnel : guids déjà vus (guid_set KV câblé par le
   *        runner) — les sanctions correspondantes sont filtrées.
   */
  async fetchCandidates(fetchFn, knownGuids?) {
    // ⚠ Le runner (T19) doit garantir CNIL_MAX_RUNS_PER_DAY via isDailyRateOk.
    const response = await fetchFn(CNIL_SANCTIONS_URL);
    if (!response.ok) {
      console.warn(`[cnil-sanctions] HTTP ${response.status} — run ignoré`, CNIL_SANCTIONS_URL);
      return [];
    }
    return parseCnilSanctions(await response.text(), knownGuids);
  },
};

// ─── Stats trimestrielles data.gouv (CSV Windows-1252).

/** Ligne de statistiques trimestrielles : nombre de violations notifiées par secteur. */
export interface StatRow {
  /** Trimestre ISO court « 2025-T4 » (les données CNIL sont ventilées par mois). */
  trimestre: string;
  /** Secteur d'activité de l'organisme concerné (colonne CNIL). */
  secteur: string;
  /** Nombre de violations notifiées sur ce trimestre × secteur. */
  violations_notifiees: number;
}

/** Découpe une ligne CSV « ; » en gérant les champs entre guillemets (avec « ; » internes). */
function decouperLigneCsv(ligne: string): string[] {
  const champs: string[] = [];
  let courant = '';
  let entreGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const caractere = ligne[i];
    if (caractere === '"') {
      if (entreGuillemets && ligne[i + 1] === '"') {
        courant += '"';
        i += 1; // guillemet échappé « "" »
      } else {
        entreGuillemets = !entreGuillemets;
      }
    } else if (caractere === ';' && !entreGuillemets) {
      champs.push(courant);
      courant = '';
    } else {
      courant += caractere;
    }
  }
  champs.push(courant);
  return champs;
}

const MOIS_VALIDE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Parse le CSV OpenCNIL des violations notifiées et agrège par trimestre ×
 * secteur. Pure : sans en-tête reconnu => [] + console.warn ; les lignes de
 * données invalides sont ignorées. Limite documentée : pas de champs CSV
 * multi-lignes (absents du fichier réel vérifié le 2026-08-20).
 */
export function parseCnilStats(csv: string): StatRow[] {
  const lignes = csv.split('\n').map((l) => l.replace(/\r$/, ''));

  const indexEnTete = lignes.findIndex(
    (l) => decouperLigneCsv(l)[0]?.trim() === 'Date de réception de la notification',
  );
  if (indexEnTete === -1) {
    console.warn('[cnil-datagouv-stats] en-tête CNIL introuvable dans le CSV — parsing ignoré');
    return [];
  }

  const agregats = new Map<string, number>();
  for (const ligne of lignes.slice(indexEnTete + 1)) {
    if (ligne.trim() === '') continue;
    const champs = decouperLigneCsv(ligne);
    const mois = MOIS_VALIDE.exec(champs[0]?.trim() ?? '');
    const secteur = (champs[1] ?? '').replace(/''/g, "'").trim();
    if (mois === null || secteur === '') continue;

    const annee = mois[1] ?? '';
    const numero = parseInt(mois[2] ?? '1', 10);
    const trimestre = `${annee}-T${Math.floor((numero - 1) / 3) + 1}`;
    const cle = `${trimestre}\u0000${secteur}`;
    agregats.set(cle, (agregats.get(cle) ?? 0) + 1);
  }

  return [...agregats.entries()]
    .map(([cle, violations_notifiees]) => {
      const [trimestre, secteur] = cle.split('\u0000');
      return { trimestre: trimestre ?? '', secteur: secteur ?? '', violations_notifiees };
    })
    .sort((a, b) => (a.trimestre === b.trimestre ? a.secteur.localeCompare(b.secteur) : a.trimestre.localeCompare(b.trimestre)));
}

interface RessourceDataGouv {
  title?: string;
  format?: string;
  url?: string;
}

/**
 * Adapter stats data.gouv : résout la ressource CSV courante via l'API
 * datasets (le nom de fichier est daté), la décode en Windows-1252 et
 * agrège les stats. Ne produit AUCUN candidat — les violations notifiées
 * sont des statistiques agrégées destinées à /chiffres (câblage en T36).
 */
export const cnilDataGouvAdapter: SourceAdapter = {
  id: 'cnil-datagouv-stats',
  async fetchCandidates(fetchFn) {
    const reponseApi = await fetchFn(CNIL_DATASET_API_URL);
    if (!reponseApi.ok) {
      console.warn(
        `[cnil-datagouv-stats] HTTP ${reponseApi.status} sur l'API datasets — run ignoré`,
        CNIL_DATASET_API_URL,
      );
      return [];
    }
    const dataset = (await reponseApi.json()) as { resources?: RessourceDataGouv[] };
    const ressourceCsv = (dataset.resources ?? []).find(
      (r) => r.format?.toLowerCase() === 'csv' || /\.csv$/i.test(r.title ?? ''),
    );
    if (ressourceCsv?.url === undefined) {
      console.warn('[cnil-datagouv-stats] aucune ressource CSV dans le jeu de données');
      return [];
    }

    const reponseCsv = await fetchFn(ressourceCsv.url);
    if (!reponseCsv.ok) {
      console.warn(
        `[cnil-datagouv-stats] HTTP ${reponseCsv.status} sur le CSV — run ignoré`,
        ressourceCsv.url,
      );
      return [];
    }
    // Le CSV OpenCNIL est encodé Windows-1252, pas UTF-8 (vérifié en live).
    const csv = new TextDecoder('windows-1252').decode(
      new Uint8Array(await reponseCsv.arrayBuffer()),
    );
    const stats = parseCnilStats(csv);
    console.log(
      `[cnil-datagouv-stats] ${stats.length} lignes de stats trimestre × secteur extraites (pas des candidats — câblage /chiffres en T36)`,
    );
    return [];
  },
};
