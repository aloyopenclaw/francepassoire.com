import { describe, expect, it } from 'vitest';
import {
  MOTIFS_RETRAIT,
  STATUTS,
  TransitionError,
  transition,
  type DemandeTransition,
  type MotifRetrait,
} from '../src/lib/taxonomy';

const contexte = {
  seq: 42,
  date: '2026-08-20',
  entite: 'Alaxione',
  fiche_du: 'alaxione',
};

const sourceOfficielle: DemandeTransition = {
  to: 'confirmee',
  source_url: 'https://www.cnil.fr/fr/une-sanction',
  source_kind: 'officiel',
};

// Capture une TransitionError (échoue si rien n'est levé ou si l'erreur
// n'est pas typée TransitionError) pour assert sur son code.
function attraperErreur(fn: () => unknown): TransitionError {
  try {
    fn();
  } catch (erreur) {
    if (erreur instanceof TransitionError) return erreur;
    throw new Error(`TransitionError attendue, reçu : ${String(erreur)}`);
  }
  throw new Error('TransitionError attendue, aucune erreur levée');
}

describe('taxonomy — machine à états Revendiquée / Confirmée / Retirée', () => {
  it('énumérations fermées : exactement 3 statuts et 5 motifs, rien d’autre', () => {
    expect([...STATUTS]).toEqual(['revendiquee', 'confirmee', 'retiree']);
    expect([...MOTIFS_RETRAIT]).toEqual([
      'retrait_demande_entite',
      'contestation_fondee',
      'doublon',
      'erreur_documentation',
      'decision_editoriale',
    ]);
  });

  it('revendiquee → confirmee : réussit avec une source primaire officielle et renvoie event + registry_payload', () => {
    const resultat = transition('revendiquee', sourceOfficielle, contexte);
    expect(resultat.event).toBeDefined();
    expect(resultat.registry_payload).toBeDefined();
    expect(resultat.event.type).toBe('STATUT_CONFIRME');
    expect(resultat.registry_payload.type).toBe('STATUT_CONFIRME');
  });

  it('revendiquee → confirmee : rejette une source non officielle', () => {
    const erreur = attraperErreur(() =>
      transition(
        'revendiquee',
        {
          to: 'confirmee',
          source_url: 'https://blog.example/une-note',
          source_kind: 'article',
        },
        contexte,
      ),
    );
    expect(erreur.code).toBe('SOURCE_PRIMAIRE_MANQUANTE');
  });

  it('revendiquee → confirmee : rejette une URL de source vide', () => {
    const erreur = attraperErreur(() =>
      transition(
        'revendiquee',
        { to: 'confirmee', source_url: '   ', source_kind: 'officiel' },
        contexte,
      ),
    );
    expect(erreur.code).toBe('SOURCE_PRIMAIRE_MANQUANTE');
  });

  it('revendiquee → retiree : réussit pour chacun des 5 motifs', () => {
    for (const motif of MOTIFS_RETRAIT) {
      const resultat = transition('revendiquee', { to: 'retiree', motif }, contexte);
      expect(resultat.event.type).toBe('STATUT_RETIRE');
      expect(resultat.registry_payload.type).toBe('STATUT_RETIRE');
    }
  });

  it('revendiquee → retiree : rejette un motif hors énumération', () => {
    // Valeur arrivant de JSON : le typage compile-time ne protège pas l'exécution.
    const motifInconnu = 'peu_fiable' as MotifRetrait;
    const erreur = attraperErreur(() =>
      transition('revendiquee', { to: 'retiree', motif: motifInconnu }, contexte),
    );
    expect(erreur.code).toBe('MOTIF_INCONNU');
  });

  it('confirmee → retiree : réussit avec décision éditoriale + référence officielle', () => {
    const resultat = transition(
      'confirmee',
      {
        to: 'retiree',
        motif: 'decision_editoriale',
        reference_officielle: 'TGI Paris, jugement du 2026-05-12',
      },
      contexte,
    );
    expect(resultat.event.type).toBe('STATUT_RETIRE');
    expect(resultat.registry_payload.type).toBe('STATUT_RETIRE');
  });

  it('confirmee → retiree : rejette tout motif autre que décision éditoriale', () => {
    const erreur = attraperErreur(() =>
      transition('confirmee', { to: 'retiree', motif: 'doublon' }, contexte),
    );
    expect(erreur.code).toBe('MOTIF_INVALIDE');
  });

  it('confirmee → retiree : rejette une décision éditoriale sans référence officielle', () => {
    const sansReference = attraperErreur(() =>
      transition(
        'confirmee',
        { to: 'retiree', motif: 'decision_editoriale', reference_officielle: '' },
        contexte,
      ),
    );
    expect(sansReference.code).toBe('REFERENCE_OFFICIELLE_MANQUANTE');

    const referenceAbsente = attraperErreur(() =>
      transition('confirmee', { to: 'retiree', motif: 'decision_editoriale' }, contexte),
    );
    expect(referenceAbsente.code).toBe('REFERENCE_OFFICIELLE_MANQUANTE');
  });

  it('confirmee → revendiquee : illégal, aucune rétrogradation silencieuse', () => {
    const erreur = attraperErreur(() =>
      transition('confirmee', { to: 'revendiquee' }, contexte),
    );
    expect(erreur.code).toBe('TRANSITION_ILLEGALE');
  });

  it('retiree → n’importe quoi : illégal, état terminal', () => {
    const demandes: DemandeTransition[] = [
      sourceOfficielle,
      { to: 'retiree', motif: 'doublon' },
      { to: 'revendiquee' },
    ];
    for (const demande of demandes) {
      const erreur = attraperErreur(() => transition('retiree', demande, contexte));
      expect(erreur.code).toBe('TRANSITION_ILLEGALE');
    }
  });

  it('auto-transitions (revendiquee→revendiquee, confirmee→confirmee) : illégales', () => {
    const retroRevendiquee = attraperErreur(() =>
      transition('revendiquee', { to: 'revendiquee' }, contexte),
    );
    expect(retroRevendiquee.code).toBe('TRANSITION_ILLEGALE');

    const reConfirmation = attraperErreur(() =>
      transition('confirmee', sourceOfficielle, contexte),
    );
    expect(reConfirmation.code).toBe('TRANSITION_ILLEGALE');
  });

  it('statut inconnu (« peu fiable ») : rejeté hors énumération', () => {
    const erreur = attraperErreur(() =>
      transition('peu fiable', sourceOfficielle, contexte),
    );
    expect(erreur.code).toBe('STATUT_INCONNU');
  });

  it('registry_payload : les 7 clés du registre, empreintes en placeholder null', () => {
    const { registry_payload: ligne } = transition(
      'revendiquee',
      sourceOfficielle,
      contexte,
    );
    expect(Object.keys(ligne).sort()).toEqual([
      'date',
      'empreinte',
      'empreinte_precedente',
      'entite',
      'fiche_du',
      'seq',
      'type',
    ]);
    expect(ligne.seq).toBe(contexte.seq);
    expect(ligne.date).toBe(contexte.date);
    expect(ligne.entite).toBe(contexte.entite);
    expect(ligne.fiche_du).toBe(contexte.fiche_du);
    expect(ligne.empreinte).toBeNull();
    expect(ligne.empreinte_precedente).toBeNull();
  });

  it('TransitionError : erreur typée (code + message français)', () => {
    const erreur = attraperErreur(() =>
      transition('confirmee', { to: 'revendiquee' }, contexte),
    );
    expect(erreur).toBeInstanceOf(Error);
    expect(erreur.name).toBe('TransitionError');
    expect(erreur.message).toMatch(/[àéèêùûôîç]/u);
  });
});
