// Synthèse candidate → brouillon de fiche — tâche 18 (Wave 2).
//
// Le brouillon est PRÉ-zod : chaque champ du schéma de fiche
// (src/lib/fiche-schema.ts) est présent mais explicitement nullable quand
// inconnu. La validation zod (champs obligatoires, data_types ≥ 1,
// timeline ≥ 1, description ≥ 50 caractères) n'intervient qu'à la
// publication, après les passes éditoriales humaines qui remplissent les
// champs obligatoires manquants. Un data_types vide est donc REPRÉSENTABLE
// dans le brouillon (« non déduit »), jamais dans une fiche publiée.
//
// Pur et déterministe : aucun IO (réseau, D1, KV), aucun Date.now, aucun
// aléatoire. Le statut est TOUJOURS « revendiquee » — rien n'est jamais
// marqué « confirmee » automatiquement. Le dedup_score alimente uniquement
// la carte de pull-request (aucune sémantique d'auto-fusion).

import type { Candidate } from '../../workers/ingest/src/adapter';
import { dedupScore, type EntityRecord } from './entities';
import {
  secteurEnum,
  sourceKindEnum,
  volumeUnitEnum,
  type Fiche,
} from './fiche-schema';
import { ficheSlug } from './slugs';

// ---------------------------------------------------------------------------
// Types exportés
// ---------------------------------------------------------------------------

/** Types dérivés du contrat zod — aucune redéclaration manuelle. */
type Secteur = Fiche['secteur'];
type VolumeUnit = Fiche['volume']['unit'];
type DataType = Fiche['data_types'][number];
type SourceKind = Fiche['sources'][number]['kind'];

/** Contexte de synthèse : entrées du catalogue pour le score de dédup. */
export interface SynthesisContext {
  catalogEntries: EntityRecord[];
}

/**
 * Brouillon pré-éditorial : miroir nullable de la Fiche zod, augmenté de
 * `confidence`, `checklist` et `dedup_score`.
 */
export interface FicheDraft {
  /** Sortie T8 verbatim (ficheSlug → /fuite/<entite>-<aaaammjj>/) ; null sans date. */
  slug: string | null;
  entity: string;
  siren: string | null;
  secteur: Secteur | null;
  /** Constant par construction : jamais « confirmee » automatiquement. */
  statut: 'revendiquee';
  dates: {
    revendication: string | null;
    publication: string | null;
    /** Toujours null dans un brouillon (statut non confirmé). */
    confirmation: null;
  };
  volume: {
    count: number | null;
    unit: VolumeUnit | null;
    label: string | null;
  };
  /** Éventuellement vide (« non déduit ») : la passe éditoriale remplit min 1. */
  data_types: DataType[];
  sources: { label: string; url: string | null; kind: SourceKind }[];
  /** Stub neutre marqué « [BROUILLON À RÉDIGER] », à réécrire par l'humain. */
  description: string;
  timeline: { date: string; event: string }[];
  /** Groupe ransomware revendiquant (ex. Qilin) ; null hors dossiers groupe. */
  group: string | null;
  /** Pondération documentée : entité 0,4 + url 0,2 + date 0,2 + volume 0,2. */
  confidence: number;
  checklist: {
    entite_identifiee: boolean;
    siren_verifie: boolean;
    source_primaire: boolean;
    volume_recoupé: boolean;
  };
  /** Max des dedupScore contre le catalogue ; carte de PR uniquement. */
  dedup_score: number;
}

