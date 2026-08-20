import { describe, expect, it } from 'vitest';
import type { Candidate } from '../workers/ingest/src/adapter';
import { dedupScore } from '../src/lib/entities';
import { ficheSlug } from '../src/lib/slugs';
import { synthesizeDraft, type SynthesisContext } from '../src/lib/synthesize';

// ---------------------------------------------------------------------------
// Fabriques
// ---------------------------------------------------------------------------

const FULL_RAW = {
  claim_date: '2025-06-11',
  publication: '2025-06-12',
  volume: 750_000,
  volume_unit: 'personnes',
  siren: '811197557',
  secteur: 'sante',
  group: 'Qilin',
  description:
    'Fuite de données de santé : dossiers patients et mots de passe exposés.',
};

const FULL_CANDIDATE: Candidate = {
  source: 'ransomware.live',
  source_url: 'https://ransomware.live/group/qilin',
  raw: JSON.stringify(FULL_RAW),
  entity_name: 'Alaxione',
};

const EMPTY_CTX: SynthesisContext = { catalogEntries: [] };

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    source: 'rss',
    source_url: null,
    raw: '{}',
    entity_name: 'Alaxione',
    ...overrides,
  };
}

/** Restreint l'union DraftResult : échoue le test si le brouillon est rejeté. */
function draftOf(candidate: Candidate, ctx: SynthesisContext = EMPTY_CTX) {
  const result = synthesizeDraft(candidate, ctx);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.draft;
}

/** data_types devinés pour un texte brut donné (raw minimal porteur du texte). */
function typesForText(text: string) {
  return draftOf(makeCandidate({ raw: JSON.stringify({ note: text }) }))
    .data_types;
}

// ---------------------------------------------------------------------------
// Rejets
// ---------------------------------------------------------------------------

