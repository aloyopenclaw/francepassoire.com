import { describe, expect, it } from 'vitest';
import { MOTIFS_RETRAIT, type MotifRetrait, type Statut } from '../src/lib/taxonomy';
import {
  CTA_COURT,
  CTA_LONG,
  renderSocialPost,
  renderSocialPostCourt,
  SocialTemplateError,
  renderNewFichePost,
  renderStatusChangePost,
  renderWeeklyDigestTeaser,
  type NewFicheInput,
  type StatusChangeInput,
} from '../src/lib/social-templates';

// Épingle indépendante (doublée volontairement depuis le module) : la
// mention exacte que TOUTE sortie « revendiquée » doit porter — aucune
// allégation non vérifiée ne se présente comme un fait.
const MENTION_EXACTE = 'revendication non confirmée par l’entité';

const MOTS_ALARMISTES = ['urgence', 'panique', 'catastrophe', 'choc', 'effarant'] as const;

// Pire cas éditorial réaliste : entité de 63 caractères + volume long.
const ENTITE_PIRE_CAS = 'Établissement public de santé Alsace-Champagne-Ardenne-Lorraine';
const VOLUME_LONG = '1 400 000 dossiers patients et adresses e-mail';
const LIEN_COURT = 'https://francepassoire.com/f/qX9zK4';

function ficheConfirmee(entity = 'Alaxione'): NewFicheInput {
  return {
    entity,
    statut: 'confirmee',
    volumeLabel: '900 000 patients',
    url: 'https://francepassoire.com/f/alaxione-20260820',
  };
}

function compterExclamations(post: string): number {
  return post.length - post.replaceAll('!', '').length;
}

