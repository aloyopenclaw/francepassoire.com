// ViewModel d'une page entité (/entite/<slug>/) — tâche 25 (Wave 3).
// Regroupement du catalogue par entité normalisée (normalizeName de
// entities.ts), libellés français et formatage déterministe. Aucun fait
// ajouté : chaque chaîne dérive des champs des fiches ou des énumérations
// fermées de fiche-schema.ts — zéro curation manuelle.
//
// Ce module est le helper de la voie « pages entité » uniquement (l'équivalent
// fiche-view.ts vit sur la branche fiche/anchors-preview) : il n'import que
// des modules purs partagés (fiche-schema, entities, slugs).

import type { Fiche } from './fiche-schema';
import { normalizeName } from './entities';
import { entitySlug } from './slugs';

// ---------------------------------------------------------------------------
// Libellés (source de vérité : les énumérations fermées de fiche-schema.ts)
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

const STATUT_LABELS: Record<Fiche['statut'], string> = {
  revendiquee: 'Revendiquée',
  confirmee: 'Confirmée',
};

export function labelStatut(statut: Fiche['statut']): string {
  return STATUT_LABELS[statut];
}

/** Classe CSS de la pastille : motif à trous (passoire) vs scellée verte. */
export function classeStatut(statut: Fiche['statut']): string {
  return statut === 'confirmee' ? 'pill-confirmee' : 'pill-revendiquee';
}

const DATA_TYPE_LABELS: Record<Fiche['data_types'][number], string> = {
  identite: 'identité',
  coordonnees: 'coordonnées',
  sante: 'données de santé',
  financier: 'données financières',
  credentials: 'mots de passe',
  biometrique: 'données biométriques',
  documents: 'documents',
  geolocalisation: 'géolocalisation',
  autre: 'autres données',
};

export function labelDonnee(type: Fiche['data_types'][number]): string {
  return DATA_TYPE_LABELS[type];
}

const VOLUME_UNIT_PHRASES: Record<Fiche['volume']['unit'], string> = {
  personnes: 'personnes concernées',
  comptes: 'comptes concernés',
  enregistrements: 'enregistrements concernés',
  lignes: 'lignes concernées',
};

export function phraseUnite(unite: Fiche['volume']['unit']): string {
  return VOLUME_UNIT_PHRASES[unite];
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

/** « 811197557 » → « 811 197 557 » (affichage uniquement). */
export function formaterSiren(siren: string): string {
  return `${siren.slice(0, 3)} ${siren.slice(3, 6)} ${siren.slice(6)}`;
}

// ---------------------------------------------------------------------------
// Récidive : ordinaux français (« 1ʳᵉ fuite », « 2ᵉ fuite »…)
// ---------------------------------------------------------------------------

/**
 * Ordinal français du rang d'une fuite dans l'historique de son entité :
 * 1 → « 1ʳᵉ » (première), N ≥ 2 → « Nᵉ » (deuxième, troisième…).
 * Le badge récidive de la page n'apparaît qu'à partir de 2 fiches.
 */
export function ordinalFuite(rang: number): string {
  return rang === 1 ? '1ʳᵉ' : `${rang}ᵉ`;
}

// ---------------------------------------------------------------------------
// Vue d'une entité
// ---------------------------------------------------------------------------

/**
 * Date d'attribution d'une fiche — convention du Compteur National
 * (stats.ts) : publication à défaut revendication (AAAA-MM-JJ garanti par
 * le schéma → comparaison lexicale sûre). Sert uniquement au TRI ; les
 * dates affichées (cartes, bornes, description) restent la date de
 * revendication — la date canonique d'entrée dans l'espace public (hero
 * des fiches).
 */
export function dateAttribution(fiche: Fiche): string {
  return fiche.dates.publication ?? fiche.dates.revendication;
}

/** Tri déterministe : attribution décroissante, égalité rompue par slug croissant. */
function trierFiches(fiches: Fiche[]): Fiche[] {
  return [...fiches].sort((a, b) => {
    const parDate = dateAttribution(b).localeCompare(dateAttribution(a));
    return parDate !== 0 ? parDate : a.slug.localeCompare(b.slug);
  });
}

export interface EntityView {
  /** Segment de l'URL /entite/<slug>/ (slug de l'entité normalisée). */
  slug: string;
  /** Nom d'affichage : celui de la fiche la plus récente (nom courant). */
  nom: string;
  /** Fiches de l'entité, attribution décroissante (la plus récente en tête). */
  fiches: Fiche[];
  /** SIREN de la fiche la plus récente qui en porte un, sinon undefined. */
  siren?: string;
  /** Revendication de la fiche la plus ancienne (ISO). */
  premiereDate: string;
  /** Revendication de la fiche la plus récente (ISO). */
  derniereDate: string;
}

/** Segment d'URL d'une clé normalisée : « alaxione » → « alaxione ». */
function slugSegment(cleNormalisee: string): string {
  return entitySlug(cleNormalisee).replace(/^\/entite\//, '').replace(/\/$/, '');
}

/**
 * Regroupe le catalogue par entité normalisée (normalizeName) : une vue par
 * entité, catalogues vides → tableau vide (aucune page générée). Pur et
 * déterministe : mêmes fiches en entrée → mêmes vues en sortie, dans un
 * ordre stable (tri des clés).
 */
export function regrouperParEntite(fiches: readonly Fiche[]): EntityView[] {
  const parCle = new Map<string, Fiche[]>();
  for (const fiche of fiches) {
    const cle = normalizeName(fiche.entity);
    const groupe = parCle.get(cle);
    if (groupe !== undefined) groupe.push(fiche);
    else parCle.set(cle, [fiche]);
  }

  const vues: EntityView[] = [];
  for (const [cle, groupeBrut] of parCle) {
    const groupe = trierFiches(groupeBrut);
    const dates = groupe.map((fiche) => fiche.dates.revendication).sort();
    vues.push({
      slug: slugSegment(cle),
      nom: groupe[0]!.entity,
      fiches: groupe,
      siren: groupe.find((fiche) => fiche.siren !== undefined)?.siren,
      premiereDate: dates[0]!,
      derniereDate: dates[dates.length - 1]!,
    });
  }
  return vues.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Meta-description dérivée : nombre de fiches, bornes de l'historique —
 * rien d'inventé, tout remonte aux champs des fiches.
 */
export function descriptionEntite(vue: EntityView): string {
  if (vue.fiches.length === 1) {
    return `${vue.nom} : 1 fuite de données recensée par FrancePassoire le ${formaterDate(vue.derniereDate)} — statut de vérification, volume annoncé et sources citées sur la fiche.`;
  }
  const nombre = formaterNombre(vue.fiches.length);
  return `${vue.nom} : ${nombre} fuites de données recensées par FrancePassoire entre le ${formaterDate(vue.premiereDate)} et le ${formaterDate(vue.derniereDate)} — statuts, volumes annoncés et sources citées, fiche par fiche.`;
}
