import { describe, expect, it, vi } from 'vitest';
import { send } from '../workers/social/clients/facebook';
import type { Env, PostPayload } from '../workers/social/src/types';

// Client Page Facebook — T51 : Graph API /feed rejouée par fetch injecté
// (aucun réseau). Les erreurs Graph arrivent en JSON {error:{code,message}}.
const envAvecCles = {
  FB_PAGE_ID: '1234567890',
  FB_PAGE_TOKEN: 'EAAG-test-page-token',
} as Env;

const URL_FICHE = 'https://francepassoire.com/f/alaxione-20260820';
const payload: PostPayload = {
  text: `Nouvelle fiche confirmée : Alaxione — 900 000 patients. Sources et détails : ${URL_FICHE}`,
  url: URL_FICHE,
  statut: 'confirmee',
};

function reponseGraph(
  status: number,
  corps: unknown,
): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(corps), { status }),
  ) as unknown as typeof fetch;
}

describe('client Facebook Page — POST /{page-id}/feed (T51)', () => {
  it('200 {id} → SENT avec l’id du post, message et link embarqués, token en clair du corps', async () => {
    let urlVue = '';
    let corpsVu: Record<string, unknown> = {};
    const fetchFn = vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      urlVue = String(u);
      corpsVu = JSON.parse(String(init?.body));
      return new Response('{"id":"1234567890_999888777"}', { status: 200 });
    });

    const r = await send(payload, envAvecCles, fetchFn as unknown as typeof fetch);

    expect(r).toEqual({ status: 'SENT', externalId: '1234567890_999888777' });
    expect(urlVue).toBe('https://graph.facebook.com/v21.0/1234567890/feed');
    // L'URL est déjà dans le texte → le message n'est PAS doublé du lien.
    expect(corpsVu.message).toBe(payload.text);
    expect(corpsVu.link).toBe(URL_FICHE);
    expect(corpsVu.access_token).toBe('EAAG-test-page-token');
  });

  it('texte sans URL → le message embarque l’URL de la fiche (ajoutée en fin)', async () => {
    let corpsVu: Record<string, unknown> = {};
    const fetchFn = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      corpsVu = JSON.parse(String(init?.body));
      return new Response('{"id":"1_2"}', { status: 200 });
    });
    const sansUrl: PostPayload = { ...payload, text: 'Fuite confirmée chez Test — 10 000 comptes.' };
    const r = await send(sansUrl, envAvecCles, fetchFn as unknown as typeof fetch);
    expect(r.status).toBe('SENT');
    expect(corpsVu.message).toBe(`Fuite confirmée chez Test — 10 000 comptes. ${URL_FICHE}`);
  });

  it('FB_PAGE_ID + FB_PAGE_TOKEN absents → PENDING_KEYS, aucun appel', async () => {
    const fetchFn = vi.fn();
    const r = await send(payload, {} as Env, fetchFn as unknown as typeof fetch);
    expect(r.status).toBe('PENDING_KEYS');
    if (r.status === 'PENDING_KEYS') {
      expect(r.reason).toContain('FB_PAGE_ID');
      expect(r.reason).toContain('FB_PAGE_TOKEN');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('token mort (code 190) → ERROR PERMANENT, raison « token Page mort »', async () => {
    const fetchFn = reponseGraph(400, {
      error: { message: 'Session has expired', code: 190, type: 'OAuthException' },
    });
    const r = await send(payload, envAvecCles, fetchFn as unknown as typeof fetch);
    expect(r.status).toBe('ERROR');
    if (r.status === 'ERROR') {
      expect(r.retryable).toBe(false);
      expect(r.reason).toContain('token Page mort');
    }
  });

  it('limite de débit (code 4) → ERROR REJOUABLE (prochain cron)', async () => {
    const fetchFn = reponseGraph(400, {
      error: {
        message: 'Application request limit reached',
        code: 4,
        type: 'OAuthException',
      },
    });
    const r = await send(payload, envAvecCles, fetchFn as unknown as typeof fetch);
    expect(r).toMatchObject({ status: 'ERROR', retryable: true });
  });

  it('corps d’erreur non JSON (400 HTML) → ERROR PERMANENT sans crash', async () => {
    const fetchFn = vi.fn(
      async () => new Response('<html>Bad Request</html>', { status: 400 }),
    );
    const r = await send(payload, envAvecCles, fetchFn as unknown as typeof fetch);
    expect(r).toMatchObject({ status: 'ERROR', retryable: false });
  });
});