describe('synthesizeDraft — rejets (ok: false)', () => {
  it('rejette un candidat sans entity_name', () => {
    const r = synthesizeDraft(makeCandidate({ entity_name: null }), EMPTY_CTX);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('entité') });
  });

  it('rejette un entity_name blanc (espaces uniquement)', () => {
    const r = synthesizeDraft(makeCandidate({ entity_name: '   ' }), EMPTY_CTX);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('entité') });
  });

  it('rejette un raw non parsable en JSON', () => {
    const r = synthesizeDraft(makeCandidate({ raw: '{pas du JSON' }), EMPTY_CTX);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('JSON') });
  });

  it('rejette un raw vide', () => {
    const r = synthesizeDraft(makeCandidate({ raw: '' }), EMPTY_CTX);
    expect(r.ok).toBe(false);
  });

  it('rejette un raw qui parse en non-objet (scalaire, tableau, null)', () => {
    for (const raw of ['"42"', '[1, 2]', 'null']) {
      const r = synthesizeDraft(makeCandidate({ raw }), EMPTY_CTX);
      expect(r.ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Candidat complet
// ---------------------------------------------------------------------------

describe('synthesizeDraft — candidat complet', () => {
  it('produit un brouillon ok, statut revendiquee, champs extraits du raw', () => {
    const draft = draftOf(FULL_CANDIDATE);
    expect(draft.statut).toBe('revendiquee');
    expect(draft.entity).toBe('Alaxione');
    expect(draft.dates.revendication).toBe('2025-06-11');
    expect(draft.dates.publication).toBe('2025-06-12');
    expect(draft.dates.confirmation).toBeNull();
    expect(draft.volume).toEqual({
      count: 750_000,
      unit: 'personnes',
      label: '750000 personnes',
    });
    expect(draft.secteur).toBe('sante');
    expect(draft.siren).toBe('811197557');
    expect(draft.group).toBe('Qilin');
  });

  it('slug = sortie T8 (ficheSlug) pour la même entité + date', () => {
    const draft = draftOf(FULL_CANDIDATE);
    expect(draft.slug).toBe(ficheSlug('Alaxione', '2025-06-11'));
  });

  it('checklist : les 4 portes pré-répondues depuis ce que le candidat fournit', () => {
    const draft = draftOf(FULL_CANDIDATE);
    expect(draft.checklist.entite_identifiee).toBe(true);
    expect(draft.checklist.siren_verifie).toBe(true);
    expect(draft.checklist.source_primaire).toBe(true);
    expect(draft.checklist.volume_recoupé).toBe(true);
  });

  it('checklist minimale : entité seule → 3 portes fausses', () => {
    const draft = draftOf(makeCandidate());
    expect(draft.checklist.entite_identifiee).toBe(true);
    expect(draft.checklist.siren_verifie).toBe(false);
    expect(draft.checklist.source_primaire).toBe(false);
    expect(draft.checklist.volume_recoupé).toBe(false);
  });

  it('data_types : ≥ 2 types déduits du texte du candidat complet', () => {
    const draft = draftOf(FULL_CANDIDATE);
    expect(draft.data_types).toContain('sante');
    expect(draft.data_types).toContain('credentials');
    expect(draft.data_types).toHaveLength(2);
  });

  it('description : marqueur de brouillon + faits sourcés (entité, source)', () => {
    const draft = draftOf(FULL_CANDIDATE);
    expect(draft.description).toContain('[BROUILLON À RÉDIGER]');
    expect(draft.description).toContain('Alaxione');
    expect(draft.description).toContain('ransomware.live');
    expect(draft.description.length).toBeGreaterThanOrEqual(50);
  });

  it('sources[] : entrée construite depuis source_url + label de source', () => {
    const draft = draftOf(FULL_CANDIDATE);
    expect(draft.sources).toEqual([
      {
        label: 'ransomware.live',
        url: 'https://ransomware.live/group/qilin',
        kind: 'revendication',
      },
    ]);
  });

  it('sources[] : url null quand le candidat n’en fournit pas', () => {
    const draft = draftOf(makeCandidate({ source: 'rss' }));
    expect(draft.sources).toEqual([{ label: 'rss', url: null, kind: 'article' }]);
  });

  it('timeline : une entrée par date connue, dans l’ordre documenté', () => {
    const draft = draftOf(FULL_CANDIDATE);
    expect(draft.timeline).toEqual([
      { date: '2025-06-11', event: 'Revendication de la fuite' },
      { date: '2025-06-12', event: 'Publication de la source' },
    ]);
  });

  it('volume en chaîne de chiffres accepté (documenté) ; volume nul refusé', () => {
    const asString = draftOf(
      makeCandidate({ raw: JSON.stringify({ volume: '54000' }) }),
    );
    expect(asString.volume.count).toBe(54_000);
    const zero = draftOf(makeCandidate({ raw: JSON.stringify({ volume: 0 }) }));
    expect(zero.volume.count).toBeNull();
    expect(zero.checklist.volume_recoupé).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Correspondance mots-clés → data_types
// ---------------------------------------------------------------------------

describe('data_types — table de correspondance documentée', () => {
  it('mots de passe / identifiants → credentials', () => {
    expect(typesForText('des mots de passe et identifiants volés')).toContain(
      'credentials',
    );
  });

  it('email / adresse / téléphone → coordonnees', () => {
    expect(
      typesForText('adresses e-mail et numéros de téléphone des clients'),
    ).toContain('coordonnees');
  });

  it('santé (accent replié) / patients → sante', () => {
    expect(typesForText('données de santé et dossiers patients')).toContain(
      'sante',
    );
  });

  it('banque / paiement → financier', () => {
    expect(typesForText('des paiements et données bancaires')).toContain(
      'financier',
    );
  });

  it('géolocalisation (accent) → geolocalisation', () => {
    expect(
      typesForText('historique de géolocalisation des déplacements'),
    ).toContain('geolocalisation');
  });

  it('passeport / pièce d’identité → identite', () => {
    expect(typesForText('passeports et pièces d’identité numérisés')).toContain(
      'identite',
    );
  });

  it('texte neutre → data_types vide (représentable : le brouillon est pré-zod)', () => {
    expect(typesForText('un communiqué sans détail sur les données')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Confiance — pondération documentée
// ---------------------------------------------------------------------------

describe('confidence — pondération documentée (entité 0,4 + url 0,2 + date 0,2 + volume 0,2)', () => {
  it('entité seule → 0,4', () => {
    expect(draftOf(makeCandidate()).confidence).toBe(0.4);
  });

  it('entité + url → 0,6', () => {
    expect(
      draftOf(
        makeCandidate({ source_url: 'https://exemple.fr/article' }),
      ).confidence,
    ).toBe(0.6);
  });

  it('entité + url + date + volume → 1,0', () => {
    expect(draftOf(FULL_CANDIDATE).confidence).toBe(1);
  });

  it('entité + date + volume (sans url) → 0,8', () => {
    const draft = draftOf(
      makeCandidate({
        source_url: null,
        raw: JSON.stringify({ date: '2025-06-11', volume: 10 }),
      }),
    );
    expect(draft.confidence).toBeLessThanOrEqual(1);
    expect(draft.confidence).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// Déduplication — cohérence inter-modules avec dedupScore
// ---------------------------------------------------------------------------

describe('dedup_score — max contre le catalogue (via dedupScore de entities.ts)', () => {
  const candidateRecord = {
    entity: 'Alaxione',
    date: '2025-06-11',
    volume: 750_000,
  };

  it('égal au max des dedupScore contre chaque entrée du catalogue', () => {
    const ctx: SynthesisContext = {
      catalogEntries: [
        { entity: 'Boulangerie Martin' },
        { entity: 'Alaxione', date: '2025-06-11', volume: 750_000 },
        { entity: 'Alaxione SAS' },
      ],
    };
    const draft = draftOf(FULL_CANDIDATE, ctx);
    const expected = Math.max(
      ...ctx.catalogEntries.map((entry) =>
        dedupScore(candidateRecord, entry),
      ),
    );
    expect(draft.dedup_score).toBe(expected);
    expect(expected).toBeGreaterThan(0.9); // l'entrée identique domine le max
  });

  it('catalogue vide → 0', () => {
    expect(draftOf(FULL_CANDIDATE, EMPTY_CTX).dedup_score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Déterminisme
// ---------------------------------------------------------------------------

describe('déterminisme (aucune IO, aucun aléa)', () => {
  it('même entrée deux fois → brouillons deep-equal', () => {
    const ctx: SynthesisContext = {
      catalogEntries: [{ entity: 'Alaxione', date: '2025-06-11' }],
    };
    expect(synthesizeDraft(FULL_CANDIDATE, ctx)).toEqual(
      synthesizeDraft(FULL_CANDIDATE, ctx),
    );
  });
});

// ---------------------------------------------------------------------------
// Absence de date
// ---------------------------------------------------------------------------

describe('sans date de revendication', () => {
  it('dates null, timeline [], slug null, description générée quand même', () => {
    const draft = draftOf(
      makeCandidate({
        source_url: 'https://exemple.fr/a',
        raw: JSON.stringify({ volume: 120, volume_unit: 'comptes' }),
      }),
    );
    expect(draft.dates.revendication).toBeNull();
    expect(draft.dates.publication).toBeNull();
    expect(draft.timeline).toEqual([]);
    expect(draft.slug).toBeNull();
    expect(draft.description).toContain('[BROUILLON À RÉDIGER]');
  });

  it('date non parsable (« hier ») traitée comme absente', () => {
    const draft = draftOf(makeCandidate({ raw: JSON.stringify({ date: 'hier' }) }));
    expect(draft.dates.revendication).toBeNull();
    expect(draft.slug).toBeNull();
  });

  it('date impossible (2025-02-30) traitée comme absente', () => {
    const draft = draftOf(
      makeCandidate({ raw: JSON.stringify({ date: '2025-02-30' }) }),
    );
    expect(draft.dates.revendication).toBeNull();
  });

  it('publication seule → timeline alimentée par ce qui existe', () => {
    const draft = draftOf(
      makeCandidate({ raw: JSON.stringify({ publication: '2025-07-01' }) }),
    );
    expect(draft.dates.revendication).toBeNull();
    expect(draft.timeline).toEqual([
      { date: '2025-07-01', event: 'Publication de la source' },
    ]);
  });

  it('clé « date » acceptée comme date de revendication', () => {
    const draft = draftOf(
      makeCandidate({ raw: JSON.stringify({ date: '2025-06-11' }) }),
    );
    expect(draft.dates.revendication).toBe('2025-06-11');
  });
});
