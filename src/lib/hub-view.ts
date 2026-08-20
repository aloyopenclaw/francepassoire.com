// Vue des pages hub SEO (tâche 28) — /secteur/<slug>/, /donnees/<slug>/ et
// /<yyyy>/. Module PUR (aucun import astro:*) : seuil de génération, barres
// croisées, prose dérivée (Ton A « factuel sec » de la gate de style) et
// métadonnées SEO vivent ici, vérifiables sans build. Aucun fait ajouté :
// chaque valeur dérive du catalogue public via computeCompteur (stats.ts,
// réutilisé tel quel — sectorBars / dataTypeBars / parAnnee).
//
// RÈGLE DURE « aucun hub vide » : une page hub n'existe que si sa valeur
// compte ≥ SEUIL_HUB fiches. Catalogue vide → aucune des trois familles
// n'émet de page (état pré-genèse honnête).
//
// DÉDUP À LA FUSION (TODO — sources divergentes au moment de la tâche 28) :
// - SECTEUR_LABELS duplique fiche-view.ts (branche fiche/anchors-preview) et
//   entity-view.ts (voie tâche 25) — valeurs alignées sur elles (« Commerce »,
//   « Public »). Divergent de src/lib/opendata.ts (branche feat/open-data,
//   MERGE-HOLD : « Retail », « Secteur public ») et du sélecteur
//   CatalogFilters.astro (« Retail ») : trancher puis dédupliquer vers une
//   source unique.
// - DATA_TYPE_META / STATUT_LABELS / classeStatut / formaterDate /
//   formaterNombre dupliquent fiche-view.ts (anchors) et entity-view.ts :
//   dédupliquer à la fusion des pages fiches.
// - dateAttribution / anneeFiche miroir de la règle privée de stats.ts
//   (publication ?? revendication) : l'exporter depuis stats.ts à l'occasion
//   et supprimer le miroir.

import { dataTypeEnum, secteurEnum } from './fiche-schema';
import {
  computeCompteur,
  type DataType,
  type FicheLike,
  type Secteur,
  type StatutFiche,
} from './stats';

/** Seuil de génération d'un hub : nombre minimal de fiches (règle dure). */
export const SEUIL_HUB = 3;

// ---------------------------------------------------------------------------
// Libellés (énumérations fermées de fiche-schema.ts — cf. TODO dédup ci-dessus)
// ---------------------------------------------------------------------------

const SECTEUR_LABELS: Readonly<Record<Secteur, string>> = {
  sante: 'Santé',
  finance: 'Finance',
  retail: 'Commerce',
  recherche: 'Recherche',
  public: 'Public',
  industrie: 'Industrie',
  services: 'Services',
  media: 'Médias',
  autre: 'Autre',
};

export function labelSecteur(secteur: Secteur): string {
  return SECTEUR_LABELS[secteur];
}

/** Libellé affiché (capitalisé) + forme plurielle pour la prose dérivée. */
interface DonneeMeta {
  label: string;
  pluriel: string;
}

const DATA_TYPE_META: Readonly<Record<DataType, DonneeMeta>> = {
  identite: { label: 'Identité', pluriel: 'identités' },
  coordonnees: { label: 'Coordonnées', pluriel: 'coordonnées' },
  sante: { label: 'Données de santé', pluriel: 'données de santé' },
  financier: { label: 'Données financières', pluriel: 'données financières' },
  credentials: { label: 'Mots de passe', pluriel: 'mots de passe' },
  biometrique: {
    label: 'Données biométriques',
    pluriel: 'données biométriques',
  },
  documents: { label: 'Documents', pluriel: 'documents' },
  geolocalisation: {
    label: 'Géolocalisation',
    pluriel: 'données de géolocalisation',
  },
  autre: { label: 'Autres données', pluriel: 'autres données' },
};

export function labelDonnee(type: DataType): string {
  return DATA_TYPE_META[type].label;
}

export function plurielDonnee(type: DataType): string {
  return DATA_TYPE_META[type].pluriel;
}

