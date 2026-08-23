// workers/api/src/rapport-quotidien.ts — rapport pipeline quotidien du
// propriétaire (email interne 10:00 Paris) + tripwire fiches.json.
//
// Contexte (incident 22/08) : un 404 sur fiches.json a rendu le moteur
// d'alertes silencieux pendant environ 24 h sans qu'aucune surface unique
// ne le montre. Ce module donne au propriétaire UN email quotidien qui
// aurait vu le trou, plus un tripwire quart d'heure qui l'annonce en
// direct.
//
// 1. RAPPORT QUOTIDIEN (runRapportQuotidien) : troisième porte pliée dans
//    le cron « */15 » EXISTANT du worker api (plafond gratuit : 5
//    déclencheurs/compte, tous consommés — aucun nouveau déclencheur).
//    Toute heure 10 Europe/Paris, week-ends inclus (une passoire ne prend
//    pas de vacances). Garde KV « rapport:jour:<AAAAMMJJ Paris> » posée
//    AVANT l'envoi (convention queue-watchdog : un échec réseau ne
//    re-déclenche pas au tick suivant ; le lendemain réessaie).
//    Sections, toutes en français et sans em-dash (règle maison verrouillée
//    par test) :
//      a. Candidats 24 h : compteurs NEW/DRAFT/PUBLISHED/REJECTED (D1,
//         created_at >= now-24 h) + 5 noms d'entités NEW max ;
//      b. Sources : états KV ingest:state:* (dernier succès ISO, échecs
//         consécutifs — écrits par workers/ingest) + drapeaux
//         source_dead:* {since, reason} ; dernier succès vieux de plus de
//         6 h = rouge (gras + ⚠️) ;
//      c. Workflows GitHub : dernière conclusion par workflow surveillé.
//         Dépôt privé : sans jeton l'API répond 404 ; on DÉGRADE
//         honnêtement (« non vérifiables sans jeton »), jamais de crash,
//         jamais de point rouge sur du non-vérifié ;
//      d. Catalogue : GET fiches.json (no-store, délai 10 s) : compte +
//         generated_at. Un non-200 est du CONTENU rouge criant (la classe
//         d'incident qui a motivé ce rapport), pas un échec d'envoi ;
//      e. Abonnés : total + confirmés (D1).
//    Verdict en une ligne : pastille verte « PIPELINE OK » ou rouge
//    « ANOMALIE (n) ». n = points rouges VISIBLES : sources muettes (+6 h),
//    drapeaux sources mortes, workflows en échec (si vérifiables), catalogue
//    injoignable. Sujet : « Rapport pipeline · <verdict> · <date fr> »
//    (≤ 60 caractères).
//
// 2. TRIPWIRE FICHES.JSON (gererFichesMortes) : à chaque tick */15, si le
//    balayage immédiat (runInstantSweep) rapporte « fiches-indisponibles »,
//    le compteur KV watchlist:fiches-mortes:compteur (sans TTL) monte de 1.
//    À 4 échecs consécutifs (≈ 1 h de panne continue au rythme */15) :
//    UNE alerte Brevo par jour (garde KV, convention queue-watchdog), « le
//    catalogue est injoignable depuis ≥ 1 h ». Tout balayage qui a su lire
//    le catalogue remet le compteur à zéro ; un balayage qui n'a rien pu
//    vérifier (secrets absents, binding absent) n'y touche pas : ni
//    incrément, ni amnésie.
//
// Testabilité : fetch injectable et borné (10 s, AbortController),
// horloge injectable, D1/KV structurels (node:sqlite / Map en vitest,
// mêmes approches que queue-watchdog et api-watchlist). Secrets absents :
// sortie propre, garde NON posée (mode détection seule), jamais de crash.

import { sendBrevoEmail, type InstantSweepResultats } from './watchlist';
import type { D1Database, D1PreparedStatement, Env, KVNamespace } from './index';

/** Seuil « source muette » : dernier succès vieux de plus de 6 h. */
export const SEUIL_SOURCE_H = 6;
/** Échecs consécutifs du balayage quart d'heure avant alerte (4 × 15 min = 1 h). */
export const SEUIL_FICHES_MORTES = 4;

const PREFIXE_GARDE_RAPPORT = 'rapport:jour:';
const PREFIXE_GARDE_FICHES = 'rapport:fiches-mortes:alerte:';
const CLE_COMPTEUR_FICHES = 'watchlist:fiches-mortes:compteur';

const FICHES_URL = 'https://francepassoire.com/opendata/v1/fiches.json';
const GITHUB_RUNS_URL =
  'https://api.github.com/repos/aloyopenclaw/francepassoire.com/actions/runs?per_page=15';

const DESTINATAIRE_PAR_DEFAUT = 'contact@francepassoire.com';
const TIMEOUT_MS = 10000;
const FENETRE_CANDIDATS_MS = 24 * 3600 * 1000;

/** Workflows du pipeline surveillés (dernière conclusion de chacun). */
const WORKFLOWS_SURVEILLES = [
  'gnews-vps.yml',
  'fb-vps.yml',
  'veille-sociale-vps.yml',
  'publish-catalog.yml',
  'agent-validate.yml',
] as const;

/** Conclusions qui comptent comme échec du pipeline (point rouge). */
const CONCLUSIONS_ROUGES: ReadonlySet<string> = new Set([
  'failure',
  'timed_out',
  'startup_failure',
]);

