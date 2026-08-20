// Machine à états éditoriale d'une fiche : Revendiquée → Confirmée → Retirée.
// Énumérations volontairement fermées (cf. fiche-schema.ts) : aucune autre
// étiquette n'existe (« peu fiable » interdit), aucune édition silencieuse —
// tout changement de statut passe par transition() et émet une ligne prête
// pour le registre d'intégrité chaîné.

export const STATUTS = ['revendiquee', 'confirmee', 'retiree'] as const;
export type Statut = (typeof STATUTS)[number];

export const MOTIFS_RETRAIT = [
  'retrait_demande_entite',
  'contestation_fondee',
  'doublon',
  'erreur_documentation',
  'decision_editoriale',
] as const;
export type MotifRetrait = (typeof MOTIFS_RETRAIT)[number];

// Aligné sur sourceKindEnum de fiche-schema.ts (redéfini ici pour garder ce
// module pur, sans dépendance zod).
export type GenreSource = 'article' | 'officiel' | 'revendication' | 'archive';

export type TypeEvenementRegistre = 'STATUT_CONFIRME' | 'STATUT_RETIRE';

export type CodeErreurTransition =
  | 'STATUT_INCONNU'
  | 'TRANSITION_ILLEGALE'
  | 'SOURCE_PRIMAIRE_MANQUANTE'
  | 'MOTIF_INCONNU'
  | 'MOTIF_INVALIDE'
  | 'REFERENCE_OFFICIELLE_MANQUANTE';

export class TransitionError extends Error {
  readonly code: CodeErreurTransition;

  constructor(code: CodeErreurTransition, message: string) {
    super(message);
    this.name = 'TransitionError';
    this.code = code;
  }
}

// Demande discriminée par l'état cible. La cible « revendiquee » est
// modélisée car une demande externe peut toujours la formuler — la machine
// la rejette systématiquement (aucune rétrogradation).
export type DemandeTransition =
  | { to: 'confirmee'; source_url: string; source_kind: GenreSource }
  | { to: 'retiree'; motif: MotifRetrait; reference_officielle?: string }
  | { to: 'revendiquee' };

// Contexte porté par la ligne de registre (la machine ne le valide pas :
// le registre, tâche 10, en est propriétaire).
export interface ContexteRegistre {
  seq: number;
  date: string;
  entite: string;
  fiche_du: string;
}

export type EvenementTransition =
  | {
      type: 'STATUT_CONFIRME';
      de: 'revendiquee';
      vers: 'confirmee';
      source_url: string;
    }
  | {
      type: 'STATUT_RETIRE';
      de: Exclude<Statut, 'retiree'>;
      vers: 'retiree';
      motif: MotifRetrait;
      reference_officielle?: string;
    };

// Forme de ligne JSONL du registre d'intégrité (compatible fuitesinfos).
// empreinte / empreinte_precedente valent null ici : le hachage SHA-256
// chaîné appartient au module registre (tâche 10) — cette machine n'émet
// que la forme de la ligne.
export interface LigneRegistre {
  seq: number;
  date: string;
  type: TypeEvenementRegistre;
  entite: string;
  fiche_du: string;
  empreinte: null;
  empreinte_precedente: null;
}

export interface ResultatTransition {
  event: EvenementTransition;
  registry_payload: LigneRegistre;
}

function estStatut(valeur: string): valeur is Statut {
  return (STATUTS as readonly string[]).includes(valeur);
}

function estMotifRetrait(valeur: MotifRetrait): boolean {
  return (MOTIFS_RETRAIT as readonly string[]).includes(valeur);
}

function ligneRegistre(
  type: TypeEvenementRegistre,
  contexte: ContexteRegistre,
): LigneRegistre {
  return {
    seq: contexte.seq,
    date: contexte.date,
    type,
    entite: contexte.entite,
    fiche_du: contexte.fiche_du,
    empreinte: null,
    empreinte_precedente: null,
  };
}

