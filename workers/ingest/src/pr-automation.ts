// workers/ingest/src/pr-automation.ts — file de validation éditoriale (T19, Wave 2).
//
// openDraftPr : brouillon T18 → PR GitHub en mode file d'attente.
//   1. garde anti-doublon : PR OUVERT existant pour le même head → {skipped:'duplicate'}
//      (JAMAIS un second PR pour le même candidat) ;
//   2. branche `fiche/<slug>` créée au SHA de tête de main (contents API) ;
//   3. `data/catalog/<slug>.json` posé avec le brouillon validé au sens
//      brouillon (voir validateDraft) — la conformité ficheSchema (zod) reste
//      le travail de la passe éditoriale humaine + la porte CI pr-validate.yml
//      (tests/pr-fiches.test.ts) : fusionner = publier, jamais automatique ;
//   4. PR ouvert avec pour corps la carte de validation (entité, SIREN,
//      sources + URLs, statut suggéré, confiance, portes Ostraca, dedup_score).
//
// JETON : l'authentification du client réel (createGithubClient) se fait par
// le secret FRANCEPASSOIRE_GH_TOKEN (env), fourni par l'appelant — jamais codé
// en dur, jamais loggé. Le jeton réel n'existe pas encore à la T19 : les tests
// injectent un fake, le câblage runtime viendra avec le pipeline final (T47).

import type { Candidate } from './adapter';
import type { FicheDraft } from '../../../src/lib/synthesize';

// ---------------------------------------------------------------------------
// Erreurs typées
// ---------------------------------------------------------------------------

export type PrAutomationErrorKind =
  /** Brouillon sans slug (date absente ou entité non slugifiable) : pas de PR ouvrable. */
  | 'missing_slug'
  /** Brouillon incohérent au stade brouillon (slug mal formé, entité vide, aucune source). */
  | 'invalid_draft'
  /** Échec HTTP/réseau de l'API GitHub (statut porté par `status`). */
  | 'github_api';

export class PrAutomationError extends Error {
  readonly kind: PrAutomationErrorKind;
  readonly status?: number;