const LIBELLE_CONCLUSION: Readonly<Record<string, string>> = {
  success: 'succès',
  failure: 'échec',
  cancelled: 'annulé',
  timed_out: 'délai dépassé',
  startup_failure: 'échec au démarrage',
  skipped: 'ignoré',
  action_required: 'action requise',
  stale: 'périmé',
};

export interface RapportOptions {
  fetchFn?: typeof fetch;
  now?: Date;
  log?: (...args: unknown[]) => void;
}

export interface CompteursCandidats {
  NEW: number;
  DRAFT: number;
  PUBLISHED: number;
  REJECTED: number;
}

export interface EtatSource {
  nom: string;
  /** last_success brut (ISO) tel qu'écrit par workers/ingest ; null = jamais. */
  dernierSucces: string | null;
  /** Âge du dernier succès en heures ; null si inconnu/illisible. */
  ageH: number | null;
  echecsConsecutifs: number;
  /** true si dernier succès vieux de plus de SEUIL_SOURCE_H heures. */
  inquiete: boolean;
}

export interface DrapeauSourceMorte {
  nom: string;
  depuis: string;
  raison: string;
}

export interface EtatWorkflow {
  nom: string;
  conclusion: string | null;
  libelle: string;
  ageH: number | null;
  rouge: boolean;
}

export interface EtatCatalogue {
  ok: boolean;
  nbFiches: number | null;
  genereLe: string | null;
  /** « HTTP 404 », « délai dépassé »… : le pourquoi du rouge. */
  detail: string;
}

export interface DonneesRapport {
  candidats: CompteursCandidats;
  totalCandidats: number;
  nouveauxNoms: string[];
  sources: EtatSource[];
  drapeauxMorts: DrapeauSourceMorte[];
  /** false si le KV n'expose pas list (dégradation honnête, pas un rouge). */
  sourcesLisibles: boolean;
  workflows: { verifiables: boolean; etats: EtatWorkflow[] };
  catalogue: EtatCatalogue;
  abonnes: { total: number; confirmes: number };
  nbAnomalies: number;
}

export interface RapportVerdict {
  envoye: boolean;
  dejaEnvoye?: boolean;
  anomalies?: number;
  sujet?: string;
  raison?: string;
}

export interface FichesMortesVerdict {
  compteur: number;
  /** true si l'alerte du jour vient d'être envoyée. */
  alerte: boolean;
  dejaAlerte?: boolean;
  emailOk?: boolean | null;
}

// ---------------------------------------------------------------------------
// Portes et clés de garde (heures Paris via Intl, insensible au DST)
// ---------------------------------------------------------------------------

/** Heure 10 Europe/Paris (n'importe quel tick quart d'heure de l'heure), week-ends inclus. */
export function doitLancerRapport(now: Date): boolean {
  const heure = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    hour12: false,
  }).format(now);
  return /10/.test(heure);
}

/** Clé de garde du jour (date Europe/Paris, AAAAMMJJ — même convention que cleGardeFile). */
export function cleGardeRapport(maintenant: Date): string {
  return `${PREFIXE_GARDE_RAPPORT}${jourParis(maintenant)}`;
}

/** Clé de garde de l'alerte fiches mortes du jour. */
export function cleGardeFiches(maintenant: Date): string {
  return `${PREFIXE_GARDE_FICHES}${jourParis(maintenant)}`;
}

function jourParis(maintenant: Date): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(maintenant)
    .replaceAll('-', '');
}

// ---------------------------------------------------------------------------
// Helpers génériques
// ---------------------------------------------------------------------------

/** Règle maison verrouillée : aucun tiret cadratin (—) ni semi-cadratin (–)
 *  dans les rendus. Les données externes (noms d'entités, sources, raisons)
 *  peuvent en contenir : neutralisés en tiret simple à l'affichage. */
function sansTiretCadre(texte: string): string {
  return texte.replaceAll('—', '-').replaceAll('–', '-');
}

function escapeHtml(texte: string): string {
  return sansTiretCadre(texte)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** « 2026-08-23T08:00:30Z » → « 2026-08-23 08:00:30 » (format created_at SQLite, UTC). */
function formatSqlUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Date ISO ou SQLite UTC → epoch ms ; NaN si illisible. */
function versEpoch(valeur: string | null | undefined): number {
  if (!valeur) return Number.NaN;
  if (valeur.endsWith('Z') || valeur.includes('T')) return Date.parse(valeur);
  return Date.parse(`${valeur.replace(' ', 'T')}Z`);
}

/** « il y a 25 min » / « il y a 3 h » ; « ? » si indéterminé. */
function tempsRelatif(epochMs: number, maintenant: Date): string {
  if (Number.isNaN(epochMs)) return '?';
  const minutes = Math.round(Math.max(0, maintenant.getTime() - epochMs) / 60000);
  if (minutes < 60) return `il y a ${minutes} min`;
  return `il y a ${Math.round(minutes / 60)} h`;
}

/** GET borné à TIMEOUT_MS : jamais de fetch qui pend le cron. */
async function fetchAvecDelai(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch,
): Promise<Response> {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_MS);
  try {
    return await fetchFn(url, { ...init, signal: controleur.signal });
  } finally {
    clearTimeout(minuteur);
  }
}

