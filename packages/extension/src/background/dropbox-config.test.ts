import { describe, expect, it } from 'vitest';
import {
  hasResolvedAppKey,
  resolvedAppKey,
  resolvedAppSecret,
  resolvedRefreshToken,
  resolvedRemotePath,
  setDropboxAppConfigCache,
  setDropboxManagedConfigCache,
} from './dropbox-config';

describe('Resolution-Order (ADR-012)', () => {
  it('Options-Pflege schlägt Host-Deploy; leeres Feld fällt zurück', () => {
    setDropboxManagedConfigCache({
      appKey: 'managed-key',
      appSecret: 'managed-secret',
      refreshToken: 'rt-host',
      remotePath: '/host.kdbx',
    });
    setDropboxAppConfigCache({ appKey: 'local-key', appSecret: '' });
    expect(resolvedAppKey()).toBe('local-key');
    expect(resolvedAppSecret()).toBe('managed-secret');
    expect(hasResolvedAppKey()).toBe(true);
  });

  it('ohne beide Stufen: leer, kein App-Key', () => {
    setDropboxAppConfigCache({ appKey: '', appSecret: '' });
    setDropboxManagedConfigCache({ appKey: '', appSecret: '', refreshToken: '', remotePath: '' });
    expect(resolvedAppKey()).toBe('');
    expect(hasResolvedAppKey()).toBe(false);
    expect(resolvedRefreshToken()).toBe('');
    expect(resolvedRemotePath()).toBe('');
  });

  it('refreshToken/remotePath kommen ausschließlich vom Host', () => {
    setDropboxAppConfigCache({ appKey: 'local-key', appSecret: 'local-secret' });
    setDropboxManagedConfigCache({
      appKey: 'managed-key',
      appSecret: '',
      refreshToken: 'rt-host',
      remotePath: '/host.kdbx',
    });
    expect(resolvedRefreshToken()).toBe('rt-host');
    expect(resolvedRemotePath()).toBe('/host.kdbx');
  });
});
