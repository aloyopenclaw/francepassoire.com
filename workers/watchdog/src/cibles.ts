// workers/watchdog/src/cibles.ts — cibles, constantes et textes purs du
// chien de garde (T50). Module séparé de src/index.ts car l'entrypoint
// workerd n'accepte que des fonctions en exports nommés (cf. workers/ingest) :
// les CONSTANTES vivent ici, importées — jamais ré-exportées par index.ts.

/** Délai max par sonde : au-delà, la cible est déclarée hors ligne. */
export const DELAI_FETCH_MS = 15_000;

export const CLE_HISTORIQUE = 'watchdog:history';

/** Tampon circulaire : les 100 derniers contrôles (toutes cibles confondues). */
export const TAILLE_HISTORIQUE = 100;

export interface Target {
  /** Suffixe de la clé KV watchdog:state:<id>. */
  id: string;
  /** Libellé français avec article, pour le texte public de la note. */
  label: string;
  url: string;
  /** Vérification pure : statut HTTP + marqueur attendu dans le corps. */
  verifier(status: number, corps: string): boolean;
}

/** Les 4 cibles du lancement (spécification T50). */
export const CIBLES: readonly Target[] = [
  {
    id: 'accueil',
    label: 'la page d’accueil',
    url: 'https://francepassoire.com/',
    verifier: (status, corps) => status === 200 && corps.includes('FrancePassoire'),
  },
  {
    id: 'flux-rss',
    label: 'le flux RSS',
    url: 'https://francepassoire.com/feed.xml',
    verifier: (status, corps) => status === 200 && corps.includes('<rss'),
  },
  {
    id: 'registre',
    label: 'le registre d’intégrité',
    url: 'https://francepassoire.com/registre.jsonl',
    verifier: (status, corps) => status === 200 && corps.trim() !== '',
  },
  {
    id: 'api',
    label: 'l’API publique',
    url: 'https://api.francepassoire.com/api/health',
    verifier: (status, corps) => {
      if (status !== 200) {
        return false;
      }
      try {
        return (JSON.parse(corps) as { ok?: unknown }).ok === true;
      } catch {
        return false;
      }
    },
  },
];

export interface EtatCible {
  ok: boolean;
  /** Début de l'état courant (ISO) — alimente le « depuis <heure UTC> ». */
  since: string;
  lastCheck: string;
}

export interface EntreeHistorique {
  cible: string;
  ok: boolean;
  at: string;
}

/** « 2026-08-21 00:40 UTC » — non ambigu, triable, lisible dans une note. */
export function heureUtc(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/:\d{2}\.\d{3}Z$/, ' UTC');
}

/** Texte public de l'alerte (Ton A sobre, français). */
export function texteAlerte(cible: Target, ok: boolean, maintenant: Date, depuis?: Date): string {
  const heure = heureUtc(maintenant);
  if (!ok) {
    return `Surveillance FrancePassoire : ${cible.label} inaccessible depuis ${heure}.`;
  }
  const duree = depuis
    ? ` (indisponible ${Math.max(1, Math.round((maintenant.getTime() - depuis.getTime()) / 60_000))} min)`
    : '';
  return `Surveillance FrancePassoire : ${cible.label} rétablie à ${heure}${duree}.`;
}
