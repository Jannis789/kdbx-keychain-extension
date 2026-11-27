import { describe, expect, it } from 'vitest';
import {
  hasResolvedAppKey,
  mergeDropboxAppConfig,
  parseDropboxAppConfig,
  resolvedAppKey,
  setDropboxAppConfigCache,
} from './dropbox-config';

describe('parseDropboxAppConfig', () => {
  it('normalisiert beliebige Fragmente defensiv', () => {
    expect(parseDropboxAppConfig(undefined)).toEqual({ appKey: '', appSecret: '' });
    expect(parseDropboxAppConfig({ appKey: ' abc ', appSecret: 42 })).toEqual({ appKey: 'abc', appSecret: '' });
    expect(parseDropboxAppConfig('nope')).toEqual({ appKey: '', appSecret: '' });
  });
});

describe('mergeDropboxAppConfig', () => {
  const base = { appKey: 'k1', appSecret: 's1' };

  it('überschreibt gesetzte Felder und trimmt', () => {
    expect(mergeDropboxAppConfig(base, { appKey: ' k2 ' })).toEqual({ appKey: 'k2', appSecret: 's1' });
  });

  it('leere Strings löschen — Build-Fallback greift wieder', () => {
    expect(mergeDropboxAppConfig(base, { appKey: '' })).toEqual({ appKey: '', appSecret: 's1' });
  });
});

describe('Resolution-Order (ADR-012 > ADR-007)', () => {
  it('Storage schlägt Build-Default; leer fällt zurück', () => {
    setDropboxAppConfigCache({ appKey: 'stored-key', appSecret: '' });
    expect(resolvedAppKey()).toBe('stored-key');
    setDropboxAppConfigCache({ appKey: '', appSecret: '' });
    // Build-Injection ist in vitest undefiniert (typeof-Guard → '')
    expect(resolvedAppKey()).toBe('');
    expect(hasResolvedAppKey()).toBe(false);
  });
});
