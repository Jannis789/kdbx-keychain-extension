/**
 * Native-Messaging-Host-Brücke (ADR-010): holt das agenix-Keyfile zur
 * Unlock-Zeit aus dem Host "kdbx_keychain_keyfile" (deklarativ deployed,
 * liest /run/agenix/kdbx-export-key). Nichts landet im Build oder im
 * Nix-Store — die Bytes gehen ausschließlich in storage.session (ADR-004).
 *
 * Chrome (Service Worker) und Firefox (Event-Page) verstehen beide
 * chrome.runtime.connectNative — der Fehlerfall ist bewusst weich:
 * kein Host → b64:null, aber die Ursache wird als error durchgereicht,
 * damit der Popup sie sichtbar machen kann (Diagnose statt Stille).
 */
const HOST_NAME = 'kdbx_keychain_keyfile';

export interface NativeKeyfile {
  b64: string | null;
  error?: string;
}

function lastErrorText(): string | undefined {
  try {
    return chrome.runtime.lastError?.message || undefined;
  } catch {
    return undefined;
  }
}

export function fetchKeyfileViaNative(timeoutMs = 3000): Promise<NativeKeyfile> {
  return new Promise((resolve) => {
    let settled = false;
    let port: chrome.runtime.Port | null = null;
    const t0 = Date.now();
    const tag = (): string => `id=${chrome.runtime.id} t=${Date.now() - t0}ms`;
    const done = (r: NativeKeyfile): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        port?.disconnect();
      } catch {
        // Port war schon weg — egal
      }
      resolve(r);
    };
    const timer = setTimeout(() => done({ b64: null, error: `timeout (${tag()})` }), timeoutMs);
    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch (e) {
      done({ b64: null, error: `connect: ${(e as Error).message}` });
      return;
    }
    port.onMessage.addListener((msg: { ok?: boolean; b64?: string }) => {
      if (msg?.ok && typeof msg.b64 === 'string' && msg.b64 !== '') {
        done({ b64: msg.b64 });
      } else {
        done({ b64: null, error: 'host antwortete ohne Keyfile' });
      }
    });
    port.onDisconnect.addListener(() => {
      const le = lastErrorText();
      // settled-Guard: nach erfolgreicher onMessage-Antwort ist done schon gelaufen
      done({
        b64: null,
        error: le ? `disconnect: ${le}` : `disconnect ohne lastError (${tag()})`,
      });
    });
    port.postMessage({ type: 'getKeyfile' });
  });
}