describe('social-templates — posts defamation-safe (nouvelle fiche, statut, teaser)', () => {
  it('nouvelle fiche confirmée : golden — annonce factuelle entité + volume + lien', () => {
    expect(renderNewFichePost(ficheConfirmee())).toBe(
      'Nouvelle fiche confirmée : Alaxione — 900 000 patients. Sources et détails : https://francepassoire.com/f/alaxione-20260820',
    );
  });

  it('nouvelle fiche revendiquée : porte TOUJOURS la mention exacte de non-confirmation', () => {
    const entites = ['Alaxione', 'Clinique Saint-Joseph', 'Ville de Sète', ENTITE_PIRE_CAS];
    for (const entity of entites) {
      const post = renderNewFichePost({
        entity,
        statut: 'revendiquee',
        volumeLabel: '1,2 million de comptes',
        url: LIEN_COURT,
      });
      expect(post).toContain(MENTION_EXACTE);
      // Le wording reste « revendiquée », jamais un fait non vérifié.
      expect(post).toContain('revendiquée');
      expect(post).toContain(entity);
      expect(post).toContain(LIEN_COURT);
    }
  });

  it('changement de statut : les 3 transitions légales de la taxonomie rendent, avec le vocabulaire T9', () => {
    const transitions: ReadonlyArray<{
      from: Statut;
      to: Statut;
      motif?: MotifRetrait;
      extrait: string;
    }> = [
      { from: 'revendiquee', to: 'confirmee', extrait: '« revendiquée » à « confirmée »' },
      { from: 'revendiquee', to: 'retiree', motif: 'doublon', extrait: '« revendiquée » à « retirée »' },
      { from: 'confirmee', to: 'retiree', motif: 'decision_editoriale', extrait: '« confirmée » à « retirée »' },
    ];
    for (const transition of transitions) {
      const post = renderStatusChangePost({
        entity: 'Alaxione',
        from: transition.from,
        to: transition.to,
        motif: transition.motif,
        url: LIEN_COURT,
      });
      expect(post).toContain(transition.extrait);
      expect(post).toContain(LIEN_COURT);
    }
  });

  it('changement de statut : transition illégale (confirmee → revendiquee) rejetée en français', () => {
    expect(() =>
      renderStatusChangePost({
        entity: 'Alaxione',
        from: 'confirmee',
        to: 'revendiquee',
        url: LIEN_COURT,
      }),
    ).toThrow(/non annonçable/);
  });

  it('changement de statut : motif de retrait inconnu rejeté', () => {
    const motifBogus: string = 'piratage';
    expect(() =>
      renderStatusChangePost({
        entity: 'Alaxione',
        from: 'revendiquee',
        to: 'retiree',
        motif: motifBogus as MotifRetrait,
        url: LIEN_COURT,
      }),
    ).toThrow(/Motif de retrait inconnu/);
  });

  it('changement de statut : motif fourni pour une confirmation rejeté', () => {
    expect(() =>
      renderStatusChangePost({
        entity: 'Alaxione',
        from: 'revendiquee',
        to: 'confirmee',
        motif: 'doublon',
        url: LIEN_COURT,
      }),
    ).toThrow(/confirmation/);
  });

  it('retrait sans motif : formule neutre renvoyant au registre d’intégrité', () => {
    const post = renderStatusChangePost({
      entity: 'Alaxione',
      from: 'revendiquee',
      to: 'retiree',
      url: LIEN_COURT,
    });
    expect(post).toContain('motif documenté au registre');
  });

  it('retrait : chaque motif de la taxonomie a une formule neutre (aucun blâme)', () => {
    const attendus: Record<MotifRetrait, string> = {
      retrait_demande_entite: 'à la demande de l’entité',
      contestation_fondee: 'contestation fondée',
      doublon: 'doublon d’une fiche existante',
      erreur_documentation: 'erreur de documentation',
      decision_editoriale: 'décision éditoriale',
    };
    for (const motif of MOTIFS_RETRAIT) {
      const post = renderStatusChangePost({
        entity: 'Alaxione',
        from: 'revendiquee',
        to: 'retiree',
        motif,
        url: LIEN_COURT,
      });
      expect(post).toContain(attendus[motif]);
      expect(post.length).toBeLessThanOrEqual(260);
    }
  });

  it('changement de statut : golden — revendiquée → confirmée (Alaxione)', () => {
    expect(
      renderStatusChangePost({
        entity: 'Alaxione',
        from: 'revendiquee',
        to: 'confirmee',
        url: 'https://francepassoire.com/f/alaxione-20260820',
      }),
    ).toBe(
      'Mise à jour : la fiche Alaxione passe de « revendiquée » à « confirmée » après vérification d’une source officielle. https://francepassoire.com/f/alaxione-20260820',
    );
  });

  it('teaser hebdo : golden — 12 fiches, 3 400 000 personnes', () => {
    expect(renderWeeklyDigestTeaser({ fiches: 12, personnes: 3_400_000 })).toBe(
      'Cette semaine sur FrancePassoire : 12 fiches et 3 400 000 personnes concernées. Le détail par fiche : https://francepassoire.com',
    );
  });

  it('teaser hebdo : 0, 1 et grands nombres — accords et séparateurs français', () => {
    const vide = renderWeeklyDigestTeaser({ fiches: 0, personnes: 0 });
    expect(vide).toContain('0 fiche');
    expect(vide).toContain('0 personne concernée');
    const unite = renderWeeklyDigestTeaser({ fiches: 1, personnes: 1 });
    expect(unite).toContain('1 fiche');
    expect(unite).toContain('1 personne concernée');
    const grand = renderWeeklyDigestTeaser({ fiches: 999_999_999, personnes: 2_100_000_000 });
    expect(grand).toContain('999 999 999 fiches');
    expect(grand).toContain('2 100 000 000 personnes concernées');
    expect(grand.length).toBeLessThanOrEqual(260);
  });

  it('longueur : batterie pire-cas (entité 63 caractères + volume long + lien) — tout ≤ 260', () => {
    const posts: string[] = [
      renderNewFichePost({ entity: ENTITE_PIRE_CAS, statut: 'confirmee', volumeLabel: VOLUME_LONG, url: LIEN_COURT }),
      renderNewFichePost({ entity: ENTITE_PIRE_CAS, statut: 'revendiquee', volumeLabel: VOLUME_LONG, url: LIEN_COURT }),
      renderStatusChangePost({ entity: ENTITE_PIRE_CAS, from: 'revendiquee', to: 'confirmee', url: LIEN_COURT }),
      renderStatusChangePost({
        entity: ENTITE_PIRE_CAS,
        from: 'revendiquee',
        to: 'retiree',
        motif: 'retrait_demande_entite',
        url: LIEN_COURT,
      }),
      renderStatusChangePost({ entity: ENTITE_PIRE_CAS, from: 'confirmee', to: 'retiree', motif: 'doublon', url: LIEN_COURT }),
      renderWeeklyDigestTeaser({ fiches: 999_999_999, personnes: 2_100_000_000 }),
    ];
    expect(posts).toHaveLength(6);
    for (const post of posts) {
      expect(post.length).toBeLessThanOrEqual(260);
    }
  });

  it('dépassement : entrée démesurée → throw en français mentionnant la limite', () => {
    const entiteDebordante = 'A'.repeat(240);
    expect(() =>
      renderNewFichePost({
        entity: entiteDebordante,
        statut: 'confirmee',
        volumeLabel: VOLUME_LONG,
        url: LIEN_COURT,
      }),
    ).toThrow(/260/);
    expect(() =>
      renderStatusChangePost({ entity: entiteDebordante, from: 'revendiquee', to: 'confirmee', url: LIEN_COURT }),
    ).toThrow(/260/);
  });

  it('tonalité : aucun mot alarmiste, pas de « !! », au plus un « ! » — sur toute la batterie', () => {
    const posts = [
      renderNewFichePost(ficheConfirmee()),
      renderNewFichePost({ ...ficheConfirmee(), statut: 'revendiquee' }),
      renderNewFichePost({ entity: ENTITE_PIRE_CAS, statut: 'confirmee', volumeLabel: VOLUME_LONG, url: LIEN_COURT }),
      ...(['revendiquee', 'confirmee'] as const).map((from) =>
        renderStatusChangePost({
          entity: 'Alaxione',
          from,
          to: 'retiree',
          motif: 'contestation_fondee',
          url: LIEN_COURT,
        }),
      ),
      renderStatusChangePost({ entity: 'Alaxione', from: 'revendiquee', to: 'confirmee', url: LIEN_COURT }),
      renderWeeklyDigestTeaser({ fiches: 0, personnes: 0 }),
      renderWeeklyDigestTeaser({ fiches: 12, personnes: 3_400_000 }),
    ];
    for (const post of posts) {
      for (const mot of MOTS_ALARMISTES) {
        expect(post.toLowerCase()).not.toContain(mot);
      }
      expect(post).not.toContain('!!');
      expect(compterExclamations(post)).toBeLessThanOrEqual(1);
    }
  });

  it('empilement « !! » injecté via un champ → rejet (fail-closed sur la tonalité)', () => {
    expect(() =>
      renderNewFichePost({ ...ficheConfirmee(), volumeLabel: '900 000 patients !!' }),
    ).toThrow(/empilés/);
  });

  it('déterminisme : mêmes entrées, deux appels → chaînes identiques', () => {
    const fiche = ficheConfirmee();
    expect(renderNewFichePost(fiche)).toBe(renderNewFichePost(fiche));
    const revendiquee = { ...fiche, statut: 'revendiquee' as const };
    expect(renderNewFichePost(revendiquee)).toEqual(renderNewFichePost(revendiquee));
    const changement: StatusChangeInput = {
      entity: 'Alaxione',
      from: 'revendiquee',
      to: 'confirmee',
      url: LIEN_COURT,
    };
    expect(renderStatusChangePost(changement)).toBe(renderStatusChangePost(changement));
    const stats = { fiches: 12, personnes: 3_400_000 };
    expect(renderWeeklyDigestTeaser(stats)).toBe(renderWeeklyDigestTeaser(stats));
  });

  it('nouvelle fiche : statut « retiree » impossible (une fiche ne naît pas retirée)', () => {
    const statutBogus: Statut = 'retiree';
    expect(() =>
      renderNewFichePost({ ...ficheConfirmee(), statut: statutBogus as NewFicheInput['statut'] }),
    ).toThrow(/ne naît jamais retirée/);
  });

  it('champs vides ou statistiques invalides → rejet en français', () => {
    expect(() => renderNewFichePost({ ...ficheConfirmee(), entity: '   ' })).toThrow(/entité/);
    expect(() => renderNewFichePost({ ...ficheConfirmee(), volumeLabel: '' })).toThrow(/volume/);
    expect(() => renderNewFichePost({ ...ficheConfirmee(), url: '  ' })).toThrow(/url/);
    expect(() => renderWeeklyDigestTeaser({ fiches: -1, personnes: 0 })).toThrow(/entiers/);
    expect(() => renderWeeklyDigestTeaser({ fiches: 1.5, personnes: 0 })).toThrow(/entiers/);
  });
});