/** Normalisation all() : D1 réel renvoie {results}, la doublure de test un tableau nu. */
async function lignesD1(stmt: D1PreparedStatement): Promise<Record<string, unknown>[]> {
  if (!stmt.all) return [];
  const brut = (await stmt.all()) as unknown as
    | Record<string, unknown>[]
    | { results?: Record<string, unknown>[] };
  return Array.isArray(brut) ? brut : (brut.results ?? []);
}

// ---------------------------------------------------------------------------
// Collecte des sections (chacune non fatale pour les fetch ; D1/KV maison)
// ---------------------------------------------------------------------------

async function collecterCandidats(
  db: D1Database,
  maintenant: Date,
): Promise<{ compteurs: CompteursCandidats; total: number; nouveauxNoms: string[] }> {
  const cutoff = formatSqlUtc(new Date(maintenant.getTime() - FENETRE_CANDIDATS_MS));
  const lignes = await lignesD1(
    db
      .prepare(
        'SELECT status, COUNT(*) AS nb FROM candidates WHERE created_at >= ? GROUP BY status',
      )
      .bind(cutoff),
  );
  const compteurs: CompteursCandidats = { NEW: 0, DRAFT: 0, PUBLISHED: 0, REJECTED: 0 };
  let total = 0;
  for (const ligne of lignes) {
    const statut = String(ligne.status ?? '');
    const nb = Number(ligne.nb ?? 0);
    if (statut === 'NEW' || statut === 'DRAFT' || statut === 'PUBLISHED' || statut === 'REJECTED') {
      compteurs[statut] = nb;
      total += nb;
    }
  }
  const noms = await lignesD1(
    db
      .prepare(
        "SELECT entity_name FROM candidates WHERE status = 'NEW' AND created_at >= ? ORDER BY created_at DESC LIMIT 5",
      )
      .bind(cutoff),
  );
  const nouveauxNoms = noms
    .map((l) => (typeof l.entity_name === 'string' ? l.entity_name.trim() : ''))
    .filter((n) => n !== '');
  return { compteurs, total, nouveauxNoms };
}

interface FormeEtatIngest {
  last_success?: string | null;
  consecutive_failures?: number;
}

async function collecterSources(
  kv: KVNamespace,
  maintenant: Date,
): Promise<{ sources: EtatSource[]; drapeaux: DrapeauSourceMorte[]; lisibles: boolean }> {
  if (!kv.list) return { sources: [], drapeaux: [], lisibles: false };

  // Une seule page par préfixe : quelques dizaines de clés attendues, très
  // loin de la limite KV (1000/page).
  const listingEtats = await kv.list({ prefix: 'ingest:state:' });
  const sources: EtatSource[] = [];
  for (const cle of listingEtats.keys) {
    const nom = cle.name.replace('ingest:state:', '');
    let etat: FormeEtatIngest = {};
    try {
      etat = JSON.parse((await kv.get(cle.name)) ?? '{}') as FormeEtatIngest;
    } catch {
      etat = {};
    }
    const dernierSucces = typeof etat.last_success === 'string' ? etat.last_success : null;
    const epoch = versEpoch(dernierSucces);
    const ageH = Number.isNaN(epoch) ? null : (maintenant.getTime() - epoch) / 3600000;
    sources.push({
      nom,
      dernierSucces,
      ageH,
      echecsConsecutifs: Number(etat.consecutive_failures ?? 0),
      inquiete: ageH !== null && ageH > SEUIL_SOURCE_H,
    });
  }
  sources.sort((a, b) => a.nom.localeCompare(b.nom));

  const listingDrapeaux = await kv.list({ prefix: 'source_dead:' });
  const drapeaux: DrapeauSourceMorte[] = [];
  for (const cle of listingDrapeaux.keys) {
    let brut: { since?: unknown; reason?: unknown } = {};
    try {
      brut = JSON.parse((await kv.get(cle.name)) ?? '{}') as { since?: unknown; reason?: unknown };
    } catch {
      brut = {};
    }
    drapeaux.push({
      nom: cle.name.replace('source_dead:', ''),
      depuis: typeof brut.since === 'string' ? brut.since : '?',
      raison: typeof brut.reason === 'string' ? brut.reason : 'raison inconnue',
    });
  }
  drapeaux.sort((a, b) => a.nom.localeCompare(b.nom));
  return { sources, drapeaux, lisibles: true };
}

interface FormeRunGitHub {
  name?: string;
  conclusion?: string | null;
  created_at?: string;
}

async function collecterWorkflows(
  fetchFn: typeof fetch,
  maintenant: Date,
): Promise<{
  verifiables: boolean;
  etats: EtatWorkflow[];
}> {
  try {
    const res = await fetchAvecDelai(GITHUB_RUNS_URL, { headers: { accept: 'application/vnd.github+json' } }, fetchFn);
    if (!res.ok) return { verifiables: false, etats: [] };
    const payload = (await res.json()) as { workflow_runs?: FormeRunGitHub[] };
    const runs = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
    // L'API renvoie les runs les plus récents d'abord : première conclusion
    // non nulle rencontrée = dernier verdict connu du workflow.
    const dernieres = new Map<string, { conclusion: string; created_at?: string }>();
    const enCours = new Set<string>();
    for (const run of runs) {
      const nom = typeof run.name === 'string' ? run.name : '';
      if (nom === '' || dernieres.has(nom)) continue;
      if (run.conclusion) {
        dernieres.set(nom, { conclusion: run.conclusion, created_at: run.created_at });
      } else {
        enCours.add(nom);
      }
    }
    const etats: EtatWorkflow[] = WORKFLOWS_SURVEILLES.map((nom) => {
      const dernier = dernieres.get(nom);
      if (dernier) {
        const epoch = versEpoch(dernier.created_at);
        return {
          nom,
          conclusion: dernier.conclusion,
          libelle: LIBELLE_CONCLUSION[dernier.conclusion] ?? dernier.conclusion,
          ageH: Number.isNaN(epoch) ? null : (maintenant.getTime() - epoch) / 3600000,
          rouge: CONCLUSIONS_ROUGES.has(dernier.conclusion),
        };
      }
      return {
        nom,
        conclusion: null,
        libelle: enCours.has(nom) ? 'en cours' : 'aucun run visible',
        ageH: null,
        rouge: false,
      };
    });
    return { verifiables: true, etats };
  } catch {
    // Réseau, délai dépassé, JSON cassé : dégradation honnête, pas un rouge.
    return { verifiables: false, etats: [] };
  }
}

