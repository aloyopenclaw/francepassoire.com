// ViewModel d'un dossier de groupe ransomware (tâche 26) : dérivation PURE
// depuis le catalogue public. Aucune métadonnée de groupe (TTPs, activité,
// branding) n'est inventée — tant qu'aucune curation vérifiée n'existe, le
// dossier n'affiche que ce que les fiches du catalogue établissent :
// nombre de fiches, chronologie des victimes françaises, volumes annoncés
// avec étiquettes d'honnêteté (même règle que stats.ts).
//
// Auto-contenu volontairement (vague parallèle) : les libellés reprises ici
// suivent les mêmes conventions que la fiche, sans importer son module.

import type { Fiche } from './fiche-schema';
import { groupSlug } from './slugs';

export type StatutFiche = Fiche['statut'];
export type UniteVolume = Fiche['volume']['unit'];

// ---------------------------------------------------------------------------
// Slugs — le segment d'URL dérive du contrat slugs.ts (/ransomware/<slug>/)
// pour rester synchrone avec groupSlug utilisé partout ailleurs.
// ---------------------------------------------------------------------------

const PREFIXE_RANSOMWARE = '/ransomware/';

/** Segment d'URL du groupe sous /ransomware/ (ex. « Qilin » → « qilin »). */
export function slugDeGroupe(group: string): string {
  const chemin = groupSlug(group); // « /ransomware/<slug>/ »
  return chemin.slice(PREFIXE_RANSOMWARE.length, -1);
}

// ---------------------------------------------------------------------------
// Dossier
// ---------------------------------------------------------------------------

/** Total annoncé pour une unité donnée, toutes fiches du groupe. */
export interface VolumeAnnonce {
  count: number;
  unit: UniteVolume;
}

export interface DossierGroupe {
  /** Nom d'affichage : graphie la plus fréquente du catalogue (égalité → ordre alphabétique). */
  nom: string;
  /** Segment d'URL sous /ransomware/ (deux graphies qui replient au même slug fusionnent). */
  slug: string;
  /** Fiches du groupe, triées par date de revendication décroissante (égalité → entité). */
  fiches: Fiche[];
  /** Totaux par unité (jamais sommés entre unités), ordre de volumeUnitEnum. */
  volumes: VolumeAnnonce[];
  /** Étiquette d'honnêteté — règle de stats.ts : « chiffres revendiqués, non confirmés »
   *  dès qu'une fiche non confirmée contribue. */
  volumesLabel: string;
  /** Années de revendication couvertes, croissantes. */
  annees: number[];
}

const ORDRE_UNITES: readonly UniteVolume[] = [
  'personnes',
  'comptes',
  'enregistrements',
  'lignes',
];

/** Graphie d'affichage d'un groupe : la plus fréquente, égalité → alphabétique. */
function nomAffichage(graphies: readonly string[]): string {
  const comptes = new Map<string, number>();
  for (const graphie of graphies) {
    comptes.set(graphie, (comptes.get(graphie) ?? 0) + 1);
  }
  return [...comptes.entries()].sort(
    (a, b) =>
      b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  )[0][0];
}

/** Un dossier par groupe présent dans le catalogue (≥ 1 fiche par construction).
 *  Catalogue vide ou sans champ `group` → aucun dossier (0 page générée). */
export function composerDossiers(fiches: readonly Fiche[]): DossierGroupe[] {
  const parSlug = new Map<string, Fiche[]>();

  for (const fiche of fiches) {
    const group = fiche.group?.trim();
    if (!group) continue;
    const slug = slugDeGroupe(group);
    const groupe = parSlug.get(slug);
    if (groupe) groupe.push(fiche);
    else parSlug.set(slug, [fiche]);
  }

  const dossiers: DossierGroupe[] = [];
  for (const [slug, fichesGroupe] of parSlug) {
    const trie = [...fichesGroupe].sort(
      (a, b) =>
        b.dates.revendication.localeCompare(a.dates.revendication) ||
        (a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : 0),
    );

    // Totaux par unité — jamais sommés entre unités (des enregistrements ne
    // sont pas des personnes, cf. règle d'honnêteté de stats.ts).
    const totaux = new Map<UniteVolume, number>();
    let uneRevendiquee = false;
    for (const fiche of trie) {
      totaux.set(
        fiche.volume.unit,
        (totaux.get(fiche.volume.unit) ?? 0) + fiche.volume.count,
      );
      if (fiche.statut === 'revendiquee') uneRevendiquee = true;
    }

    const annees = [
      ...new Set(trie.map((fiche) => Number(fiche.dates.revendication.slice(0, 4)))),
    ].sort((a, b) => a - b);

    dossiers.push({
      nom: nomAffichage(fichesGroupe.map((fiche) => fiche.group as string)),
      slug,
      fiches: trie,
      volumes: ORDRE_UNITES.filter((unit) => totaux.has(unit)).map((unit) => ({
        unit,
        count: totaux.get(unit) as number,
      })),
      volumesLabel: uneRevendiquee
        ? 'chiffres revendiqués, non confirmés'
        : 'chiffres confirmés',
      annees,
    });
  }

  return dossiers.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Phrases dérivées (sobres, factuelles — aucun qualificatif)
// ---------------------------------------------------------------------------

/** Phrase d'intro du dossier : dérivée du seul compte de fiches. */
export function phraseIntro(dossier: DossierGroupe): string {
  const n = dossier.fiches.length;
  return n === 1
    ? `${dossier.nom} apparaît dans 1 fiche de fuite revendiquée touchant des entités françaises.`
    : `${dossier.nom} apparaît dans ${n} fiches de fuites revendiquées touchant des entités françaises.`;
}

/** Description meta : dérivée du dossier uniquement. */
export function phraseDescription(dossier: DossierGroupe): string {
  const n = dossier.fiches.length;
  const fuite = n === 1 ? 'fuite revendiquée' : 'fuites revendiquées';
  return `${dossier.nom} : ${n} ${fuite} touchant des entités françaises — chronologie des victimes, volumes annoncés et liens vers les fiches sourcées sur le dossier FrancePassoire.`;
}

// ---------------------------------------------------------------------------
// Libellés et formatage (mêmes conventions que la fiche, auto-contenus)
// ---------------------------------------------------------------------------

const SECTEUR_LABELS: Record<Fiche['secteur'], string> = {
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

export function labelSecteur(secteur: Fiche['secteur']): string {
  return SECTEUR_LABELS[secteur];
}

const STATUT_LABELS: Record<StatutFiche, string> = {
  revendiquee: 'Revendiquée',
  confirmee: 'Confirmée',
};

export function labelStatut(statut: StatutFiche): string {
  return STATUT_LABELS[statut];
}

export function classeStatut(statut: StatutFiche): string {
  return statut === 'confirmee' ? 'pill-confirmee' : 'pill-revendiquee';
}

const UNITES_COURTES: Record<UniteVolume, string> = {
  personnes: 'personnes',
  comptes: 'comptes',
  enregistrements: 'enregistrements',
  lignes: 'lignes',
};

export function phraseUniteCourte(unite: UniteVolume): string {
  return UNITES_COURTES[unite];
}

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
