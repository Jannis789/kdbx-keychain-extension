import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from './settings';

describe('mergeSettings', () => {
  it('patched nur übergebene Felder', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { autoLockMinutes: 5 });
    expect(merged.autoLockMinutes).toBe(5);
    expect(merged.remotePath).toBe(DEFAULT_SETTINGS.remotePath);
  });

  it('lehnt ungültige Minuten ab (NaN aus leerem Zahlenfeld, Brüche, Extremwerte)', () => {
    expect(() => mergeSettings(DEFAULT_SETTINGS, { autoLockMinutes: Number.NaN })).toThrow(/Auto-Lock/);
    expect(() => mergeSettings(DEFAULT_SETTINGS, { autoLockMinutes: 15.6 })).toThrow(/Auto-Lock/);
    expect(() => mergeSettings(DEFAULT_SETTINGS, { autoLockMinutes: -1 })).toThrow(/Auto-Lock/);
    expect(() => mergeSettings(DEFAULT_SETTINGS, { autoLockMinutes: 1441 })).toThrow(/Auto-Lock/);
  });

  it('akzeptiert die Grenzen 0 (= nie) und 1440', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { autoLockMinutes: 0 }).autoLockMinutes).toBe(0);
    expect(mergeSettings(DEFAULT_SETTINGS, { autoLockMinutes: 1440 }).autoLockMinutes).toBe(1440);
  });

  it('lehnt Pfade ohne führenden Slash ab, statt sie umzuschreiben', () => {
    expect(() => mergeSettings(DEFAULT_SETTINGS, { remotePath: 'kdbx/test.kdbx' })).toThrow(/Dropbox-Pfad/);
    expect(() => mergeSettings(DEFAULT_SETTINGS, { remotePath: '   ' })).toThrow(/Dropbox-Pfad/);
  });
});