interface FormeFichesJson {
  count?: number;
  generated_at?: string;
  fiches?: unknown[];
}

async function collecterCatalogue(fetchFn: typeof fetch): Promise<EtatCatalogue> {
  try {
    const res = await fetchAvecDelai(
      FICHES_URL,
      { headers: { accept: 'application/json' }, cache: 'no-store' },
      fetchFn,
    );
    if (!res.ok) return { ok: false, nbFiches: null, genereLe: null, detail: `HTTP ${res.status}` };
    const payload = (await res.json()) as FormeFichesJson;
    const nbFiches =
      typeof payload.count === 'number'
        ? payload.count
        : Array.isArray(payload.fiches)
          ? payload.fiches.length
          : null;
    return {
      ok: true,
      nbFiches,
      genereLe: typeof payload.generated_at === 'string' ? payload.generated_at : null,
      detail: '',
    };
  } catch {
    return { ok: false, nbFiches: null, genereLe: null, detail: 'délai dépassé ou réseau' };
  }
}

async function collecterAbonnes(db: D1Database): Promise<{ total: number; confirmes: number }> {
  const stmt = db
    .prepare('SELECT COUNT(*) AS total, COUNT(confirmed_at) AS confirmes FROM subscribers')
    .bind();
  const ligne = (stmt.first ? await stmt.first() : null) as
    | { total?: number; confirmes?: number }
    | null;
  return { total: Number(ligne?.total ?? 0), confirmes: Number(ligne?.confirmes ?? 0) };
}

async function collecterRapport(
  env: Env,
  fetchFn: typeof fetch,
  maintenant: Date,
): Promise<DonneesRapport> {
  const candidats = await collecterCandidats(env.DB, maintenant);
  const sources = await collecterSources(env.RUN_STATE!, maintenant);
  const workflows = await collecterWorkflows(fetchFn, maintenant);
  const catalogue = await collecterCatalogue(fetchFn);
  const abonnes = await collecterAbonnes(env.DB);

  const nbAnomalies =
    (catalogue.ok ? 0 : 1) +
    sources.sources.filter((s) => s.inquiete).length +
    sources.drapeaux.length +
    (workflows.verifiables ? workflows.etats.filter((w) => w.rouge).length : 0);

  return {
    candidats: candidats.compteurs,
    totalCandidats: candidats.total,
    nouveauxNoms: candidats.nouveauxNoms,
    sources: sources.sources,
    drapeauxMorts: sources.drapeaux,
    sourcesLisibles: sources.lisibles,
    workflows,
    catalogue,
    abonnes,
    nbAnomalies,
  };
}

// ---------------------------------------------------------------------------
// Rendu (sujet, texte, HTML — palette maison, aucun em-dash)
// ---------------------------------------------------------------------------

/** « Rapport pipeline · PIPELINE OK|ANOMALIE (n) · JJ/MM/AAAA » (≤ 60 caractères). */
export function sujetRapport(nbAnomalies: number, maintenant: Date): string {
  const dateCourte = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(maintenant);
  const verdict = nbAnomalies === 0 ? 'PIPELINE OK' : `ANOMALIE (${nbAnomalies})`;
  return `Rapport pipeline · ${verdict} · ${dateCourte}`;
}

/** Résumé une ligne des points rouges (sections séparées par point médian). */
function resumeAnomalies(d: DonneesRapport): string {
  const parties: string[] = [];
  if (!d.catalogue.ok) parties.push('catalogue injoignable');
  const muettes = d.sources.filter((s) => s.inquiete).length;
  if (muettes > 0) parties.push(`${muettes} source${muettes > 1 ? 's' : ''} muette${muettes > 1 ? 's' : ''} (+${SEUIL_SOURCE_H} h)`);
  if (d.drapeauxMorts.length > 0) {
    parties.push(`${d.drapeauxMorts.length} drapeau${d.drapeauxMorts.length > 1 ? 'x' : ''} source morte`);
  }
  if (d.workflows.verifiables) {
    const echecs = d.workflows.etats.filter((w) => w.rouge).length;
    if (echecs > 0) parties.push(`${echecs} workflow${echecs > 1 ? 's' : ''} en échec`);
  }
  return parties.join(' · ');
}