export type DraftResult =
  | { ok: true; draft: FicheDraft }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Contrat best-effort du payload `raw` (JSON sérialisé par l'adapter)
// ---------------------------------------------------------------------------
// Clés lues, par priorité décroissante (la première valeur PARSABLE gagne) :
//   date de revendication : claim_date | date | revendication
//   date de publication   : publication | pub_date | published
//   volume                : volume | victim_count   (entier ≥ 1, ou chaîne
//                            de chiffres ; toute autre valeur → null)
//   unité de volume       : volume_unit (une des 4 valeurs de l'enum zod)
//   siren                 : siren (exactement 9 chiffres)
//   secteur               : secteur (une des 9 valeurs de l'enum zod)
//   groupe ransomware     : group (chaîne non blanche)
// Toute autre clé est ignorée, sauf pour la déduction des data_types qui
// balaie le TEXTE BRUT du JSON (clés et valeurs, accents repliés).

const REVENDICATION_KEYS = ['claim_date', 'date', 'revendication'] as const;
const PUBLICATION_KEYS = ['publication', 'pub_date', 'published'] as const;

// ---------------------------------------------------------------------------
// Mots-clés → data_types (devinettes documentées, jamais des affirmations)
// ---------------------------------------------------------------------------

// Ordre d'insertion = ordre de l'enum zod ; mots-clés en français replié
// (accents NFKD retirés, apostrophes → espace, minuscules). Un type n'est
// retenu qu'une fois ; « autre » n'est jamais déduit (choix éditorial).
const DATA_TYPE_KEYWORDS: ReadonlyArray<readonly [DataType, readonly string[]]> =
  [
    ['identite', ['passeport', 'identite', 'nir', 'securite sociale', 'identity']],
    [
      'coordonnees',
      ['email', 'e-mail', 'adresse', 'telephone', 'numero de telephone'],
    ],
    ['sante', ['sante', 'medical', 'patient', 'hopital', 'clinique']],
    [
      'financier',
      ['bancaire', 'banque', 'bank', 'paiement', 'iban', 'transaction'],
    ],
    [
      'credentials',
      ['mot de passe', 'mots de passe', 'password', 'identifiant', 'credential'],
    ],
    ['biometrique', ['biometri', 'empreinte', 'adn', 'faciale']],
    ['geolocalisation', ['geolocalisation', 'gps', 'localisation']],
    ['documents', ['document', 'contrat', 'facture', 'justificatif']],
  ];

/** Indices de source → kind (défaut : « article »). */
const SOURCE_KIND_HINTS: ReadonlyArray<readonly [RegExp, SourceKind]> = [
  [/ransomware/i, 'revendication'],
  [/cnil|cert-fr|gouv/i, 'officiel'],
  [/archive|fuitesinfos/i, 'archive'],
];

// ---------------------------------------------------------------------------
// Petits extracteurs purs
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Repli de texte pour la recherche de mots-clés : é→e, ’→espace, minuscules. */
function foldText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019'`´]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function guessDataTypes(rawText: string): DataType[] {
  const haystack = foldText(rawText);
  const found: DataType[] = [];
  for (const [type, keywords] of DATA_TYPE_KEYWORDS) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      found.push(type);
    }
  }
  return found;
}