const STATUT_LABELS: Readonly<Record<StatutFiche, string>> = {
  revendiquee: 'Revendiquée',
  confirmee: 'Confirmée',
};

export function labelStatut(statut: StatutFiche): string {
  return STATUT_LABELS[statut];
}

/** Classe CSS de la pastille : motif à trous (passoire) vs scellée verte. */
export function classeStatut(statut: StatutFiche): string {
  return statut === 'confirmee' ? 'pill-confirmee' : 'pill-revendiquee';
}

// ---------------------------------------------------------------------------
// Formatage déterministe (fuseau UTC explicite pour les dates ISO simples)
// ---------------------------------------------------------------------------

const numberFormatter = new Intl.NumberFormat('fr-FR');

export function formaterNombre(valeur: number): string {
  return numberFormatter.format(valeur);
}

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** « 2026-08-20 » → « 20 août 2026 ». */
export function formaterDate(iso: string): string {
  return dateFormatter.format(new Date(`${iso}T00:00:00Z`));
}

// ---------------------------------------------------------------------------
// Attribution d'une fiche (règle de stats.ts : publication ?? revendication)
// ---------------------------------------------------------------------------

/** Date ISO d'attribution : publication à défaut revendication. */
export function dateAttribution(fiche: FicheLike): string {
  return fiche.dates.publication ?? fiche.dates.revendication;
}

/** Année d'attribution (« AAAA » de la règle ci-dessus). */
export function anneeFiche(fiche: FicheLike): number {
  return Number(dateAttribution(fiche).slice(0, 4));
}

/** Fiches les plus récentes d'abord (attribution desc, puis slug asc —
 *  même ordre déterministe que buildCatalogue de la branche open-data). */
function triRecentes(fiches: readonly FicheLike[]): FicheLike[] {
  return [...fiches].sort(
    (a, b) =>
      dateAttribution(b).localeCompare(dateAttribution(a)) ||
      a.slug.localeCompare(b.slug),
  );
}

// ---------------------------------------------------------------------------
// URL (familles contractuelles de slugs.ts)
// ---------------------------------------------------------------------------

export function urlFiche(slug: string): string {
  return `/fiche/${slug}/`;
}

export function urlSecteur(secteur: Secteur): string {
  return `/secteur/${secteur}/`;
}

export function urlDonnee(type: DataType): string {
  return `/donnees/${type}/`;
}

export function urlAnnee(annee: number): string {
  return `/${annee}/`;
}

// ---------------------------------------------------------------------------
// Hub existence (règle ≥ SEUIL_HUB, calculs réutilisés de computeCompteur)
// ---------------------------------------------------------------------------

/** Clés d'une énumération fermée dont le compteur franchit le seuil. */
function clesHubbees<T extends string>(
  options: readonly T[],
  barres: Readonly<Record<T, number>>,
): ReadonlySet<T> {
  return new Set(options.filter((cle) => barres[cle] >= SEUIL_HUB));
}

export function secteursHubbes(fiches: readonly FicheLike[]): ReadonlySet<Secteur> {
  return clesHubbees(secteurEnum.options, computeCompteur(fiches).sectorBars);
}

export function donneesHubbees(fiches: readonly FicheLike[]): ReadonlySet<DataType> {
  return clesHubbees(dataTypeEnum.options, computeCompteur(fiches).dataTypeBars);
}

export function anneesHubbees(fiches: readonly FicheLike[]): ReadonlySet<string> {
  const parAnnee = computeCompteur(fiches).parAnnee;
  return new Set(
    Object.keys(parAnnee).filter((annee) => parAnnee[annee] >= SEUIL_HUB),
  );
}

// ---------------------------------------------------------------------------
// Barres croisées (contrat visuel : cartes « chiffres » du prototype)
// ---------------------------------------------------------------------------

export interface Barre {
  label: string;
  count: number;
  /** Largeur relative au maximum de la carte, en pourcent (0-100). */
  pct: number;
  /** URL du hub correspondant s'il EXISTE (règle ≥ SEUIL_HUB), sinon null :
   *  aucune barre ne pointe vers une page non générée. */
  href: string | null;
}

