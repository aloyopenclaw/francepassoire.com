import { describe, expect, it, vi } from 'vitest';
import { send } from '../workers/social/clients/make-x';
import type { Env, PostPayload } from '../workers/social/src/types';

// Client X via Make (webhook) — T51 : mêmes disciplines que
// tests/social-make-linkedin.ts (aucun réseau, fetch injecté).
const envAvecUrl = { MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/test-x' } as Env;
const payload: PostPayload = {
  text: 'Fuite confirmée chez Test — 10 000 comptes. https://francepassoire.com/fiche/x',
  url: 'https://francepassoire.com/fiche/x',
  statut: 'confirmee',
};

describe('client X via Make (webhook) — T51', () => {
  it('2xx → SENT (remise au scénario Make, publication en aval)', async () => {
    const fetchFn = vi.fn(async () => new Response('{"status":"ok"}', { status: 200 }));
    const r = await send(payload, envAvecUrl, fetchFn as unknown as typeof fetch);
    expect(r.status).toBe('SENT');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('MAKE_WEBHOOK_URL absent → PENDING_KEYS, aucun appel', async () => {
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

  it('le corps embarque text, url et request_id (pas de champ statut)', async () => {
    let corps: Record<string, unknown> = {};
    const fetchFn = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      corps = JSON.parse(String(init?.body));
      return new Response('{"status":"ok"}', { status: 200 });
    });
    await send(
      { ...payload, metadata: { request_id: 'abc-123' } },
      envAvecUrl,
      fetchFn as unknown as typeof fetch,
    );
    expect(corps).toEqual({
      text: payload.text,
      url: payload.url,
      request_id: 'abc-123',
    });
  });
});