function ligneSourceTexte(s: EtatSource): string {
  const succes =
    s.ageH === null || s.dernierSucces === null
      ? 'jamais réussi'
      : `dernier succès il y a ${Math.round(s.ageH)} h`;
  const corps = `${sansTiretCadre(s.nom)} : ${succes} · ${s.echecsConsecutifs} échec${s.echecsConsecutifs > 1 ? 's' : ''} de suite`;
  return s.inquiete ? `⚠️ ${corps} · MUETTE DEPUIS PLUS DE ${SEUIL_SOURCE_H} H` : corps;
}

function ligneWorkflowTexte(w: EtatWorkflow): string {
  const age = w.ageH === null ? '' : ` · il y a ${Math.round(w.ageH)} h`;
  const corps = `${sansTiretCadre(w.nom)} : ${sansTiretCadre(w.libelle)}${age}`;
  return w.rouge ? `⚠️ ${corps}` : corps;
}

export function rendreTexteRapport(d: DonneesRapport, maintenant: Date): string {
  const dateLongue = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(maintenant);
  const heure = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
  }).format(maintenant);
  const verdict =
    d.nbAnomalies === 0
      ? 'VERDICT : PIPELINE OK'
      : `VERDICT : ANOMALIE (${d.nbAnomalies} point${d.nbAnomalies > 1 ? 's' : ''} rouge${d.nbAnomalies > 1 ? 's' : ''})`;

  const lignes: string[] = [
    'FRANCEPASSOIRE · RAPPORT PIPELINE',
    `${dateLongue} · ${heure} Paris`,
    '',
    verdict,
    d.nbAnomalies === 0 ? 'Aucun point rouge ce jour.' : resumeAnomalies(d),
    '',
    'CANDIDATS 24 H',
  ];
  if (d.totalCandidats === 0) {
    lignes.push('aucun candidat ces 24 dernières heures');
  } else {
    const c = d.candidats;
    lignes.push(
      `NEW ${c.NEW} · DRAFT ${c.DRAFT} · PUBLISHED ${c.PUBLISHED} · REJECTED ${c.REJECTED} (total ${d.totalCandidats})`,
    );
    if (d.nouveauxNoms.length > 0) {
      lignes.push(`À traiter (NEW) : ${d.nouveauxNoms.map(sansTiretCadre).join(', ')}`);
    }
  }

  lignes.push('', 'SOURCES');
  if (!d.sourcesLisibles) {
    lignes.push('états non lisibles (binding KV sans list)');
  } else if (d.sources.length === 0) {
    lignes.push('aucune source suivie pour l\'instant');
  } else {
    for (const s of d.sources) lignes.push(ligneSourceTexte(s));
  }
  if (d.drapeauxMorts.length === 0) {
    lignes.push('Drapeaux sources mortes : aucun drapeau posé');
  } else {
    lignes.push('Drapeaux sources mortes :');
    for (const drapeau of d.drapeauxMorts) {
      lignes.push(
        `🚩 ${sansTiretCadre(drapeau.nom)} · depuis ${sansTiretCadre(drapeau.depuis)} · ${sansTiretCadre(drapeau.raison)}`,
      );
    }
  }

  lignes.push('', 'WORKFLOWS GITHUB');
  if (!d.workflows.verifiables) {
    lignes.push('non vérifiables sans jeton · visibles côté GitHub Actions (mobile)');
  } else {
    for (const w of d.workflows.etats) lignes.push(ligneWorkflowTexte(w));
  }

  lignes.push('', 'CATALOGUE');
  if (d.catalogue.ok) {
    const genere = d.catalogue.genereLe
      ? ` · généré le ${d.catalogue.genereLe.slice(0, 16).replace('T', ' ')} UTC`
      : '';
    lignes.push(`${d.catalogue.nbFiches ?? '?'} fiches au catalogue${genere}`);
  } else {
    lignes.push(
      `INJOIGNABLE (${d.catalogue.detail}) · un catalogue muet rend tout le moteur d'alertes silencieux (classe d'incident du 22/08) : vérifier le déploiement Pages`,
    );
  }

  lignes.push(
    '',
    'ABONNÉS',
    `${d.abonnes.total} abonnés · ${d.abonnes.confirmes} confirmés`,
    '',
    'Rapport automatique quotidien · 10:00 Paris · interne',
  );
  return lignes.join('\n');
}

function ligneCourier(contenuHtml: string, rouge: boolean): string {
  const style = rouge
    ? "margin:0 0 6px;font-family:'Courier New',Courier,monospace;font-size:13px;font-weight:bold;color:#B3261E;"
    : "margin:0 0 6px;font-family:'Courier New',Courier,monospace;font-size:13px;color:#241405;";
  return `<p style="${style}">${contenuHtml}</p>`;
}

function titreSection(texte: string): string {
  return `<h2 style="margin:24px 0 10px;font-family:'Arial Black',Impact,sans-serif;font-size:14px;font-weight:900;color:#241405;text-transform:uppercase;letter-spacing:1px;border-top:3px solid #241405;padding-top:16px;">${texte}</h2>`;
}

