import { describe, expect, it, vi } from 'vitest';
import { __test, send } from '../workers/social/clients/instagram';
import type { Env, PostPayload } from '../workers/social/src/types';

// Client Instagram — T51 : Content Publishing en deux temps (conteneur
// /media → publication /media_publish), fetch injecté en séquence stricte.
const envAvecCles = {
  IG_USER_ID: '17841400000000',
  FB_PAGE_TOKEN: 'EAAG-test-page-token',
} as Env;

const URL_FICHE = 'https://francepassoire.com/f/alaxione-20260820';
const CARTE_ATTENDUE = 'https://francepassoire.com/fiche/alaxione-20260820/card.jpg';

const payload: PostPayload = {
  text: `Nouvelle fiche confirmée : Alaxione — 900 000 patients. Sources et détails : ${URL_FICHE}`,
  url: URL_FICHE,
  statut: 'confirmee',
};

interface AppelVu {
  url: string;
  corps: Record<string, unknown>;
}

/** fetch injecté rejouant une suite de réponses, dans l'ordre des appels. */
function fetchSeq(responses: Array<{ status: number; body: unknown }>): {
  fetchFn: typeof fetch;
  appels: () => AppelVu[];
} {
  const vus: AppelVu[] = [];
  let i = 0;
  const fetchFn = (async (u: string | URL | Request, init?: RequestInit) => {
    const la = vus.push({ url: String(u), corps: JSON.parse(String(init?.body)) });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    void la;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { fetchFn, appels: () => vus };
}

describe('client Instagram — deux temps /media + /media_publish (T51)', () => {
  it('happy path : conteneur créé puis publié, creation_id transmise à l\'étape 2, carte fiche en image_url', async () => {
    const { fetchFn, appels } = fetchSeq([
      { status: 200, body: { id: '17900000000000000' } },
      { status: 200, body: { id: 'igmedia-42' } },
    ]);

    const r = await send(payload, envAvecCles, fetchFn);

    expect(r).toEqual({ status: 'SENT', externalId: 'igmedia-42' });
    expect(appels()).toHaveLength(2);

    const [etape1, etape2] = appels();
    expect(etape1.url).toBe('https://graph.facebook.com/v21.0/17841400000000/media');
    expect(etape1.corps.image_url).toBe(CARTE_ATTENDUE);
    expect(etape1.corps.caption).toBe(payload.text);
    expect(etape1.corps.access_token).toBe('EAAG-test-page-token');

    expect(etape2.url).toBe('https://graph.facebook.com/v21.0/17841400000000/media_publish');
    expect(etape2.corps.creation_id).toBe('17900000000000000');
  });

  it('URL /fiche/<slug> acceptée aussi pour la carte', async () => {
    const { fetchFn, appels } = fetchSeq([
      { status: 200, body: { id: 'c1' } },
      { status: 200, body: { id: 'm1' } },
    ]);
    const r = await send(
      { ...payload, url: 'https://francepassoire.com/fiche/alaxione-20260820/' },
      envAvecCles,
      fetchFn,
    );
    expect(r.status).toBe('SENT');
    expect(appels()[0]?.corps.image_url).toBe(CARTE_ATTENDUE);
  });

  it('IG_USER_ID + FB_PAGE_TOKEN absents → PENDING_KEYS, aucun appel', async () => {
    const fetchFn = vi.fn();
    const r = await send(payload, {} as Env, fetchFn as unknown as typeof fetch);
    expect(r.status).toBe('PENDING_KEYS');
    if (r.status === 'PENDING_KEYS') {
      expect(r.reason).toContain('IG_USER_ID');
      expect(r.reason).toContain('FB_PAGE_TOKEN');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('étape 1 en échec permanent (code 190) → ERROR permanent, étape 2 JAMAIS appelée', async () => {
    const { fetchFn, appels } = fetchSeq([
      { status: 400, body: { error: { message: 'Session expired', code: 190 } } },
      { status: 200, body: { id: 'ne-pas-voir' } },
    ]);
    const r = await send(payload, envAvecCles, fetchFn);
    expect(r.status).toBe('ERROR');
    if (r.status === 'ERROR') {
      expect(r.retryable).toBe(false);
      expect(r.reason).toContain('/media →');
    }
    expect(appels()).toHaveLength(1);
  });

  it('étape 2 en échec 4xx → ERROR permanent (conteneur créé, publication refusée)', async () => {
    const { fetchFn, appels } = fetchSeq([
      { status: 200, body: { id: '17900000000000000' } },
      {
        status: 400,
        body: { error: { message: 'Invalid parameter', code: 100 } },
      },
    ]);
    const r = await send(payload, envAvecCles, fetchFn);
    expect(r.status).toBe('ERROR');
    if (r.status === 'ERROR') {
      expect(r.retryable).toBe(false);
      expect(r.reason).toContain('/media_publish →');
    }
    expect(appels()).toHaveLength(2);
  });

  it('limite de débit (code 4) à l\'étape 1 → ERROR rejouable', async () => {
    const { fetchFn } = fetchSeq([
      { status: 400, body: { error: { message: 'Request limit reached', code: 4 } } },
    ]);
    const r = await send(payload, envAvecCles, fetchFn);
    expect(r).toMatchObject({ status: 'ERROR', retryable: true });
  });
});

describe('client Instagram — garde-taille caption (T51)', () => {
  it('caption > 2200 caractères → tronquée à 2200 exactement', () => {
    const long: PostPayload = {
      ...payload,
      text: `${'a'.repeat(2500)} ${URL_FICHE}`,
    };
    expect(__test.limiterCaption(long).length).toBe(__test.CAPTION_MAX);
  });

  it('plus de 30 hashtags → seuls les 30 premiers survivent', () => {
    const hashtags = Array.from({ length: 40 }, (_, i) => `#mot${String(i)}`).join(' ');
    const bourre: PostPayload = { ...payload, text: `${hashtags} ${URL_FICHE}` };
    const caption = __test.limiterCaption(bourre);
    expect((caption.match(/#\w+/g) ?? []).length).toBe(__test.HASHTAGS_MAX);
    expect(caption).toContain('#mot0');
    expect(caption).toContain('#mot29');
    expect(caption).not.toContain('#mot30');
  });

  it('caption conforme → inchangée (URL déjà présente, pas de découpe)', () => {
    expect(__test.limiterCaption(payload)).toBe(payload.text);
  });

  it('URL de fiche inexploitable → UNSUPPORTED_PAYLOAD, aucun appel', async () => {
    const fetchFn = vi.fn();
    const r = await send(
      { ...payload, url: 'pas-une-url' },
      envAvecCles,
      fetchFn as unknown as typeof fetch,
    );
    expect(r).toMatchObject({ status: 'UNSUPPORTED_PAYLOAD' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
