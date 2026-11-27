import { describe, expect, it } from 'vitest';
import {
  hasResolvedAppKey,
  mergeDropboxAppConfig,
  resolvedAppKey,
  resolvedAppSecret,
  resolvedRefreshToken,
  resolvedRemotePath,
  setDropboxAppConfigCache,
  setDropboxManagedConfigCache,
} from './dropbox-config';

describe('mergeDropboxAppConfig', () => {
  const base = { appKey: 'k1', appSecret: 's1' };

  it('übernimmt gesetzte Felder und trimmt eingefügten Whitespace', () => {
    expect(mergeDropboxAppConfig(base, { appKey: ' k2\n' })).toEqual({ appKey: 'k2', appSecret: 's1' });
  });

  it('leere Strings löschen — die nächste Stufe (managed) greift', () => {
    expect(mergeDropboxAppConfig(base, { appKey: '' })).toEqual({ appKey: '', appSecret: 's1' });
  });
});

describe('Resolution-Order (ADR-012)', () => {
  it('Options-Pflege schlägt Host-Deploy; leer fällt zurück', () => {
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

    setDropboxAppConfigCache({ appKey: '', appSecret: '' });
    expect(resolvedAppKey()).toBe('managed-key');
  });

  it('ohne beide Stufen: leer, kein App-Key', () => {
    setDropboxAppConfigCache({ appKey: '', appSecret: '' });
    setDropboxManagedConfigCache({
      appKey: '',
      appSecret: '',
      refreshToken: '',
      remotePath: '',
    });
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