function transitionDepuisRevendiquee(
  demande: DemandeTransition,
  contexte: ContexteRegistre,
): ResultatTransition {
  switch (demande.to) {
    case 'confirmee': {
      if (demande.source_kind !== 'officiel' || demande.source_url.trim() === '') {
        throw new TransitionError(
          'SOURCE_PRIMAIRE_MANQUANTE',
          'La confirmation exige une source primaire officielle : source_url de genre « officiel ».',
        );
      }
      const event: EvenementTransition = {
        type: 'STATUT_CONFIRME',
        de: 'revendiquee',
        vers: 'confirmee',
        source_url: demande.source_url,
      };
      return { event, registry_payload: ligneRegistre('STATUT_CONFIRME', contexte) };
    }
    case 'retiree': {
      if (!estMotifRetrait(demande.motif)) {
        throw new TransitionError(
          'MOTIF_INCONNU',
          `Motif de retrait inconnu « ${String(demande.motif)} » : seuls les 5 motifs de l'énumération existent.`,
        );
      }
      const event: EvenementTransition = {
        type: 'STATUT_RETIRE',
        de: 'revendiquee',
        vers: 'retiree',
        motif: demande.motif,
        ...(demande.reference_officielle !== undefined
          ? { reference_officielle: demande.reference_officielle }
          : {}),
      };
      return { event, registry_payload: ligneRegistre('STATUT_RETIRE', contexte) };
    }
    case 'revendiquee':
      throw new TransitionError(
        'TRANSITION_ILLEGALE',
        'Transition illégale revendiquee → revendiquee : une fiche déjà revendiquée n’a rien à revendiquer.',
      );
    default: {
      const exhaustif: never = demande;
      throw new TransitionError(
        'TRANSITION_ILLEGALE',
        `Transition inattendue : ${JSON.stringify(exhaustif)}`,
      );
    }
  }
}

function transitionDepuisConfirmee(
  demande: DemandeTransition,
  contexte: ContexteRegistre,
): ResultatTransition {
  switch (demande.to) {
    case 'retiree': {
      if (!estMotifRetrait(demande.motif)) {
        throw new TransitionError(
          'MOTIF_INCONNU',
          `Motif de retrait inconnu « ${String(demande.motif)} » : seuls les 5 motifs de l'énumération existent.`,
        );
      }
      if (demande.motif !== 'decision_editoriale') {
        throw new TransitionError(
          'MOTIF_INVALIDE',
          'Le retrait d’une fiche confirmée n’est possible que pour motif « decision_editoriale ».',
        );
      }
      if (demande.reference_officielle === undefined || demande.reference_officielle.trim() === '') {
        throw new TransitionError(
          'REFERENCE_OFFICIELLE_MANQUANTE',
          'Le retrait d’une fiche confirmée exige une référence officielle (décision de justice).',
        );
      }
      const event: EvenementTransition = {
        type: 'STATUT_RETIRE',
        de: 'confirmee',
        vers: 'retiree',
        motif: demande.motif,
        reference_officielle: demande.reference_officielle,
      };
      return { event, registry_payload: ligneRegistre('STATUT_RETIRE', contexte) };
    }
    case 'confirmee':
      throw new TransitionError(
        'TRANSITION_ILLEGALE',
        'Transition illégale confirmee → confirmee : une re-confirmation n’existe pas.',
      );
    case 'revendiquee':
      throw new TransitionError(
        'TRANSITION_ILLEGALE',
        'Transition illégale confirmee → revendiquee : une fiche confirmée ne redevient jamais revendiquée.',
      );
    default: {
      const exhaustif: never = demande;
      throw new TransitionError(
        'TRANSITION_ILLEGALE',
        `Transition inattendue : ${JSON.stringify(exhaustif)}`,
      );
    }
  }
}

// Statut actuel accepté en chaîne : il vient de données externes (JSON, D1)
// et l'invariant « aucune autre étiquette » se vérifie à l'exécution.
export function transition(
  statutActuel: string,
  demande: DemandeTransition,
  contexte: ContexteRegistre,
): ResultatTransition {
  if (!estStatut(statutActuel)) {
    throw new TransitionError(
      'STATUT_INCONNU',
      `Statut inconnu « ${statutActuel} » : seuls ${STATUTS.join(', ')} existent (aucune autre étiquette).`,
    );
  }
  switch (statutActuel) {
    case 'retiree':
      throw new TransitionError(
        'TRANSITION_ILLEGALE',
        'Transition illégale : une fiche retirée est un état terminal.',
      );
    case 'confirmee':
      return transitionDepuisConfirmee(demande, contexte);
    case 'revendiquee':
      return transitionDepuisRevendiquee(demande, contexte);
  }
}
