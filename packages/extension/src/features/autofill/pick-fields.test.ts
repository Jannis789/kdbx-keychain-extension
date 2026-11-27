import { describe, expect, it } from 'vitest';
import { pickLoginFields, type FieldDescriptor } from './pick-fields';

function field(partial: Partial<FieldDescriptor>): FieldDescriptor {
  return {
    kind: 'text',
    visible: true,
    ...partial,
  };
}

describe('pickLoginFields', () => {
  it('klassisches Formular: Username vor Passwort', () => {
    const fields = [
      field({ kind: 'text', id: 'login-user' }),
      field({ kind: 'password', id: 'login-pw' }),
    ];
    const pick = pickLoginFields(fields);
    expect(pick).toEqual({ usernameIndex: 0, passwordIndex: 1, otpIndex: null });
  });

  it('ohne Passwort-Feld wird gar nichts gewählt (Anker-Regel)', () => {
    const fields = [field({ id: 'user' }), field({ id: 'email' })];
    expect(pickLoginFields(fields)).toEqual({
      usernameIndex: null,
      passwordIndex: null,
      otpIndex: null,
    });
  });

  it('unsichtbare Felder werden ignoriert (display:none-Traps)', () => {
    const fields = [
      field({ id: 'user', visible: false }),
      field({ kind: 'password', id: 'pw' }),
    ];
    const pick = pickLoginFields(fields);
    expect(pick.usernameIndex).toBeNull();
    expect(pick.passwordIndex).toBe(1);
  });

  it('autocomplete-Attribute schlagen Namens-Heuristik', () => {
    const fields = [
      field({ id: 'search', name: 'q' }),
      field({ kind: 'email', autocomplete: 'email', id: 'mail' }),
      field({ kind: 'password', autocomplete: 'current-password', id: 'pw' }),
    ];
    const pick = pickLoginFields(fields);
    expect(pick.usernameIndex).toBe(1);
    expect(pick.passwordIndex).toBe(2);
  });

  it('bei mehreren Passwortfeldern gewinnt current-password (Registrierungs-Seiten)', () => {
    const fields = [
      field({ id: 'user' }),
      field({ kind: 'password', id: 'pw-new', autocomplete: 'new-password' }),
      field({ kind: 'password', id: 'pw-confirm' }),
      field({ kind: 'password', id: 'pw-login', autocomplete: 'current-password' }),
    ];
    expect(pickLoginFields(fields).passwordIndex).toBe(3);
  });

  it('E-Mail-Kandidat per type=email', () => {
    const fields = [
      field({ kind: 'email', id: 'mail', name: 'email' }),
      field({ kind: 'password', id: 'pw' }),
    ];
    const pick = pickLoginFields(fields);
    expect(pick.usernameIndex).toBe(0);
  });

  it('OTP-Zweitfeld wird erkannt (autocomplete=one-time-code)', () => {
    const fields = [
      field({ id: 'user' }),
      field({ kind: 'password', id: 'pw' }),
      field({ id: 'code', autocomplete: 'one-time-code' }),
    ];
    expect(pickLoginFields(fields).otpIndex).toBe(2);
  });

  it('OTP-Feld über Namens-Heuristik (totp/2fa/code)', () => {
    const fields = [
      field({ id: 'user' }),
      field({ kind: 'password', id: 'pw' }),
      field({ id: 'totp_code', name: 'totp' }),
    ];
    expect(pickLoginFields(fields).otpIndex).toBe(2);
  });

  it('Passwort-Anchor ohne sinnvollen Username-Kandidaten → username null', () => {
    const fields = [field({ id: 'captcha' }), field({ kind: 'password', id: 'pw' })];
    const pick = pickLoginFields(fields);
    expect(pick.passwordIndex).toBe(1);
    expect(pick.usernameIndex).toBeNull();
  });
});
