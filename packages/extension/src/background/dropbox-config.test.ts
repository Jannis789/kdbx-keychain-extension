import { beforeEach, describe, expect, it } from 'vitest';
import {
  hasResolvedAppKey,
  loadDropboxAppConfig,
  resolvedAppKey,
  resolvedAppSecret,
  resolvedRefreshToken,
  resolvedRemotePath,
} from './dropbox-config';

const STORAGE_KEY = 'kdbx.dropboxApp';

/** Minimal-attrappe: managed im Callback-Stil, local im Promise-Stil (wie im Code). */
function stubChrome(managed: Record<string, unknown>, local: Record<string, unknown>): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { lastError: undefined },
    storage: {
      managed: { get: (_keys: string[], cb: (r: Record<string, unknown>) => void) => cb(managed) },
      local: { get: async () => local },
    },
  };
}

describe('loadDropboxAppConfig + Resolution (ADR-012)', () => {
  beforeEach(() => stubChrome({}, {}));

  it('Options-Pflege schlägt Host-Deploy; leeres Feld fällt zurück', async () => {
    stubChrome(
      { appKey: 'host-key', appSecret: 'host-secret', refreshToken: 'rt-host', remotePath: '/h.kdbx' },
      { [STORAGE_KEY]: { appKey: 'local-key', appSecret: '' } },
    );
    await loadDropboxAppConfig();
    expect(resolvedAppKey()).toBe('local-key');
    expect(resolvedAppSecret()).toBe('host-secret');
    expect(hasResolvedAppKey()).toBe(true);
  });

  it('refreshToken/remotePath kommen ausschließlich vom Host', async () => {
    stubChrome(
      { appKey: '', appSecret: '', refreshToken: 'rt-host', remotePath: '/h.kdbx' },
      { [STORAGE_KEY]: { appKey: 'local-key', appSecret: 'local-secret' } },
    );
    await loadDropboxAppConfig();
    expect(resolvedRefreshToken()).toBe('rt-host');
    expect(resolvedRemotePath()).toBe('/h.kdbx');
  });

  it('ohne beides: leer, kein App-Key', async () => {
    await loadDropboxAppConfig();
    expect(resolvedAppKey()).toBe('');
    expect(resolvedAppSecret()).toBe('');
    expect(resolvedRefreshToken()).toBe('');
    expect(resolvedRemotePath()).toBe('');
    expect(hasResolvedAppKey()).toBe(false);
  });
});
