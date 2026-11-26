/**
 * Native-Messaging-Host-Brücke (ADR-010): holt das agenix-Keyfile zur
 * Unlock-Zeit aus dem Host "kdbx_keychain_keyfile" (deklarativ deployed,
 * liest /run/agenix/kdbx-export-key). Nichts landet im Build oder im
 * Nix-Store — die Bytes gehen ausschließlich in storage.session (ADR-004).
 *
 * Chrome (Service Worker) und Firefox (Event-Page) verstehen beide
 * chrome.runtime.connectNative — der Fehlerfall ist bewusst weich:
 * kein Host → null → Popup fällt auf manuelle Dateiauswahl zurück.
 */
const HOST_NAME = 'kdbx_keychain_keyfile';

export interface NativeKeyfile {
  b64: string | null;
}

export function fetchKeyfileViaNative(timeoutMs = 3000): Promise<NativeKeyfile> {
  return new Promise((resolve) => {
    let port: chrome.runtime.Port | null = null;
    const done = (r: NativeKeyfile): void => {
      clearTimeout(timer);
      try {
        port?.disconnect();
      } catch {
        // Port war schon weg — egal
      }
      resolve(r);
    };
    const timer = setTimeout(() => done({ b64: null }), timeoutMs);
    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch {
      done({ b64: null });
      return;
    }
    port.onMessage.addListener((msg: { ok?: boolean; b64?: string }) => {
      if (msg?.ok && typeof msg.b64 === 'string' && msg.b64 !== '') {
        done({ b64: msg.b64 });
      } else {
        done({ b64: null });
      }
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // bewusst konsumieren (Fehlertext egal)
      done({ b64: null });
    });
    port.postMessage({ type: 'getKeyfile' });
  });
}
