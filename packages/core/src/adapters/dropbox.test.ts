import { describe, expect, it } from 'vitest';
import {
  buildAuthUrl,
  DropboxCloud,
  exchangeCode,
  generatePkce,
} from './dropbox';
import { subtle } from '../model/totp';

/** Fake-fetch: erste passende Route gewinnt. */
function router(routes: Array<{ match: string; handle: (url: string, init?: RequestInit) => Response }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, ...(init ? { init } : {}) });
    const route = routes.find((r) => u.includes(r.match));
    if (!route) throw new Error(`keine Route für ${u}`);
    return route.handle(u, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const jsonRes = (body: unknown, status = 200, headers?: Record<string, string>): Response =>
  new Response(JSON.stringify(body), { status, ...(headers ? { headers } : {}) });

describe('PKCE', () => {
  it('verifier/challenge erzeugen; challenge = S256(verifier)', async () => {
    const pkce = await generatePkce();
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    const digest = await subtle().digest('SHA-256', new TextEncoder().encode(pkce.verifier));
    let b64 = '';
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const bytes = new Uint8Array(digest);
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i]!, b1 = bytes[i + 1] ?? 0, b2 = bytes[i + 2] ?? 0;
      b64 += B64[b0 >> 2]! + B64[((b0 & 3) << 4) | (b1 >> 4)]!;
      if (i + 1 < bytes.length) b64 += B64[((b1 & 15) << 2) | (b2 >> 6)];
      if (i + 2 < bytes.length) b64 += B64[b2 & 63];
    }
    expect(pkce.challenge).toBe(b64);
  });

  it('Auth-URL enthält PKCE-Parameter und offline-Token', async () => {
    const pkce = await generatePkce();
    const url = buildAuthUrl({ appKey: 'mykey', redirectUri: 'https://cb', pkce });
    expect(url).toContain('client_id=mykey');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('token_access_type=offline');
    expect(url).toContain(`code_challenge=${pkce.challenge}`);
  });

  it('exchangeCode sendet code_verifier und NIEMALS client_secret', async () => {
    const { impl, calls } = router([
      {
        match: '/oauth2/token',
        handle: () => jsonRes({ access_token: 'at', refresh_token: 'rt', expires_in: 100 }),
      },
    ]);
    const t = await exchangeCode({
      appKey: 'k',
      code: 'abc',
      redirectUri: 'https://cb',
      codeVerifier: 'v',
      fetchImpl: impl,
    });
    expect(t.accessToken).toBe('at');
    const body = String((calls[0]!.init?.body ?? '') as URLSearchParams);
    expect(body).toContain('code_verifier=v');
    expect(body).not.toContain('client_secret');
  });
});

describe('DropboxCloud', () => {
  const makeCloud = (
    routes: Array<{ match: string; handle: (u: string, i?: RequestInit) => Response }>,
    nowFn: () => number = () => 1_000_000,
  ) => {
    const { impl, calls } = router(routes);
    const refreshed: Array<{ accessToken: string; refreshToken: string; expiresAt: number }> = [];
    const cloud = new DropboxCloud({
      appKey: 'k',
      refreshToken: 'rt-1',
      fetchImpl: impl,
      now: nowFn,
      onTokenRefreshed: (t) => refreshed.push(t),
    });
    return { cloud, calls, refreshed };
  };

  const tokenRoute = () => ({
    match: '/oauth2/token',
    handle: () => jsonRes({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }),
  });

  it('refresh beim ersten Zugriff; danach gecacht', async () => {
    const { cloud, calls, refreshed } = makeCloud([
      tokenRoute(),
      { match: 'files/download', handle: () => new Response(new Uint8Array([1]), { headers: { 'dropbox-api-result': '{"rev":"r"}' } }) },
    ]);
    await cloud.fetchLatest('/x');
    const tokenCalls = calls.filter((c) => c.url.includes('/oauth2/token'));
    expect(tokenCalls).toHaveLength(1);
    expect(refreshed).toHaveLength(1);
    expect(String(tokenCalls[0]!.init!.body)).toContain('refresh_token=rt-1');
    expect(String(tokenCalls[0]!.init!.body)).toContain('client_id=k');
  });

  it('fetchLatest liefert bytes + rev aus dropbox-api-result', async () => {
    const { cloud } = makeCloud([
      tokenRoute(),
      {
        match: 'files/download',
        handle: () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'dropbox-api-result': '{"rev":"abc"}' },
          }),
      },
    ]);
    const r = await cloud.fetchLatest('kdbx/test.kdbx');
    expect(Array.from(r.bytes)).toEqual([1, 2, 3]);
    expect(r.rev).toBe('abc');
  });

  it('putIfUnchanged: Erfolg mit neuer rev', async () => {
    const { cloud, calls } = makeCloud([
      tokenRoute(),
      { match: 'files/upload', handle: () => jsonRes({ rev: 'def' }) },
    ]);
    const r = await cloud.putIfUnchanged('p', new Uint8Array([9]), 'abc');
    expect(r).toEqual({ ok: true, newRev: 'def' });
    const arg = ((calls.find((c) => c.url.includes('files/upload'))!.init?.headers ?? {}) as Record<string, string>)['Dropbox-API-Arg'] ?? '{}';
    expect(JSON.parse(arg).mode).toEqual({ '.tag': 'update', update: 'abc' });
  });

  it('putIfUnchanged: 409 → Konflikt mit currentRev (kein Overwrite)', async () => {
    const { cloud } = makeCloud([
      tokenRoute(),
      { match: 'files/upload', handle: () => jsonRes({ error_summary: 'conflict/' }, 409) },
      { match: 'files/get_metadata', handle: () => jsonRes({ rev: 'xyz' }) },
    ]);
    const r = await cloud.putIfUnchanged('p', new Uint8Array([9]), 'abc');
    expect(r).toEqual({ ok: false, reason: 'conflict', currentRev: 'xyz' });
  });

  it('abgelaufener Token wird vor dem Call refreshed', async () => {
    let now = 0;
    const { cloud, calls } = makeCloud(
      [tokenRoute(), { match: 'files/download', handle: () => new Response(new Uint8Array([1]), { headers: { 'dropbox-api-result': '{"rev":"r"}' } }) }],
      () => now,
    );
    await cloud.fetchLatest('/x');
    now = 10_000_000; // weit über expiresAt → erneuter Refresh
    await cloud.fetchLatest('/x');
    expect(calls.filter((c) => c.url.includes('/oauth2/token'))).toHaveLength(2);
  });
});
