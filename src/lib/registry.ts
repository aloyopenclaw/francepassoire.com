// Registre d'intégrité chaîné — lignes JSONL dont chaque empreinte couvre
// le contenu de la ligne ET l'empreinte de la précédente. Modifier, insérer
// ou supprimer une ligne ancienne casse la chaîne de proche en proche.
//
// ─── SPÉCIFICATION CANONIQUE (partagée avec scripts/verify-registry.mjs) ───
//
// empreinte = SHA-256 (hex minuscule) des octets UTF-8 de la sérialisation
// canonique de la ligne, définie ainsi :
//   1. partir de la ligne objet et retirer UNIQUEMENT le champ `empreinte`
//      (le champ `empreinte_precedente` RESTE couvert par le hachage) ;
//   2. sérialiser en JSON avec les clés triées par ordre alphabétique
//      (récursivement dans les objets imbriqués), séparateurs compacts
//      `,` et `:`, caractères non-ASCII conservés tels quels (pas
//      d'échappement \uXXXX) ;
//   3. hacher la chaîne obtenue encodée en UTF-8.
//
// Cette règle est calquée sur verifier.py du dépôt CedHaurus
// /fuitesinfos-transparence (json.dumps sort_keys=True, ensure_ascii=False,
// separators=(",", ":"), pop("empreinte") seul, genèse = 64 zéros) : leurs
// 263 lignes réelles vérifient telle quelles avec cette bibliothèque
// (garanti par tests/registry.test.ts). Toute modification de cette règle
// est un changement de contrat public.
//
// Hachage via Web Crypto (crypto.subtle), disponible à l'identique dans
// Node ≥ 19 et dans les Workers Cloudflare — d'où les API asynchrones.

export const EMPREINTE_GENESIS = '0'.repeat(64);

// Nature de l'événement laissée libre : le registre fuitesinfos utilise
// ajout / retrait / correction / campagne ; la chaîne en est indépendante.
export interface EvenementRegistre {
  /** Date de l'événement, AAAA-MM-JJ. */
  date: string;
  /** Nature : ajout, retrait, correction… */
  type: string;
  /** Nom de l'entité concernée. */
  entite: string;
  /** Date de la fiche visée, AAAA-MM-JJ (distincte de `date`). */
  fiche_du: string;
}

// Forme ouverte : les lignes réelles peuvent porter des champs
// additionnels (constate_le, reference…), couverts par l'empreinte.
export interface LigneRegistre extends EvenementRegistre {
  [champ: string]: unknown;
  seq: number;
  empreinte: string;
  empreinte_precedente: string;
}

function canonique(valeur: unknown): string {
  if (valeur === null || typeof valeur !== 'object') {
    return JSON.stringify(valeur);
  }
  if (Array.isArray(valeur)) {
    return '[' + valeur.map(canonique).join(',') + ']';
  }
  // Tri alphabétique (point de code) — identique au sort_keys de Python
  // pour les noms de champs, tous ASCII ici.
  const cles = Object.keys(valeur as Record<string, unknown>).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return (
    '{' +
    cles
      .map(
        (cle) =>
          JSON.stringify(cle) + ':' + canonique((valeur as Record<string, unknown>)[cle]),
      )
      .join(',') +
    '}'
  );
}

/** Sérialisation canonique de la ligne (sans `empreinte`) — règle ci-dessus. */
export function serialiserCanonique(ligne: Record<string, unknown>): string {
  const { empreinte: _omise, ...reste } = ligne;
  return canonique(reste);
}

/** Recalcule l'empreinte d'une ligne à partir de son contenu. */
export async function calculerEmpreinte(
  ligne: Record<string, unknown>,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(serialiserCanonique(ligne)),
  );
  return [...new Uint8Array(digest)]
    .map((octet) => octet.toString(16).padStart(2, '0'))
    .join('');
}

/** Première ligne du registre : seq 1, chaînon fondateur à 64 zéros. */
export async function genesis(
  evenement: EvenementRegistre,
): Promise<LigneRegistre> {
  const ligne: LigneRegistre = {
    seq: 1,
    ...evenement,
    empreinte_precedente: EMPREINTE_GENESIS,
    empreinte: '',
  };
  ligne.empreinte = await calculerEmpreinte(ligne);
  return ligne;
}

/**
 * Ajoute un événement à la suite d'une ligne existante. Refuse tout ajout
 * orphelin : la ligne précédente doit être fournie et porter une empreinte.
 */
export async function append(
  evenement: EvenementRegistre,
  lignePrecedente: LigneRegistre | null | undefined,
): Promise<LigneRegistre> {
  if (
    !lignePrecedente ||
    typeof lignePrecedente.empreinte !== 'string' ||
    lignePrecedente.empreinte.length === 0
  ) {
    throw new Error(
      'append impossible : ligne précédente absente ou sans empreinte (pas d\'ajout orphelin)',
    );
  }
  const ligne: LigneRegistre = {
    seq: lignePrecedente.seq + 1,
    ...evenement,
    empreinte_precedente: lignePrecedente.empreinte,
    empreinte: '',
  };
  ligne.empreinte = await calculerEmpreinte(ligne);
  return ligne;
}

/** Analyse un texte JSONL ; lève en nommant la première ligne invalide. */
export function parseJsonl(texte: string): unknown[] {
  const lignes: unknown[] = [];
  const brutes = texte.split('\n');
  for (let i = 0; i < brutes.length; i++) {
    const brute = brutes[i].trim();
    if (!brute) continue;
    try {
      lignes.push(JSON.parse(brute));
    } catch (erreur) {
      throw new Error(
        `ligne ${i + 1} : JSON invalide — ${erreur instanceof Error ? erreur.message : String(erreur)}`,
      );
    }
  }
  return lignes;
}

export interface ResultatVerification {
  valide: boolean;
  /** Numéro (1-based) de la première ligne en défaut. */
  premiereLigneCassee?: number;
  erreur?: string;
  nbEvenements?: number;
  /** Dernière empreinte recalculée — publiée hors dépôt pour l'ancrage. */
  empreinteTete?: string;
}

/**
 * Vérifie hors-ligne une chaîne complète : séquences, enchaînement et
 * recalcul de chaque empreinte. La chaîne progresse sur les empreintes
 * RECALCULÉES : une ligne ancienne réécrite avec une empreinte recalculée
 * cohérente est détectée au chaînon suivant, pas sur sa propre ligne.
 */
export async function verifierChaine(
  lignes: Array<Record<string, unknown>>,
): Promise<ResultatVerification> {
  if (lignes.length === 0) {
    return { valide: false, erreur: 'registre vide' };
  }
  let precedente = EMPREINTE_GENESIS;
  for (let i = 0; i < lignes.length; i++) {
    const attendu = i + 1;
    const ligne = lignes[i];
    if (ligne.seq !== attendu) {
      return {
        valide: false,
        premiereLigneCassee: attendu,
        erreur: `numéro de séquence ${String(ligne.seq)} — une ligne a été insérée ou supprimée`,
      };
    }
    if (ligne.empreinte_precedente !== precedente) {
      return {
        valide: false,
        premiereLigneCassee: attendu,
        erreur: 'la chaîne est rompue — cette ligne ne suit pas celle qui la précède',
      };
    }
    const calculee = await calculerEmpreinte(ligne);
    if (calculee !== ligne.empreinte) {
      return {
        valide: false,
        premiereLigneCassee: attendu,
        erreur: 'le contenu a été modifié après publication',
      };
    }
    precedente = calculee;
  }
  return {
    valide: true,
    nbEvenements: lignes.length,
    empreinteTete: precedente,
  };
}
