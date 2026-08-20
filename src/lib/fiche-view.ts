// ViewModel d'une fiche pour le rendu (tâche 21) : libellés français,
// micro-copie des info-bulles et formatage déterministe. Aucun fait ajouté :
// chaque chaîne dérive des énumérations fermées de fiche-schema.ts.

import type { Fiche } from './fiche-schema';

export type StatutFiche = Fiche['statut'];
export type DataTypeFiche = Fiche['data_types'][number];
export type SourceKindFiche = Fiche['sources'][number]['kind'];

// ---------------------------------------------------------------------------
// Secteurs
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

// ---------------------------------------------------------------------------
// Statut (pastille)
// ---------------------------------------------------------------------------

const STATUT_LABELS: Record<StatutFiche, string> = {
  revendiquee: 'Revendiquée',
  confirmee: 'Confirmée',
};

/** Phrase d'explication honnête sous la pastille de statut. */
const STATUT_EXPLICATIONS: Record<StatutFiche, string> = {
  revendiquee:
    'Fuite alléguée, non établie par une source officielle : les chiffres annoncés ne sont pas confirmés.',
  confirmee:
    'Fuite établie par une source officielle (entité, autorité ou justice).',
};

export function labelStatut(statut: StatutFiche): string {
  return STATUT_LABELS[statut];
}

export function explicationStatut(statut: StatutFiche): string {
  return STATUT_EXPLICATIONS[statut];
}

export function classeStatut(statut: StatutFiche): string {
  return statut === 'confirmee' ? 'pill-confirmee' : 'pill-revendiquee';
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

const VOLUME_UNIT_PHRASES: Record<Fiche['volume']['unit'], string> = {
  personnes: 'personnes concernées',
  comptes: 'comptes concernés',
  enregistrements: 'enregistrements concernés',
  lignes: 'lignes concernées',
};

export function phraseUnite(unite: Fiche['volume']['unit']): string {
  return VOLUME_UNIT_PHRASES[unite];
}

const numberFormatter = new Intl.NumberFormat('fr-FR');

export function formaterNombre(valeur: number): string {
  return numberFormatter.format(valeur);
}

// ---------------------------------------------------------------------------
// Dates (déterministes : fuseau UTC explicite pour les dates ISO simples)
// ---------------------------------------------------------------------------

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
// Types de données (chips + info-bulles)
// ---------------------------------------------------------------------------

interface ChipDonnee {
  label: string;
  /** Micro-copie : le risque concret pour la personne, ≤ 20 mots, sobre. */
  tooltip: string;
}

const DATA_TYPE_CHIPS: Record<DataTypeFiche, ChipDonnee> = {
  identite: {
    label: 'identité',
    tooltip:
      'Nom, prénom, numéro de Sécurité sociale : de quoi usurper votre identité dans des démarches.',
  },
  coordonnees: {
    label: 'coordonnées',
    tooltip:
      'Email, téléphone, adresse : la matière première des messages de phishing ciblés.',
  },
  sante: {
    label: 'données de santé',
    tooltip:
      'Motifs de consultation, échanges avec un praticien : des informations intimes, exploitables pour faire pression.',
  },
  financier: {
    label: 'données financières',
    tooltip:
      'Coordonnées bancaires ou de paiement : à surveiller de près sur vos relevés.',
  },
  credentials: {
    label: 'mots de passe',
    tooltip:
      'Identifiants potentiellement lisibles : à changer immédiatement, partout où vous les réutilisez.',
  },
  biometrique: {
    label: 'données biométriques',
    tooltip:
      'Empreintes, voix, visage : impossibles à changer une fois exposées.',
  },
  documents: {
    label: 'documents',
    tooltip:
      'Pièces d’identité, justificatifs : réutilisables pour des usurpations.',
  },
  geolocalisation: {
    label: 'géolocalisation',
    tooltip:
      'Historique de déplacements : révèle vos habitudes et vos lieux de vie.',
  },
  autre: {
    label: 'autres données',
    tooltip:
      'Autres données personnelles explicitement listées par les sources.',
  },
};

export function chipDonnee(type: DataTypeFiche): ChipDonnee {
  return DATA_TYPE_CHIPS[type];
}

// ---------------------------------------------------------------------------
// Genres de sources (pastille)
// ---------------------------------------------------------------------------

const SOURCE_KIND_LABELS: Record<SourceKindFiche, string> = {
  article: 'Presse',
  officiel: 'Officiel',
  revendication: 'Revendication',
  archive: 'Archive',
};

export function labelGenreSource(kind: SourceKindFiche): string {
  return SOURCE_KIND_LABELS[kind];
}

// ---------------------------------------------------------------------------
// Faits saillants (Ton C — « A + mise en relief », tâche 21 round 2)
// ---------------------------------------------------------------------------

export interface FaitSaillant {
  label: string;
  valeur: string;
}

// Forme courte pour le bloc de mise en relief : reprend la distinction
// revendication / confirmation sans la phrase d'explication du hero.
const STATUT_VERIFICATION: Record<StatutFiche, string> = {
  revendiquee: 'revendiquée — exfiltration non établie',
  confirmee: 'confirmée par une source officielle',
};

/** Source qui établit la fiche : officielle si présente, sinon le relais de
 * la revendication, sinon la première source citée. */
function sourcePrimaire(fiche: Fiche): Fiche['sources'][number] {
  return (
    fiche.sources.find((source) => source.kind === 'officiel') ??
    fiche.sources.find((source) => source.kind === 'revendication') ??
    fiche.sources[0]
  );
}

/** Cinq faits saillants dérivés du JSON de la fiche : volume, date, données,
 * statut de vérification, source primaire. Rien d'inventé — chaque valeur
 * remonte à un champ sourcé de la fiche. */
export function faitsSaillants(fiche: Fiche): FaitSaillant[] {
  const primaire = sourcePrimaire(fiche);
  const hote = new URL(primaire.url).hostname.replace(/^www\./, '');
  return [
    {
      label: 'Volume',
      valeur: `${formaterNombre(fiche.volume.count)} ${phraseUnite(fiche.volume.unit)}`,
    },
    {
      label: 'Date',
      valeur:
        `revendication le ${formaterDate(fiche.dates.revendication)}` +
        (fiche.dates.confirmation
          ? ` · confirmation le ${formaterDate(fiche.dates.confirmation)}`
          : ''),
    },
    {
      label: 'Données',
      valeur: fiche.data_types.map((type) => chipDonnee(type).label).join(' · '),
    },
    {
      label: 'Statut de vérification',
      valeur: STATUT_VERIFICATION[fiche.statut],
    },
    {
      label: 'Source primaire',
      valeur: `${labelGenreSource(primaire.kind).toLowerCase()} · ${hote}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// SIREN (« 811197557 » → « 811 197 557 »), affichage uniquement
// ---------------------------------------------------------------------------

export function formaterSiren(siren: string): string {
  return `${siren.slice(0, 3)} ${siren.slice(3, 6)} ${siren.slice(6)}`;
}
