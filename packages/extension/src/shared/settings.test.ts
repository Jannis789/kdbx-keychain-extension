import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, normalizeSettings } from './settings';

describe('normalizeSettings', () => {
  it('liefert Defaults für leere/korrupte Eingaben', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ autoLockMinutes: Number.NaN })).toEqual(DEFAULT_SETTINGS);
  });

  it('klammert Extremwerte (Minutes 0–1440, Sekunden 0–600)', () => {
    expect(normalizeSettings({ autoLockMinutes: 99_999 }).autoLockMinutes).toBe(1440);
    expect(normalizeSettings({ autoLockMinutes: -5 }).autoLockMinutes).toBe(0);
    expect(normalizeSettings({ clipboardClearSeconds: 5000 }).clipboardClearSeconds).toBe(600);
    expect(normalizeSettings({ clipboardClearSeconds: -1 }).clipboardClearSeconds).toBe(0);
  });

  it('rundet Bruchteile und erzwingt führenden Slash im Pfad', () => {
    expect(normalizeSettings({ autoLockMinutes: 15.6 }).autoLockMinutes).toBe(16);
    expect(normalizeSettings({ remotePath: 'kdbx/test.kdbx' }).remotePath).toBe('/kdbx/test.kdbx');
    expect(normalizeSettings({ remotePath: '   ' }).remotePath).toBe(DEFAULT_SETTINGS.remotePath);
  });
});

describe('mergeSettings', () => {
  it('patched nur übergebene Felder', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { autoLockMinutes: 5 });
    expect(merged.autoLockMinutes).toBe(5);
    expect(merged.clipboardClearSeconds).toBe(DEFAULT_SETTINGS.clipboardClearSeconds);
    expect(merged.remotePath).toBe(DEFAULT_SETTINGS.remotePath);
  });
});
