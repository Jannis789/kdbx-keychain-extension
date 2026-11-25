/**
 * Auto-Fill-Heuristik v1 (ADR-006) — bewusst pure.
 * Das Content-Script beschreibt DOM-Inputs als `FieldDescriptor`; die
 * Feldauswahl läuft hier und ist damit ohne Browser testbar.
 *
 * Regel (ADR-006): niemals still füllen — nur bei User-Intent, und nur mit
 * Passwort-Feld als Anker. Ohne Anker wird nichts ausgefüllt.
 */

export interface FieldDescriptor {
  kind: 'text' | 'email' | 'tel' | 'password' | 'other';
  visible: boolean;
  autocomplete?: string | undefined;
  id?: string | undefined;
  name?: string | undefined;
  placeholder?: string | undefined;
  ariaLabel?: string | undefined;
}

export interface PickResult {
  usernameIndex: number | null;
  passwordIndex: number | null;
  otpIndex: number | null;
}

const USERNAME_HINT =
  /user(name)?|login|log[-_]?in|email|e[-_]?mail|mail|account|acct|identifier|identity|benutzer/i;
const USERNAME_NEGATIVE =
  /captcha|suche|search|otp|totp|one[-_ ]?time|\bcode\b|amount|quantity|qty|voucher|coupon|promo/i;
const OTP_HINT =
  /otp|totp|2fa|two[-_ ]?factor|authenticator|verification.{0,6}code|one[-_ ]?time|\bcode\b/i;

export function pickLoginFields(fields: readonly FieldDescriptor[]): PickResult {
  const visible = fields.map((f, i) => ({ f, i })).filter(({ f }) => f.visible);

  // Anker: Passwortfeld; `autocomplete=current-password` gewinnt.
  let passwordIndex: number | null = null;
  for (const { f, i } of visible) {
    if (f.kind !== 'password') continue;
    const current = passwordIndex !== null ? fields[passwordIndex] : undefined;
    const currentIsMarked = (current?.autocomplete ?? '').toLowerCase().includes('current-password');
    if (passwordIndex === null || (!(currentIsMarked) && (f.autocomplete ?? '').toLowerCase().includes('current-password'))) {
      passwordIndex = i;
    }
  }
  if (passwordIndex === null) {
    return { usernameIndex: null, passwordIndex: null, otpIndex: null };
  }

  // Username: bester sichtbarer Text-Kandidat.
  let bestIndex: number | null = null;
  let bestScore = 0;
  for (const { f, i } of visible) {
    if (i === passwordIndex) continue;
    if (f.kind !== 'text' && f.kind !== 'email' && f.kind !== 'tel') continue;
    let score = 0;
    const ac = (f.autocomplete ?? '').toLowerCase();
    if (ac.includes('username')) score += 6;
    else if (ac.includes('email')) score += 5;
    const hay = [f.id, f.name, f.placeholder, f.ariaLabel].filter(Boolean).join(' ');
    if (USERNAME_HINT.test(hay)) score += 3;
    if (USERNAME_NEGATIVE.test(hay)) score -= 5;
    if (f.kind === 'email') score += 2;
    if (i < passwordIndex) score += 2; // Username steht typischerweise vorm Passwort
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  // OTP-Zweitfeld (optional, z. B. bei Login mit 2FA-Step auf derselben Seite).
  let otpIndex: number | null = null;
  for (const { f, i } of visible) {
    if (i === passwordIndex || i === bestIndex) continue;
    if (f.kind !== 'text' && f.kind !== 'tel') continue;
    const ac = (f.autocomplete ?? '').toLowerCase();
    const hay = [f.id, f.name, f.placeholder, f.ariaLabel].filter(Boolean).join(' ');
    if (ac.includes('one-time-code') || OTP_HINT.test(hay)) {
      otpIndex = i;
      break;
    }
  }

  return { usernameIndex: bestIndex, passwordIndex, otpIndex };
}