// Gabarit social propriétaire (23/08) : structure owner exacte, LONG + COURT.
describe('renderSocialPost / renderSocialPostCourt — gabarit propriétaire', () => {
  const actua = {
    entity: 'Actua',
    secteur: 'services',
    statut: 'revendiquee',
    volumeLabel: 'plus de 100 000 personnes recrutées selon LockBit 5.0 ; passeports annoncés',
    description: "Le 22 août 2026, le groupe LockBit 5.0 revendique une attaque contre Actua, groupe français de recrutement. Les cybercrimiels annoncent la diffusion de documents.",
    url: 'https://francepassoire.com/fiche/actua-20260822/',
    imageUrl: 'https://francepassoire.com/fiche/actua-20260822/card.jpg',
    group: 'LockBit',
  };

  it('LONG : structure exacte (en-tête, faits, résumé verbatim, CTA, URL, hashtags)', () => {
    const post = renderSocialPost(actua);
    expect(post.startsWith('🚨 📣 Nouvelle fuite recensée : Actua (Services)')).toBe(true);
    expect(post).toContain('Statut : Revendiquée');
    expect(post).toContain('Volume : plus de 100 000 personnes recrutées selon LockBit 5.0');
    expect(post).toContain(actua.description);
    expect(post).toContain(CTA_LONG);
    expect(post).toContain(actua.url);
    expect(post).toContain('#LockBit');
    expect(post).toContain('#Actua');
    expect(post).toContain('#FuiteDeDonnées');
  });

  it('LONG : hashtags fixes tous présents', () => {
    const post = renderSocialPost(actua);
    for (const h of ['#FrancePassoire', '#DataLeaks', '#Rancongiciel', '#cybersecurite', '#cyberattaque', '#piratageinformatique']) {
      expect(post).toContain(h);
    }
  });

  it('COURT : sans résumé, volume sans clause « selon », ≤ 280, CTA court, URL', () => {
    const post = renderSocialPostCourt(actua);
    expect(post.startsWith('🚨📣 Nouvelle fuite recensée : Actua (Services)')).toBe(true);
    expect(post).toContain('Volume : plus de 100 000 personnes recrutées');
    expect(post).not.toContain('selon LockBit');
    expect(post).not.toContain(actua.description);
    expect(post).toContain(CTA_COURT);
    expect(post).toContain(actua.url);
    expect(post.length).toBeLessThanOrEqual(280);
  });

  it('COURT : dépassement 280 → refus explicite', () => {
    expect(() =>
      renderSocialPostCourt({
        ...actua,
        entity: 'Une Entité Au Nom Beaucoup Trop Long Pour Tenir Dans La Limite De Caracteres De X',
        volumeLabel: 'un volume extraordinairement long qui ne tiendra jamais dans les deux cent quatre-vingts caracteres de la limite X',
      }),
    ).toThrow(SocialTemplateError);
  });

  it('LONG : description vide → refus, jamais d’improvisation', () => {
    expect(() => renderSocialPost({ ...actua, description: '   ' })).toThrow();
  });

  it('LONG revendiquée : porte la mention EXACTE (garde du drain social)', () => {
    expect(renderSocialPost(actua)).toContain(`Statut : Revendiquée (${MENTION_EXACTE})`);
  });

  it('LONG confirmée : ligne Statut sobre, sans la mention (rien à nuancer)', () => {
    const post = renderSocialPost({ ...actua, statut: 'confirmee' });
    expect(post).toContain('Statut : Confirmée');
    expect(post).not.toContain(MENTION_EXACTE);
  });
});