export function rendreHtmlRapport(d: DonneesRapport, maintenant: Date): string {
  const dateLongue = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(maintenant);
  const heure = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
  }).format(maintenant);

  const couleurPill = d.nbAnomalies === 0 ? '#0E7A46' : '#B3261E';
  const textePill = d.nbAnomalies === 0 ? 'PIPELINE OK' : `ANOMALIE (${d.nbAnomalies})`;
  const blocVerdict = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" style="background-color:${couleurPill};border:2px solid #241405;border-radius:50px;padding:8px 20px;">
      <span style="font-family:'Arial Black',Impact,sans-serif;font-size:15px;font-weight:900;color:#FFF6EA;text-transform:uppercase;letter-spacing:0.5px;">${textePill}</span>
    </td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding-top:10px;">${
    d.nbAnomalies === 0
      ? '<p style="margin:0;font-size:14px;">Aucun point rouge ce jour.</p>'
      : `<p style="margin:0;font-size:14px;font-weight:bold;color:#B3261E;">${d.nbAnomalies} point${d.nbAnomalies > 1 ? 's' : ''} rouge${d.nbAnomalies > 1 ? 's' : ''} : ${escapeHtml(resumeAnomalies(d))}</p>`
  }</td></tr></table>`;

  // a. Candidats 24 h
  const c = d.candidats;
  let blocCandidats: string;
  if (d.totalCandidats === 0) {
    blocCandidats = '<p style="margin:0 0 6px;font-size:14px;">aucun candidat ces 24 dernières heures</p>';
  } else {
    blocCandidats = ligneCourier(
      `NEW ${c.NEW} · DRAFT ${c.DRAFT} · PUBLISHED ${c.PUBLISHED} · REJECTED ${c.REJECTED} <span style="opacity:0.7;">(total ${d.totalCandidats})</span>`,
      false,
    );
    if (d.nouveauxNoms.length > 0) {
      blocCandidats += `<p style="margin:0 0 6px;font-size:13px;">À traiter (NEW) : ${d.nouveauxNoms.map(escapeHtml).join(', ')}</p>`;
    }
  }

  // b. Sources
  let blocSources: string;
  if (!d.sourcesLisibles) {
    blocSources = '<p style="margin:0 0 6px;font-size:14px;">états non lisibles (binding KV sans list)</p>';
  } else if (d.sources.length === 0) {
    blocSources = '<p style="margin:0 0 6px;font-size:14px;">aucune source suivie pour l\'instant</p>';
  } else {
    blocSources = d.sources
      .map((s) => {
        const succes =
          s.dernierSucces === null || s.ageH === null
            ? 'jamais réussi'
            : `dernier succès il y a ${Math.round(s.ageH)} h`;
        const corps = `${escapeHtml(s.nom)} : ${succes} · ${s.echecsConsecutifs} échec${s.echecsConsecutifs > 1 ? 's' : ''} de suite`;
        return s.inquiete
          ? ligneCourier(`⚠️ ${corps}`, true)
          : ligneCourier(corps, false);
      })
      .join('');
  }
  if (d.drapeauxMorts.length === 0) {
    blocSources += '<p style="margin:8px 0 0;font-size:13px;">Drapeaux sources mortes : aucun drapeau posé</p>';
  } else {
    blocSources +=
      '<p style="margin:8px 0 4px;font-size:13px;font-weight:bold;">Drapeaux sources mortes :</p>' +
      d.drapeauxMorts
        .map((drapeau) =>
          ligneCourier(
            `🚩 ${escapeHtml(drapeau.nom)} · depuis ${escapeHtml(drapeau.depuis)} · ${escapeHtml(drapeau.raison)}`,
            true,
          ),
        )
        .join('');
  }

  // c. Workflows GitHub
  let blocWorkflows: string;
  if (!d.workflows.verifiables) {
    blocWorkflows =
      '<p style="margin:0 0 6px;font-size:14px;">workflows : non vérifiables sans jeton · visibles côté GitHub Actions (mobile)</p>';
  } else {
    blocWorkflows = d.workflows.etats
      .map((w) => {
        const age = w.ageH === null ? '' : ` · il y a ${Math.round(w.ageH)} h`;
        const corps = `${escapeHtml(w.nom)} : ${escapeHtml(w.libelle)}${age}`;
        return w.rouge ? ligneCourier(`⚠️ ${corps}`, true) : ligneCourier(corps, false);
      })
      .join('');
  }

  // d. Catalogue
  let blocCatalogue: string;
  if (d.catalogue.ok) {
    const genere = d.catalogue.genereLe
      ? ` · généré le ${escapeHtml(d.catalogue.genereLe.slice(0, 16).replace('T', ' '))} UTC`
      : '';
    blocCatalogue = ligneCourier(`${d.catalogue.nbFiches ?? '?'} fiches au catalogue${genere}`, false);
  } else {
    blocCatalogue = `<div style="background-color:#B3261E;border:2px solid #241405;border-radius:12px;padding:12px 16px;margin:0 0 6px;">
      <p style="margin:0;font-family:'Arial Black',Impact,sans-serif;font-size:14px;font-weight:900;color:#FFF6EA;text-transform:uppercase;">⚠️ Catalogue injoignable · ${escapeHtml(d.catalogue.detail)}</p>
      <p style="margin:6px 0 0;font-size:13px;line-height:1.5;color:#FFF6EA;">fiches.json ne répond pas : tout le moteur d'alertes devient muet (classe d'incident du 22/08). Vérifier le déploiement Pages et /opendata/v1/fiches.json.</p>
    </div>`;
  }

  // e. Abonnés
  const blocAbonnes = ligneCourier(
    `${d.abonnes.total} abonnés · ${d.abonnes.confirmes} confirmés`,
    false,
  );

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background-color:#FFF9F2;font-family:Arial,Helvetica,sans-serif;color:#241405;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF9F2;padding:40px 16px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#FFF6EA;border:3px solid #241405;border-radius:20px;box-shadow:6px 6px 0px 0px #241405;overflow:hidden;">
      <tr><td style="background-color:#FF6B1A;background-image:radial-gradient(circle, #241405 1.5px, transparent 1.5px);background-size:22px 22px;border-bottom:3px solid #241405;padding:24px;text-align:center;">
        <p style="margin:0;font-family:'Arial Black',Impact,sans-serif;font-size:22px;font-weight:900;color:#241405;letter-spacing:-1px;text-transform:uppercase;">Rapport pipeline</p>
        <p style="margin:8px 0 0;font-family:'Courier New',Courier,monospace;font-size:13px;font-weight:bold;color:#241405;background-color:#FFF6EA;display:inline-block;padding:4px 12px;border:2px solid #241405;border-radius:50px;">${escapeHtml(dateLongue)} · ${heure} Paris</p>
      </td></tr>
      <tr><td style="padding:28px;">
        ${blocVerdict}
        ${titreSection('Candidats 24 h')}${blocCandidats}
        ${titreSection('Sources')}${blocSources}
        ${titreSection('Workflows GitHub')}${blocWorkflows}
        ${titreSection('Catalogue')}${blocCatalogue}
        ${titreSection('Abonnés')}${blocAbonnes}
      </td></tr>
      <tr><td style="padding:16px 28px;background-color:#241405;color:#FFF6EA;">
        <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:12px;">Email interne FrancePassoire &middot; rapport quotidien 10:00 Paris &middot; aucune donnée personnelle</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Orchestration : rapport quotidien
// ---------------------------------------------------------------------------

/**
 * Un passage du rapport : garde KV du jour, collecte non fatale, envoi Brevo.
 * Ne rejette jamais : un cron ne doit pas cracher. Secrets/bindings absents :
 * sortie propre, garde NON posée (le signal reste à envoyer dès retour).
 */
export async function runRapportQuotidien(
  env: Env,
  options: RapportOptions = {},
): Promise<RapportVerdict> {
  const fetchFn = options.fetchFn ?? fetch;
  const maintenant = options.now ?? new Date();
  const log = options.log ?? console.log;

  if (!env.DB || !env.RUN_STATE) {
    log('rapport: bindings DB/RUN_STATE absents — sortie propre');
    return { envoye: false, raison: 'bindings-absents' };
  }
  if (!env.BREVO_API_KEY) {
    log('rapport: BREVO_API_KEY absent — sortie propre (garde non posée)');
    return { envoye: false, raison: 'brevo-absent' };
  }

  const cle = cleGardeRapport(maintenant);
  if ((await env.RUN_STATE.get(cle)) !== null) {
    log(`rapport: déjà envoyé aujourd'hui (${cle})`);
    return { envoye: false, dejaEnvoye: true };
  }

  const donnees = await collecterRapport(env, fetchFn, maintenant);

  // Garde posée AVANT l'envoi (convention queue-watchdog : pas de re-spam
  // au tick suivant si le réseau grésille ; le lendemain réessaie).
  await env.RUN_STATE.put(cle, maintenant.toISOString());

  const sujet = sujetRapport(donnees.nbAnomalies, maintenant);
  const resultat = await sendBrevoEmail(
    env.BREVO_API_KEY,
    {
      to: env.VEILLE_SOCIALE_DEST ?? DESTINATAIRE_PAR_DEFAUT,
      subject: sujet,
      textContent: rendreTexteRapport(donnees, maintenant),
      htmlContent: rendreHtmlRapport(donnees, maintenant),
    },
    fetchFn,
  );
  log(
    `rapport: verdict ${donnees.nbAnomalies === 0 ? 'PIPELINE OK' : `ANOMALIE (${donnees.nbAnomalies})`} — email=${resultat.ok}`,
  );
  return { envoye: resultat.ok, anomalies: donnees.nbAnomalies, sujet };
}

