// PROPOSITION DE PROSE — tâche 21 (gate de style), NON VERROUILLÉ.
//
// Variantes rédactionnelles A/B/C de la description des fiches d'ancrage,
// soumises à la signature du propriétaire via les préversions
// /apercu/ton-a/<slug>, /apercu/ton-b/<slug> et /apercu/ton-c/<slug>.
// Chaque variante ne contient QUE des faits traçables dans le JSON de la
// fiche correspondante (data/catalog/<slug>.json) ; seul le ton change.
// Le Ton C (« A + mise en relief », round 2 du 20/08) ajoute en outre un
// bloc de faits saillants dérivé du JSON (cf. fiche-view.faitsSaillants) ;
// la variante ci-dessous n'en porte que la prose resserrée.
//
// Après sign-off : le ton retenu fusionne dans le champ `description` des
// JSON (contrat fiche-contract.md §1) et CE FICHIER EST SUPPRIMÉ.

export type Ton = 'a' | 'b' | 'c';

export const TITRES_TONS: Record<Ton, string> = {
  a: 'Ton A — « Factuel sec »',
  b: 'Ton B — « Pédagogique citoyen »',
  c: 'Ton C — « A + mise en relief »',
};

export const RESUMES_TONS: Record<Ton, string> = {
  a: 'Phrases courtes et déclaratives, chronologie d’abord, adjectifs au minimum.',
  b: 'Une phrase d’explication, puis les faits, puis une phrase d’orientation.',
  c: 'Cinq faits saillants en tête (mono), puis deux ou trois phrases déclaratives — lecture en cinq secondes, prose sèche.',
};

export const PROSE_VARIANTS: Record<string, Partial<Record<Ton, string>>> = {
  'alaxione-20260820': {
    a: `Le 20 août 2026, un cybercriminel revendique sur un forum le piratage d’Alaxione, éditeur français de rendez-vous médicaux. Il annonce des données sur 6,8 millions de personnes et 10,1 millions de rendez-vous : identité, coordonnées, environ 70 000 numéros de Sécurité sociale, motifs de consultation, messages échangés avec les praticiens. La base est proposée à la vente pour 5 000 dollars, selon la revendication relayée par FrenchBreaches. Alaxione reconnaît une intrusion limitée à un serveur de test. L’éditeur dément le vol de données réelles. Les volumes annoncés ne sont pas confirmés.`,
    b: `Une fuite de données médicales expose des informations intimes — qui vous êtes, qui vous consultez et pourquoi — et rend le phishing ciblé plus crédible. Ici, un cybercriminel revendique le 20 août 2026 le piratage d’Alaxione, plateforme française de rendez-vous médicaux : identité, coordonnées et données de santé de 6,8 millions de personnes selon lui, mises en vente sur un forum. L’éditeur reconnaît une intrusion sur un serveur de test mais dément le vol de données réelles ; rien n’est confirmé à ce stade. Si vous aviez un compte, changez votre mot de passe et activez la double authentification.`,
    c: `Un cybercriminel revendique le 20 août 2026 le piratage d’Alaxione, éditeur de rendez-vous médicaux, et propose la base à la vente. L’éditeur reconnaît une intrusion limitée à un serveur de test et dément le vol de données réelles. Les volumes annoncés ne sont pas confirmés.`,
  },
  'ird-20260817': {
    a: `L’IRD, établissement public de recherche, détecte le 24 juillet 2026 une intrusion d’origine externe dans son système d’information. Les investigations qualifient le 6 août un risque d’atteinte à la confidentialité de données personnelles. Dans sa notification du 17 août, l’institut évalue l’exposition à environ 7 500 personnes : identité, dont numéros de Sécurité sociale, et coordonnées professionnelles. L’IRD indique ne pas pouvoir confirmer une exfiltration. Il a déposé plainte, notifié la CNIL et isolé les serveurs concernés.`,
    b: `Une intrusion détectée dans un système d'information ne signifie pas que des données ont été copiées : elle signifie qu'elles ont pu l'être. L'Institut de recherche pour le développement (IRD) a détecté une telle intrusion le 24 juillet 2026. Dans sa notification du 17 août, l'organisme évalue l'exposition à environ 7 500 personnes — identité et coordonnées — et indique ne pas pouvoir confirmer une exfiltration. Une plainte est déposée, la CNIL notifiée, les serveurs touchés isolés. Si vous travaillez ou travailliez avec l'IRD, surveillez vos comptes et restez attentif aux messages inhabituels.`,
    c: `L’IRD a détecté le 24 juillet une intrusion d’origine externe dans son système d’information. Sa notification du 17 août évalue l’exposition à environ 7 500 personnes — identité et coordonnées — et indique ne pas pouvoir confirmer une exfiltration. L’organisme a déposé plainte, notifié la CNIL et isolé les serveurs concernés.`,
  },
  'dgfip-20260812': {
    a: `Le 12 août 2026, un acteur malveillant nommé « ZeroBytes » revendique sur un forum des accès illégitimes au système d’information de la DGFiP, intervenus en juin et juillet via des identifiants d’agents usurpés. Le 14 août, un communiqué officiel établit la consultation et l’extraction de données de 678 000 particuliers et professionnels : identifiant fiscal, état civil, coordonnées, situation fiscale. Des données cadastrales distinctes ont aussi été consultées. La DGFiP a saisi la CNIL et déposé plainte. Depuis le 17 août, elle informe individuellement les personnes concernées. Les mots de passe n’ont pas été compromis, selon l’administration.`,
    c: `« ZeroBytes » a revendiqué le 12 août des accès illégitimes au système d’information de la DGFiP, intervenus en juin et juillet via des identifiants d’agents usurpés. La DGFiP a établi le 14 août, dans un communiqué officiel, la consultation et l’extraction de données de 678 000 particuliers et professionnels. L’administration a saisi la CNIL, déposé plainte et informe individuellement les personnes concernées depuis le 17 août.`,
  },
};

/** Prose d’un ton donné pour une fiche ; repli honnête si absente. */
export function prosePour(slug: string, ton: Ton): string | undefined {
  return PROSE_VARIANTS[slug]?.[ton];
}
