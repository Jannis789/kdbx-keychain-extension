/**
 * Content-Script (ADR-006): füllt NUR auf explizite Anweisung des Backgrounds
 * (User-Intent via Popup/Kontextmenü/Shortcut) — kein Scanning beim Laden.
 */
import { pickLoginFields, type FieldDescriptor } from '../shared/autofill';

interface FillDomPayload {
  type: 'FILL_INTO_DOM';
  username?: string;
  password?: string;
  totp?: string;
}

interface FillResult {
  username: boolean;
  password: boolean;
  totp: boolean;
}

// Idempotenz-Guard: ensureContentScript() (Background) kann das Script bei
// erneutem Fill nochmal injizieren — doppelte Listener würden doppelt füllen.
const injectGuard = globalThis as { __kdbxContentInjected?: boolean };
if (!injectGuard.__kdbxContentInjected) {
  injectGuard.__kdbxContentInjected = true;
  chrome.runtime.onMessage.addListener(
    (raw: unknown, _sender, sendResponse): boolean => {
      const msg = raw as FillDomPayload | undefined;
      if (msg?.type !== 'FILL_INTO_DOM') return false;
      sendResponse(applyFill(msg));
      return false;
    },
  );
}

function isVisible(el: HTMLInputElement): boolean {
  if (el.type === 'hidden' || el.disabled || el.readOnly) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

const KIND: Record<string, FieldDescriptor['kind']> = {
  password: 'password',
  email: 'email',
  tel: 'tel',
  text: 'text',
  search: 'text',
  number: 'text',
};

function describe(el: HTMLInputElement): FieldDescriptor | null {
  if (!isVisible(el)) return null;
  const rawType = (el.getAttribute('type') ?? 'text').toLowerCase();
  return {
    kind: KIND[rawType] ?? 'other',
    visible: true,
    autocomplete: el.getAttribute('autocomplete') ?? undefined,
    id: el.id || undefined,
    name: el.name || undefined,
    placeholder: el.placeholder || undefined,
    ariaLabel: el.getAttribute('aria-label') ?? undefined,
  };
}

/** Native Value-Property (React-/Angular-Override umgehen) + Events feuern. */
function setNativeValue(el: HTMLInputElement, value: string): boolean {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) return false;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function applyFill(payload: FillDomPayload): FillResult {
  const descriptors: FieldDescriptor[] = [];
  const elements: HTMLInputElement[] = [];
  for (const input of Array.from(document.querySelectorAll('input')) as HTMLInputElement[]) {
    const d = describe(input);
    if (!d) continue;
    descriptors.push(d);
    elements.push(input);
  }
  const pick = pickLoginFields(descriptors);

  const fill = (index: number | null, value: string | undefined): boolean => {
    if (index === null || !value) return false;
    const el = elements[index];
    return el ? setNativeValue(el, value) : false;
  };

  return {
    username: fill(pick.usernameIndex, payload.username),
    password: fill(pick.passwordIndex, payload.password),
    totp: fill(pick.otpIndex, payload.totp),
  };
}