/** Compte `projection(fiche)` sur le sous-ensemble du hub, trie par nombre
 *  décroissant puis ordre d'énumération (stable), lie aux hubs existants. */
function construireBarres<T extends string>(
  fichesHub: readonly FicheLike[],
  options: readonly T[],
  labelOf: (cle: T) => string,
  urlOf: (cle: T) => string,
  hubbes: ReadonlySet<T>,
  projection: (fiche: FicheLike) => readonly T[],
): Barre[] {
  const counts = new Map<T, number>();
  for (const fiche of fichesHub) {
    for (const cle of projection(fiche)) {
      counts.set(cle, (counts.get(cle) ?? 0) + 1);
    }
  }
  const max = Math.max(...counts.values(), 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort(
      ([a, ca], [b, cb]) =>
        cb - ca || options.indexOf(a) - options.indexOf(b),
    )
    .map(([cle, count]) => ({
      label: labelOf(cle),
      count,
      pct: Math.round((count / max) * 100),
      href: hubbes.has(cle) ? urlOf(cle) : null,
    }));
}

// ---------------------------------------------------------------------------
// Prose dérivée (Ton A — factuel sec : phrases courtes, zéro adjectif décoratif)
// ---------------------------------------------------------------------------

/** Accord pluriel minimal : « fuite » / « fuites », « confirmée » / « confirmées ». */
function accord(n: number, singulier: string, pluriel: string): string {
  return n > 1 ? pluriel : singulier;
}

function phraseStatut(confirmees: number, revendiquees: number): string {
  if (revendiquees === 0) {
    return `Toutes sont confirmées par une source officielle.`;
  }
  if (confirmees === 0) {
    return `Aucune n'est confirmée par une source officielle : ${revendiquees} ${accord(revendiquees, 'revendiquée', 'revendiquées')}, non ${accord(revendiquees, 'confirmée', 'confirmées')}.`;
  }
  return `Dont ${confirmees} ${accord(confirmees, 'confirmée', 'confirmées')} par une source officielle et ${revendiquees} ${accord(revendiquees, 'revendiquée', 'revendiquées')}, non ${accord(revendiquees, 'confirmée', 'confirmées')}.`;
}

function phraseStatutFiches(fichesHub: readonly FicheLike[]): string {
  const confirmees = fichesHub.filter((f) => f.statut === 'confirmee').length;
  return phraseStatut(confirmees, fichesHub.length - confirmees);
}

/** « entre le 12 août 2026 et le 20 août 2026 » (ou « le 12 août 2026 »). */
function periodeEntre(dmin: string, dmax: string): string {
  return dmin === dmax
    ? `le ${formaterDate(dmin)}`
    : `entre le ${formaterDate(dmin)} et le ${formaterDate(dmax)}`;
}

/** « du 12 août 2026 au 20 août 2026 » (ou « le 12 août 2026 »). */
function periodeDuAu(dmin: string, dmax: string): string {
  return dmin === dmax
    ? `le ${formaterDate(dmin)}`
    : `du ${formaterDate(dmin)} au ${formaterDate(dmax)}`;
}

function bornesPeriode(fichesHub: readonly FicheLike[]): [string, string] {
  const dates = triRecentes(fichesHub).map(dateAttribution);
  return [dates[dates.length - 1], dates[0]];
}

// ---------------------------------------------------------------------------
// Props de page hub (précalculées ici : les gabarits .astro restent muets)
// ---------------------------------------------------------------------------

export interface HubPage {
  /** Kicker mono au-dessus du titre (ex. « Fuites par secteur »). */
  kicker: string;
  /** Titre H1. */
  titre: string;
  /** Prose d'intro Ton A : une phrase par entrée. */
  intro: string[];
  /** Carte de barres (contrat visuel « chiffres ») : titre + sous-titre. */
  carteTitre: string;
  carteSousTitre: string;
  barres: Barre[];
  /** Fiches du hub, les plus récentes d'abord. */
  fiches: FicheLike[];
  /** <title> du document. */
  titreDocument: string;
  /** meta description. */
  description: string;
}

/** Route getStaticPaths : forme commune aux trois familles. */
export interface RouteHub {
  params: Record<string, string>;
  props: { hub: HubPage };
}

function construirePage(
  partial: Omit<HubPage, 'fiches'>,
  fichesHub: readonly FicheLike[],
): { props: { hub: HubPage } } {
  return { props: { hub: { ...partial, fiches: triRecentes(fichesHub) } } };
}

// ---------------------------------------------------------------------------
// Familles de routes (une par page hub — consommé par getStaticPaths)
// ---------------------------------------------------------------------------

/** /secteur/<slug>/ — un hub par secteur comptant ≥ SEUIL_HUB fiches. */
export function secteurRoutes(fiches: readonly FicheLike[]): RouteHub[] {
  const compteur = computeCompteur(fiches);
  const hubbes = clesHubbees(secteurEnum.options, compteur.sectorBars);
  const donneesHub = clesHubbees(dataTypeEnum.options, compteur.dataTypeBars);

  return [...hubbes].map((secteur) => {
    const fichesHub = fiches.filter((f) => f.secteur === secteur);
    const [dmin, dmax] = bornesPeriode(fichesHub);
    const n = fichesHub.length;
    const label = labelSecteur(secteur);
    return {
      params: { slug: secteur },
      ...construirePage(
        {
          kicker: 'Fuites par secteur',
          titre: label,
          intro: [
            `${n} ${accord(n, 'fuite', 'fuites')} recensées dans le secteur ${label} ${periodeEntre(dmin, dmax)}.`,
            phraseStatutFiches(fichesHub),
          ],
          carteTitre: 'Ce qui fuit dans ce secteur',
          carteSousTitre: `Fiches par type de données annoncées :`,
          barres: construireBarres(
            fichesHub,
            dataTypeEnum.options,
            labelDonnee,
            urlDonnee,
            donneesHub,
            (f) => f.data_types,
          ),
          titreDocument: `${label} : ${n} fuites de données recensées - France Passoire`,
          description: `${n} fuites de données recensées dans le secteur ${label.toLowerCase()} en France ${periodeEntre(dmin, dmax)} : fiches sourcées, statuts de vérification et volumes annoncés.`,
        },
        fichesHub,
      ),
    };
  });
}

/** /donnees/<slug>/ — un hub par type de données comptant ≥ SEUIL_HUB fiches. */
export function donneesRoutes(fiches: readonly FicheLike[]): RouteHub[] {
  const compteur = computeCompteur(fiches);
  const hubbes = clesHubbees(dataTypeEnum.options, compteur.dataTypeBars);
  const secteursHub = clesHubbees(secteurEnum.options, compteur.sectorBars);

  return [...hubbes].map((type) => {
    const fichesHub = fiches.filter((f) => f.data_types.includes(type));
    const [dmin, dmax] = bornesPeriode(fichesHub);
    const n = fichesHub.length;
    const label = labelDonnee(type);
    return {
      params: { slug: type },
      ...construirePage(
        {
          kicker: 'Fuites par type de données',
          titre: label,
          intro: [
            `${n} ${accord(n, 'fuite', 'fuites')} recensées où figurent des ${plurielDonnee(type)} parmi les données annoncées ${periodeEntre(dmin, dmax)}.`,
            phraseStatutFiches(fichesHub),
          ],
          carteTitre: 'Secteurs concernés',
          carteSousTitre: `Fiches par secteur :`,
          barres: construireBarres(
            fichesHub,
            secteurEnum.options,
            labelSecteur,
            urlSecteur,
            secteursHub,
            (f) => [f.secteur],
          ),
          titreDocument: `${label} — ${n} fuites de données recensées - France Passoire`,
          description: `${n} fuites de données recensées en France où des ${plurielDonnee(type)} figurent parmi les données annoncées ${periodeEntre(dmin, dmax)}. Fiches sourcées et statuts vérifiés.`,
        },
        fichesHub,
      ),
    };
  });
}

/** /<yyyy>/ — un hub par année (règle d'attribution de stats.ts) comptant
 *  ≥ SEUIL_HUB fiches. */
export function anneeRoutes(fiches: readonly FicheLike[]): RouteHub[] {
  const compteur = computeCompteur(fiches);
  const secteursHub = clesHubbees(secteurEnum.options, compteur.sectorBars);
  const annees = Object.keys(compteur.parAnnee)
    .filter((annee) => compteur.parAnnee[annee] >= SEUIL_HUB)
    .sort((a, b) => b.localeCompare(a));

  return annees.map((annee) => {
    const fichesHub = fiches.filter(
      (f) => String(anneeFiche(f)) === annee,
    );
    const [dmin, dmax] = bornesPeriode(fichesHub);
    const n = fichesHub.length;
    return {
      params: { yyyy: annee },
      ...construirePage(
        {
          kicker: 'Fuites par année',
          titre: annee,
          intro: [
            `${n} ${accord(n, 'fuite', 'fuites')} recensées en ${annee} ${periodeDuAu(dmin, dmax)}.`,
            phraseStatutFiches(fichesHub),
          ],
          carteTitre: `Fuites par secteur en ${annee}`,
          carteSousTitre: `Fiches de ${annee} par secteur :`,
          barres: construireBarres(
            fichesHub,
            secteurEnum.options,
            labelSecteur,
            urlSecteur,
            secteursHub,
            (f) => [f.secteur],
          ),
          titreDocument: `Fuites de données ${annee} : ${n} fiches recensées - France Passoire`,
          description: `${n} fuites de données recensées en France en ${annee}, ${periodeDuAu(dmin, dmax)} : fiches sourcées, statuts de vérification et volumes annoncés.`,
        },
        fichesHub,
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// Rétroliens fiche → hubs (micro-tâche de suivi à la fusion de la branche
// fiche/anchors-preview : le gabarit de fiche appelle ce helper pour
// afficher ses liens retour — documenté dans le DoneClaim tâche 28).
// ---------------------------------------------------------------------------

export interface LienHub {
  url: string;
  label: string;
}

export interface LiensHubs {
  /** /secteur/<slug>/ si le hub existe, sinon null (aucun hub vide). */
  secteur: LienHub | null;
  /** /donnees/<type>/ pour chaque type de la fiche dont le hub existe. */
  donnees: LienHub[];
  /** /<yyyy>/ si le hub existe, sinon null. */
  annee: LienHub | null;
}

/**
 * Hubs existants auxquels une fiche appartient. Signature à deux arguments :
 * l'existence d'un hub dépend du catalogue ENTIER (seuil ≥ SEUIL_HUB), pas de
 * la seule fiche.
 */
export function ficheHubLinks(
  fiche: FicheLike,
  fiches: readonly FicheLike[],
): LiensHubs {
  // Un seul computeCompteur pour les trois familles (aucun recomptage par type).
  const compteur = computeCompteur(fiches);
  const secteurExiste = compteur.sectorBars[fiche.secteur] >= SEUIL_HUB;
  const donneesExistantes = new Set(
    fiche.data_types.filter(
      (type) => compteur.dataTypeBars[type] >= SEUIL_HUB,
    ),
  );
  const annee = String(anneeFiche(fiche));
  const anneeExiste = (compteur.parAnnee[annee] ?? 0) >= SEUIL_HUB;
  return {
    secteur: secteurExiste
      ? { url: urlSecteur(fiche.secteur), label: `Secteur ${labelSecteur(fiche.secteur)}` }
      : null,
    donnees: fiche.data_types
      .filter((type) => donneesExistantes.has(type))
      .map((type) => ({ url: urlDonnee(type), label: labelDonnee(type) })),
    annee: anneeExiste
      ? { url: urlAnnee(Number(annee)), label: `Fuites de ${annee}` }
      : null,
  };
}