function guessSourceKind(label: string): SourceKind {
  for (const [hint, kind] of SOURCE_KIND_HINTS) {
    if (hint.test(label)) return kind;
  }
  return 'article';
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;

/**
 * Date ISO AAAA-MM-JJ valide (calendrier réel), ou null. La validation se
 * fait par aller-retour UTC — `Date.parse` seul accepte désormais les
 * débordements (2025-02-30 → 2 mars) sur les V8 récents.
 */
function parseIsoDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DAY.exec(value.trim());
  if (match === null) return null;
  const [year, month, day] = [match[1]!, match[2]!, match[3]!].map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]!}-${match[2]!}-${match[3]!}`;
}

/** Première date parsable parmi les clés données, par priorité. */
function firstIsoDay(
  payload: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const parsed = parseIsoDay(payload[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

/** Volume crédible uniquement : entier ≥ 1 (nombre ou chaîne de chiffres). */
function extractVolume(payload: Record<string, unknown>): number | null {
  const value = payload['volume'] ?? payload['victim_count'];
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return parsed >= 1 ? parsed : null;
  }
  return null;
}

function extractVolumeUnit(payload: Record<string, unknown>): VolumeUnit | null {
  const value = payload['volume_unit'];
  if (
    typeof value === 'string' &&
    (volumeUnitEnum.options as readonly string[]).includes(value)
  ) {
    return value as VolumeUnit;
  }
  return null;
}

function extractSiren(payload: Record<string, unknown>): string | null {
  const value = payload['siren'];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{9}$/.test(trimmed) ? trimmed : null;
}

function extractSecteur(payload: Record<string, unknown>): Secteur | null {
  const value = payload['secteur'];
  if (
    typeof value === 'string' &&
    (secteurEnum.options as readonly string[]).includes(value)
  ) {
    return value as Secteur;
  }
  return null;
}

function extractGroup(payload: Record<string, unknown>): string | null {
  const value = payload['group'];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Sortie T8 si l'entité est slugifiable et la date connue ; sinon null. */
function draftSlug(entity: string, revendication: string | null): string | null {
  if (revendication === null) return null;
  try {
    return ficheSlug(entity, revendication);
  } catch {
    // Entité sans caractère alphanumérique après repli — passe éditoriale.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Confiance — points entiers sur 10 pour éviter les artefacts flottants
// ---------------------------------------------------------------------------

const POINTS_ENTITY = 4;
const POINTS_URL = 2;
const POINTS_DATE = 2;
const POINTS_VOLUME = 2;

// ---------------------------------------------------------------------------
// Description — stub neutre marqué, faits sourcés uniquement
// ---------------------------------------------------------------------------

function buildDescription(input: {
  entity: string;
  source: string;
  url: string | null;
  revendication: string | null;
  publication: string | null;
  volumeCount: number | null;
  volumeUnit: VolumeUnit | null;
  dataTypes: DataType[];
}): string {
  const parts: string[] = [
    '[BROUILLON À RÉDIGER]',
    'Contenu généré automatiquement depuis une source publique, non vérifié.',
    `Fuite de données personnelles touchant « ${input.entity} », signalée par la source « ${input.source} »${
      input.url === null ? '' : ` (${input.url})`
    }.`,
  ];
  if (input.revendication !== null) {
    parts.push(`Date de revendication : ${input.revendication}.`);
  }
  if (input.publication !== null) {
    parts.push(`Date de publication : ${input.publication}.`);
  }
  if (input.volumeCount !== null) {
    parts.push(
      input.volumeUnit === null
        ? `Volume annoncé : ${input.volumeCount}.`
        : `Volume annoncé : ${input.volumeCount} ${input.volumeUnit}.`,
    );
  }
  if (input.dataTypes.length > 0) {
    parts.push(
      `Types de données déduits du texte source : ${input.dataTypes.join(', ')}.`,
    );
  }
  parts.push(
    'Statut « revendiquée » — confirmation éditoriale indépendante requise avant publication.',
  );
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Synthèse
// ---------------------------------------------------------------------------

export function synthesizeDraft(
  candidate: Candidate,
  context: SynthesisContext,
): DraftResult {
  const entity = candidate.entity_name?.trim() ?? '';
  if (entity === '') {
    return {
      ok: false,
      reason: 'entité non identifiée : candidat sans entity_name exploitable',
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(candidate.raw);
  } catch {
    return { ok: false, reason: `payload raw non parsable en JSON : « ${candidate.raw.slice(0, 80)} »` };
  }
  if (!isRecord(payload)) {
    return { ok: false, reason: 'payload raw invalide : le JSON n’est pas un objet' };
  }

  const revendication = firstIsoDay(payload, REVENDICATION_KEYS);
  const publication = firstIsoDay(payload, PUBLICATION_KEYS);
  const volumeCount = extractVolume(payload);
  const volumeUnit = extractVolumeUnit(payload);
  const siren = extractSiren(payload);
  const secteur = extractSecteur(payload);
  const group = extractGroup(payload);
  const url =
    candidate.source_url !== null && candidate.source_url.trim() !== ''
      ? candidate.source_url
      : null;
  const dataTypes = guessDataTypes(candidate.raw);

  const confidence =
    (POINTS_ENTITY +
      (url === null ? 0 : POINTS_URL) +
      (revendication === null ? 0 : POINTS_DATE) +
      (volumeCount === null ? 0 : POINTS_VOLUME)) /
    10;

  // Dédup : max des scores contre le catalogue. Alimente la carte de PR
  // uniquement — aucune fusion automatique ne découle de ce score.
  const record: EntityRecord = {
    entity,
    ...(revendication !== null ? { date: revendication } : {}),
    ...(volumeCount !== null ? { volume: volumeCount } : {}),
  };
  let dedupMax = 0;
  for (const entry of context.catalogEntries) {
    const score = dedupScore(record, entry);
    if (score > dedupMax) dedupMax = score;
  }

  const timeline: { date: string; event: string }[] = [];
  if (revendication !== null) {
    timeline.push({ date: revendication, event: 'Revendication de la fuite' });
  }
  if (publication !== null) {
    timeline.push({ date: publication, event: 'Publication de la source' });
  }

  const draft: FicheDraft = {
    slug: draftSlug(entity, revendication),
    entity,
    siren,
    secteur,
    statut: 'revendiquee',
    dates: {
      revendication,
      publication,
      // Un brouillon n'est jamais confirmé : la date l'est tout autant.
      confirmation: null,
    },
    volume: {
      count: volumeCount,
      unit: volumeUnit,
      label:
        volumeCount !== null && volumeUnit !== null
          ? `${volumeCount} ${volumeUnit}`
          : null,
    },
    data_types: dataTypes,
    sources: [
      { label: candidate.source, url, kind: guessSourceKind(candidate.source) },
    ],
    description: buildDescription({
      entity,
      source: candidate.source,
      url,
      revendication,
      publication,
      volumeCount,
      volumeUnit,
      dataTypes,
    }),
    timeline,
    group,
    confidence,
    checklist: {
      entite_identifiee: true, // garanti par le rejet ci-dessus
      // La vérification SIREN proprement dite (resolveSiren, T11) est un IO
      // hors du synthétiseur pur : la porte n'est pré-répondue « oui » que
      // si l'adapter fournit déjà un SIREN 9 chiffres valide.
      siren_verifie: siren !== null,
      source_primaire: url !== null,
      // « Recoupé » au sens strict (corroboration multi-sources) : éditorial.
      // Ici : la source annonce un volume crédible (entier ≥ 1).
      volume_recoupé: volumeCount !== null,
    },
    dedup_score: dedupMax,
  };

  return { ok: true, draft };
}
