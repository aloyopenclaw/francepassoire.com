// Taxonomie d'URL du catalogue — générateurs de slugs purs et
// déterministes (aucun accès à Date.now, Math.random ou au réseau).
// Format contractuel : slugs en minuscules [a-z0-9-], compatibles avec
// la regex de ficheSchema (src/lib/fiche-schema.ts).

/** Les quatre familles d'URL du site. */
export type SlugKind = 'fiche' | 'entite' | 'ransomware' | 'annee';

// Segment d'URL par famille ; 'annee' vit à la racine (segment vide).
const SEGMENTS: Readonly<Record<SlugKind, string>> = {
  fiche: 'fuite',
  entite: 'entite',
  ransomware: 'ransomware',
  annee: '',
};

function pathOf(kind: SlugKind, slug: string): string {
  const segment = SEGMENTS[kind];
  return segment === '' ? `/${slug}/` : `/${segment}/${slug}/`;
}

const LIGATURES: Readonly<Record<string, string>> = {
  œ: 'oe',
  æ: 'ae',
  ß: 'ss',
};

/**
 * Replie une chaîne libre en slug [a-z0-9-] : accents → ASCII (é→e,
 * à→a, ç→c…), ligatures (œ→oe, æ→ae, ß→ss), majuscules → minuscules,
 * espaces et ponctuation → tirets, tirets répétés collés, bords nettoyés.
 * Idempotent : un slug ressort identique à lui-même.
 */
function normalizeSlug(input: string): string {
  if (input.trim().length === 0) {
    throw new Error('Slug impossible : entrée vide ou blanche.');
  }

  const folded = input
    .toLowerCase()
    .replace(/[œæß]/g, (ligature) => LIGATURES[ligature])
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  if (folded.length === 0) {
    throw new Error(
      `Slug impossible : « ${input} » se replie en chaîne vide (aucun caractère alphanumérique).`,
    );
  }
  return folded;
}

/** Options de dédoublonnage d'une fiche. */
export interface FicheSlugOptions {
  /**
   * Identifiants de fiches déjà attribués (partie slug seule, ex.
   * « alaxione-20250611 », sans le préfixe /fuite/). En cas de collision
   * entite+date, un suffixe -2, -3… est ajouté au premier identifiant
   * libre. L'ensemble n'est jamais muté.
   */
  existingSlugs?: ReadonlySet<string>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * URL d'une fiche : /fuite/<entite>-<aaaammjj>/ à partir d'une date
 * ISO AAAA-MM-JJ. Pure : même entrée → même sortie, aucun effet de bord.
 */
export function ficheSlug(
  entity: string,
  date: string,
  options?: FicheSlugOptions,
): string {
  if (!ISO_DATE.test(date)) {
    throw new Error(
      `ficheSlug : date attendue au format AAAA-MM-JJ, reçu « ${date} ».`,
    );
  }

  const base = `${normalizeSlug(entity)}-${date.replaceAll('-', '')}`;
  const taken = options?.existingSlugs;

  let slug = base;
  if (taken?.has(slug)) {
    for (let suffix = 2; taken.has(slug); suffix++) {
      slug = `${base}-${suffix}`;
    }
  }
  return pathOf('fiche', slug);
}

/** URL d'une entité : /entite/<slug>/. */
export function entitySlug(entity: string): string {
  return pathOf('entite', normalizeSlug(entity));
}

/** URL d'un dossier ransomware : /ransomware/<slug>/. */
export function groupSlug(group: string): string {
  return pathOf('ransomware', normalizeSlug(group));
}

/** URL d'une année : /<aaaa>/. */
export function yearPath(year: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new Error(
      `yearPath : année AAAA invalide (entier entre 1000 et 9999), reçu « ${year} ».`,
    );
  }
  return pathOf('annee', String(year));
}