// ---------------------------------------------------------------------------
// Tripwire fiches.json (compteur */15 + alerte une fois par jour)
// ---------------------------------------------------------------------------

/**
 * Branche le résultat du balayage immédiat sur le compteur de pannes :
 *   « fiches-indisponibles »  → +1 (sans TTL) ; à SEUIL_FICHES_MORTES
 *                              échecs (≈ 1 h) : UNE alerte Brevo par jour
 *                              (garde KV posée avant l'envoi) ;
 *   aucune raison (fetch OK)  → remise à zéro ;
 *   autre raison (secrets/bindings absents : rien pu vérifier) → inchangé.
 * Ne rejette jamais ; sans BREVO_API_KEY : détection seule (console.error,
 * garde non posée), comme queue-watchdog.
 */
export async function gererFichesMortes(
  env: Env,
  sweep: InstantSweepResultats,
  options: RapportOptions = {},
): Promise<FichesMortesVerdict> {
  const fetchFn = options.fetchFn ?? fetch;
  const maintenant = options.now ?? new Date();
  const log = options.log ?? console.log;

  if (!env.RUN_STATE) {
    log('fiches-mortes: binding RUN_STATE absent — compteur désactivé (sortie propre)');
    return { compteur: 0, alerte: false };
  }

  if (sweep.raison !== 'fiches-indisponibles') {
    if (sweep.raison === undefined) {
      // Balayage qui a SU lire le catalogue : toute panne est résolue.
      const brut = await env.RUN_STATE.get(CLE_COMPTEUR_FICHES);
      if (brut !== null && brut !== '0') {
        await env.RUN_STATE.put(CLE_COMPTEUR_FICHES, '0');
        log('fiches-mortes: catalogue de retour — compteur remis à zéro');
        return { compteur: 0, alerte: false };
      }
      return { compteur: 0, alerte: false };
    }
    // « secrets-absents » / « run-state-absent » : le balayage n'a rien pu
    // vérifier ; on ne fabrique ni panne, ni amnésie.
    const conserve = Number.parseInt((await env.RUN_STATE.get(CLE_COMPTEUR_FICHES)) ?? '0', 10) || 0;
    return { compteur: conserve, alerte: false };
  }

  const brut = await env.RUN_STATE.get(CLE_COMPTEUR_FICHES);
  const compteur = (Number.parseInt(brut ?? '0', 10) || 0) + 1;
  await env.RUN_STATE.put(CLE_COMPTEUR_FICHES, String(compteur));

  if (compteur < SEUIL_FICHES_MORTES) {
    log(`fiches-mortes: ${compteur}/${SEUIL_FICHES_MORTES} échecs consécutifs — pas encore d'alerte`);
    return { compteur, alerte: false };
  }

  const cleGarde = cleGardeFiches(maintenant);
  if ((await env.RUN_STATE.get(cleGarde)) !== null) {
    log(`fiches-mortes: catalogue toujours injoignable (${compteur} échecs) — alerte déjà envoyée aujourd'hui (${cleGarde})`);
    return { compteur, alerte: false, dejaAlerte: true };
  }

  if (!env.BREVO_API_KEY) {
    console.error(
      `fiches-mortes: DÉTECTION SEULE (BREVO_API_KEY absent) — catalogue injoignable depuis ${Math.floor((compteur * 15) / 60)} h (${compteur} échecs consécutifs)`,
    );
    return { compteur, alerte: false };
  }

  // Garde AVANT l'envoi (convention queue-watchdog).
  await env.RUN_STATE.put(cleGarde, maintenant.toISOString());
  const heures = Math.max(1, Math.round((compteur * 15) / 60));
  const sujet = `Catalogue injoignable depuis ${heures} h`;
  const texte =
    `Le catalogue public fiches.json est injoignable depuis au moins ${heures} h.\n\n` +
    `Échecs consécutifs du balayage quart d'heure : ${compteur} (environ ${heures} h de panne continue).\n` +
    `URL : ${FICHES_URL}\n\n` +
    `Une panne de ce fichier rend muet tout le moteur d'alertes (digest hebdo, alertes immédiates) : ` +
    `c'est la classe d'incident du 22/08.\n\n` +
    `Vérifier : déploiement Pages, /opendata/v1/fiches.json, purge CDN.\n` +
    `Cette alerte est envoyée au plus une fois par jour.`;
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background-color:#FFF9F2;font-family:Arial,Helvetica,sans-serif;color:#241405;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF9F2;padding:40px 16px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#FFF6EA;border:3px solid #241405;border-radius:20px;box-shadow:6px 6px 0px 0px #241405;overflow:hidden;">
      <tr><td style="background-color:#B3261E;border-bottom:3px solid #241405;padding:24px;text-align:center;">
        <p style="margin:0;font-family:'Arial Black',Impact,sans-serif;font-size:22px;font-weight:900;color:#FFF6EA;letter-spacing:-1px;text-transform:uppercase;">Catalogue injoignable</p>
        <p style="margin:8px 0 0;font-family:'Courier New',Courier,monospace;font-size:13px;color:#241405;background-color:#FFF6EA;display:inline-block;padding:4px 12px;border:2px solid #241405;border-radius:50px;">tripwire quart d'heure</p>
      </td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 10px;font-size:15px;line-height:1.5;">Le catalogue public fiches.json est injoignable depuis au moins ${heures} h.</p>
        <p style="margin:0 0 10px;font-family:'Courier New',Courier,monospace;font-size:13px;">échecs consécutifs : ${compteur} (environ ${heures} h de panne continue)</p>
        <p style="margin:0 0 10px;font-size:15px;line-height:1.5;">Une panne de ce fichier rend muet tout le moteur d'alertes (digest hebdo, alertes immédiates) : c'est la classe d'incident du 22/08.</p>
        <p style="margin:0;font-size:14px;line-height:1.5;"><a href="${FICHES_URL}" style="color:#E85A0C;font-weight:bold;">${FICHES_URL}</a></p>
      </td></tr>
      <tr><td style="padding:16px 28px;background-color:#241405;color:#FFF6EA;">
        <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:12px;">Email interne FrancePassoire &middot; tripwire ${SEUIL_FICHES_MORTES} échecs (≈ 1 h) &middot; au plus une alerte par jour</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const resultat = await sendBrevoEmail(
    env.BREVO_API_KEY,
    {
      to: env.VEILLE_SOCIALE_DEST ?? DESTINATAIRE_PAR_DEFAUT,
      subject: sujet,
      textContent: texte,
      htmlContent: html,
    },
    fetchFn,
  );
  log(
    `fiches-mortes: ALERTE catalogue injoignable (${compteur} échecs, ≈ ${heures} h) — email=${resultat.ok}`,
  );
  return { compteur, alerte: true, emailOk: resultat.ok };
}
