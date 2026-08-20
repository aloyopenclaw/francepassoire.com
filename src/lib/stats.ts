// Compteur National — agrégats calculés au build depuis le catalogue public
// (collection `catalog`). Fonctions pures : mêmes fiches en entrée → mêmes
// agrégats, recalculés à chaque build (aucun cache, aucun état, aucune IO).
//
// Règle d'honnêteté des volumes : les volumes du catalogue sont par nature
// des « chiffres revendiqués » (annoncés par l'attaquant ou l'entité, non
// audités). personnesYTD porte donc une étiquette (personnesLabel) qui
// signale « chiffres revendiqués, non confirmés » dès qu'une fiche non
// confirmée contribue au total.

import {
  dataTypeEnum,
  secteurEnum,
  statutEnum,
  type Fiche,
} from './fiche-schema';

/** Forme zod-inférée de la fiche (contrat public de fiche-schema.ts). */
export type FicheLike = Fiche;
export type Secteur = FicheLike['secteur'];
export type DataType = FicheLike['data_types'][number];
export type StatutFiche = FicheLike['statut'];
export type UniteVolume = FicheLike['volume']['unit'];

/** Une clé par secteur de l'énumération fermée (zéros inclus, ordre stable). */
export type BarresSecteur = Record<Secteur, number>;
/** Une clé par type de données de l'énumération fermée (zéros inclus). */
export type BarresDataType = Record<DataType, number>;
/** Répartition Revendiquée / Confirmée (les 2 seuls statuts publiables). */
export type RepartitionStatuts = Record<StatutFiche, number>;
/** Clés « AAAA » : année d'attribution (publication ?? revendication). */
export type CompteurParAnnee = Record<string, number>;

export interface Compteur {
  /** Somme des volume.count des fiches de l'année courante dont l'unité
   *  est assimilable à des personnes ('personnes' | 'comptes'). */
  personnesYTD: number;
  /** Étiquette d'honnêteté sur personnesYTD (règle des volumes ci-dessus). */
  personnesLabel: string;
  /** Fiches publiées, tous statuts et toutes années confondus. */
  fichesCount: number;
  sectorBars: BarresSecteur;
  dataTypeBars: BarresDataType;
  statutSplit: RepartitionStatuts;
  parAnnee: CompteurParAnnee;
}

// « comptes » = proxy personne ; « lignes »/«enregistrements » = enregistrements
// bruts, jamais sommés dans personnesYTD (les sommer serait déshonnête).
const UNITES_PERSONNE: ReadonlySet<UniteVolume> = new Set(['personnes', 'comptes']);

/** Enregistrement à zéro pour chaque clé d'une énumération fermée zod. */
function zeroRecord<C extends string>(options: readonly C[]): Record<C, number> {
  return Object.fromEntries(options.map((cle) => [cle, 0])) as Record<C, number>;
}

/** Année d'attribution d'une fiche : publication à défaut revendication
 *  (format AAAA-MM-JJ garanti par le schéma → slice(0, 4) sûr). */
function anneeAttribution(fiche: FicheLike): number {
  return Number(
    (fiche.dates.publication ?? fiche.dates.revendication).slice(0, 4),
  );
}

export function computeCompteur(fiches: readonly FicheLike[]): Compteur {
  // Année du build : le compteur est recalculé à chaque build, jamais figé.
  const anneeCourante = new Date().getFullYear();
  const sectorBars = zeroRecord(secteurEnum.options);
  const dataTypeBars = zeroRecord(dataTypeEnum.options);
  const statutSplit = zeroRecord(statutEnum.options);
  const parAnnee: CompteurParAnnee = {};
  let personnesYTD = 0;
  let uneContributriceRevendiquee = false;

  for (const fiche of fiches) {
    sectorBars[fiche.secteur] += 1;
    statutSplit[fiche.statut] += 1;
    // Une fiche alimente la barre de chacun de ses data_types (≥ 1 par schéma).
    for (const type of fiche.data_types) {
      dataTypeBars[type] += 1;
    }
    const annee = anneeAttribution(fiche);
    const cleAnnee = String(annee);
    parAnnee[cleAnnee] = (parAnnee[cleAnnee] ?? 0) + 1;

    // Contributrice du YTD : année courante ET unité assimilable à des personnes.
    if (annee === anneeCourante && UNITES_PERSONNE.has(fiche.volume.unit)) {
      personnesYTD += fiche.volume.count;
      if (fiche.statut === 'revendiquee') uneContributriceRevendiquee = true;
    }
  }

  return {
    personnesYTD,
    personnesLabel: uneContributriceRevendiquee
      ? 'chiffres revendiqués, non confirmés'
      : 'chiffres confirmés',
    fichesCount: fiches.length,
    sectorBars,
    dataTypeBars,
    statutSplit,
    parAnnee,
  };
}

// Cible de l'animation count-up du hero « Compteur National » : null quand le
// catalogue est vide (état vide honnête — aucun chiffre publié avant
// d'exister), personnesYTD sinon (0 honnête si aucune fiche de l'année
// courante ne compte des personnes).
export function countUpTarget(compteur: Compteur): number | null {
  return compteur.fichesCount === 0 ? null : compteur.personnesYTD;
}
