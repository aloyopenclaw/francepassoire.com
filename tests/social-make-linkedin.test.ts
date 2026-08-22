import { describe, expect, it, vi } from 'vitest';
import { send } from '../workers/social/clients/make-linkedin';
import type { Env, PostPayload } from '../workers/social/src/types';

const envAvecUrl = { LINKEDIN_WEBHOOK_URL: 'https://hook.eu1.make.com/test-li' } as Env;
const payload: PostPayload = {
  text: 'Fuite confirmée chez Test — 10 000 comptes. https://francepassoire.com/fiche/x',
  url: 'https://francepassoire.com/fiche/x',
  statut: 'confirmee',
};

describe('client LinkedIn via Make (webhook)', () => {
  it('2xx → SENT (remise au scénario Make, approbation en aval)', async () => {
    const fetchFn = vi.fn(async () => new Response('{"status":"pending_approval"}', { status: 200 }));
    const r = await send(payload, envAvecUrl, fetchFn as unknown as typeof fetch);
    expect(r.status).toBe('SENT');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('LINKEDIN_WEBHOOK_URL absent → PENDING_KEYS, aucun appel', async () => {
    const fetchFn = vi.fn();
    const r = await send(payload, {} as Env, fetchFn as unknown as typeof fetch);
    expect(r.status).toBe('PENDING_KEYS');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('410 (scénario éteint) → ERROR permanent', async () => {
    const fetchFn = vi.fn(async () => new Response('gone', { status: 410 }));
    const r = await send(payload, envAvecUrl, fetchFn as unknown as typeof fetch);
    expect(r).toMatchObject({ status: 'ERROR', retryable: false });
  });

  it('500 → ERROR rejouable (prochain cron)', async () => {
    const fetchFn = vi.fn(async () => new Response('boom', { status: 500 }));
    const r = await send(payload, envAvecUrl, fetchFn as unknown as typeof fetch);
    expect(r).toMatchObject({ status: 'ERROR', retryable: true });
  });

  it('le corps embarque text, url, statut et request_id', async () => {
    let corps: Record<string, unknown> = {};
    const fetchFn = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      corps = JSON.parse(String(init?.body));
      return new Response('{"status":"pending_approval"}', { status: 200 });
    });
    await send(
      { ...payload, metadata: { request_id: 'abc-123' } },
      envAvecUrl,
      fetchFn as unknown as typeof fetch,
    );
    expect(corps).toMatchObject({ text: payload.text, url: payload.url, statut: 'confirmee', request_id: 'abc-123' });
  });
});