  constructor(kind: PrAutomationErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'PrAutomationError';
    this.kind = kind;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// GithubClient — interface minimale injectable (base URL + jeton + fetch)
// ---------------------------------------------------------------------------

export interface GithubClient {
  /** SHA du commit de tête de la branche base (main). */
  getMainSha(): Promise<string>;
  /** Crée la référence git (POST /git/refs), ex. refs/heads/fiche/<slug>. */
  createRef(ref: string, sha: string): Promise<void>;
  /** Crée/modifie un fichier sur une branche (PUT /contents/<path>). */
  putFile(input: {
    path: string;
    branch: string;
    content: string;
    message: string;
  }): Promise<void>;
  /** Ouvre un PR et renvoie son numéro. */
  createPullRequest(input: {
    title: string;
    head: string;
    base: string;
    body: string;
  }): Promise<{ number: number }>;
  /** PR ouvert (state=open) dont head === branch, sinon null. */
  findOpenPullByHead(head: string): Promise<{ number: number } | null>;
}

export interface GithubClientOptions {
  /** Dépôt cible « owner/repo ». */
  repo: string;
  /** Secret FRANCEPASSOIRE_GH_TOKEN — jamais codé en dur. */
  token: string;
  /** Par défaut https://api.github.com. */
  baseUrl?: string;
  /** Fetch injecté (tests, Workers runtime). */
  fetchFn?: typeof fetch;
}

interface GithubRefResponse {
  object: { sha: string };
}

interface GithubPullResponse {
  number: number;
}

/** UTF-8 → base64 compatible Workers et Node (morceauté, tailles arbitraires). */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function createGithubClient(options: GithubClientOptions): GithubClient {
  const baseUrl = options.baseUrl ?? 'https://api.github.com';
  const fetchFn = options.fetchFn ?? fetch;
  const { repo, token } = options;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    let init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init = { ...init, body: JSON.stringify(body) };
    }

    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, init);
    } catch (cause) {
      throw new PrAutomationError(
        'github_api',
        `réseau injoignable : ${method} ${path} (${String(cause)})`,
      );
    }

    if (!response.ok) {
      let detail = '';
      try {
        const payload: unknown = await response.json();
        if (
          typeof payload === 'object' &&
          payload !== null &&
          typeof (payload as { message?: unknown }).message === 'string'
        ) {
          detail = ` — ${(payload as { message: string }).message}`;
        }
      } catch {
        // corps non-JSON : le statut suffit
      }
      throw new PrAutomationError(
        'github_api',
        `GitHub API ${response.status} sur ${method} ${path}${detail}`,
        response.status,
      );
    }

    const text = await response.text();
    return (text === '' ? null : JSON.parse(text)) as T;
  }

  return {
    async getMainSha() {
      const ref = await request<GithubRefResponse>('GET', `/repos/${repo}/git/ref/heads/main`);
      return ref.object.sha;
    },

    async createRef(ref, sha) {
      await request<null>('POST', `/repos/${repo}/git/refs`, { ref, sha });
    },

    async putFile({ path, branch, content, message }) {
      await request<null>('PUT', `/repos/${repo}/contents/${path}`, {
        message,
        content: toBase64(content),
        branch,
      });
    },

    async createPullRequest({ title, head, base, body }) {
      const pull = await request<GithubPullResponse>('POST', `/repos/${repo}/pulls`, {
        title,
        head,
        base,
        body,
      });
      return { number: pull.number };
    },

    async findOpenPullByHead(head) {
      const pulls = await request<GithubPullResponse[]>(
        'GET',
        `/repos/${repo}/pulls?head=${encodeURIComponent(head)}&state=open`,
      );
      return pulls.length > 0 ? { number: pulls[0]!.number } : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Validation au stade brouillon + carte de validation du PR
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * Validation « au stade brouillon » : ce qui doit tenir AVANT la passe
 * éditoriale. Le brouillon T18 est volontairement pré-zod (champs nullables,
 * data_types possiblement vide) : la conformité ficheSchema n'est exigée que
 * par la porte CI (tests/pr-fiches.test.ts) au moment de fusionner.
 */
function validateDraft(draft: FicheDraft): void {
  if (draft.slug === null) {
    throw new PrAutomationError(
      'missing_slug',
      'brouillon sans slug (date de revendication absente ou entité non slugifiable) — pas de PR ouvrable',
    );
  }
  if (!SLUG_RE.test(draft.slug)) {
    throw new PrAutomationError('invalid_draft', `slug mal formé : « ${draft.slug} »`);
  }
  if (draft.entity.trim() === '') {
    throw new PrAutomationError('invalid_draft', 'brouillon sans entité exploitable');
  }
  if (draft.sources.length === 0) {
    throw new PrAutomationError('invalid_draft', `brouillon sans source pour ${draft.slug}`);
  }
}

/** Statut suggéré en clair — un brouillon n'est jamais « confirmée ». */
const STATUT_LABELS: Readonly<Record<FicheDraft['statut'], string>> = {
  revendiquee: 'revendiquée',
};

function buildChecklistCard(draft: FicheDraft, candidate: Candidate): string {
  const sources = draft.sources
    .map((s) => `- ${s.label}${s.url === null ? ' — (sans URL)' : ` — ${s.url}`} (${s.kind})`)
    .join('\n');
  const gates = Object.entries(draft.checklist)
    .map(([label, ok]) => `- [${ok ? 'x' : ' '}] ${label}`)
    .join('\n');

  return [
    '## Carte de validation — file de relecture éditoriale',
    '',
    '> Brouillon généré automatiquement (pipeline T18).',
    '> La fusion n’est JAMAIS automatique : relecture humaine obligatoire.',
    '',
    '| Champ | Valeur |',
    '| --- | --- |',
    `| Entité | ${draft.entity} |`,
    `| SIREN | ${draft.siren ?? '—'} |`,
    `| Statut suggéré | ${STATUT_LABELS[draft.statut]} |`,
    `| Confiance (T18) | ${draft.confidence} |`,
    `| Dédup max catalogue | ${draft.dedup_score} |`,
    '',
    '### Sources',
    sources,
    '',
    '### Portes Ostraca (pré-remplies par le synthétiseur)',
    gates,
    '',
    '### Checklist de fusion (éditeur)',
    '- [ ] Champs obligatoires remplis — le JSON doit passer `ficheSchema` (porte CI `pr-validate`)',
    '- [ ] Sources primaires consultées et URLs vivantes (spot-check CI à 10 %)',
    '- [ ] Aucune donnée personnelle de victimes (métadonnées publiques uniquement)',
    `- [ ] Slug cohérent : \`${draft.slug}\``,
    '',
    '---',
    `Candidat source : ${candidate.source}${
      candidate.id === undefined ? '' : ` (${candidate.id})`
    }`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// openDraftPr
// ---------------------------------------------------------------------------

export type OpenDraftPrResult = { pr: number } | { skipped: 'duplicate' };

export async function openDraftPr(
  candidate: Candidate,
  draft: FicheDraft,
  gh: GithubClient,
): Promise<OpenDraftPrResult> {
  validateDraft(draft);
  const slug = draft.slug;
  const branch = `fiche/${slug}`;
  const path = `data/catalog/${slug}.json`;

  // Garde anti-doublon AVANT toute écriture : jamais un second PR pour le
  // même candidat tant que le premier est ouvert.
  const existing = await gh.findOpenPullByHead(branch);
  if (existing !== null) {
    return { skipped: 'duplicate' };
  }

  const sha = await gh.getMainSha();
  await gh.createRef(`refs/heads/${branch}`, sha);

  const content = `${JSON.stringify(draft, null, 2)}\n`;
  await gh.putFile({
    path,
    branch,
    content,
    message: `fiche: brouillon ${slug} (génération automatique — relecture requise)`,
  });

  const date = draft.dates.revendication ?? draft.dates.publication ?? 'date inconnue';
  const pull = await gh.createPullRequest({
    title: `Fiche: ${draft.entity} (${date})`,
    head: branch,
    base: 'main',
    body: buildChecklistCard(draft, candidate),
  });
  return { pr: pull.number };
}
