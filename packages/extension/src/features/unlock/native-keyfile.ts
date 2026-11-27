/**
 * Native-Messaging-Host-Brücke (ADR-010): holt das agenix-Keyfile zur
 * Unlock-Zeit aus dem Host "kdbx_keychain_keyfile" (deklarativ deployed,
 * liest /run/agenix/kdbx-export-key). Nichts landet im Build oder im
 * Nix-Store — die Bytes gehen ausschließlich in storage.session (ADR-004).
 *
 * Kein Host ist ein legitimer Zustand (fremder Rechner, kein nix): dann kommt
 * `b64: null` plus Grund zurück, damit das Popup die manuelle Dateiauswahl
 * anbietet und die Ursache sichtbar bleibt (Diagnose statt Stille).
 */
const HOST_NAME = 'kdbx_keychain_keyfile';
const TIMEOUT_MS = 3000;

export interface NativeKeyfile {
  b64: string | null;
  path?: string;
  error?: string;
}

export function fetchKeyfileViaNative(): Promise<NativeKeyfile> {
  return new Promise((resolve) => {
    let settled = false;
    const port = chrome.runtime.connectNative(HOST_NAME);
    const finish = (result: NativeKeyfile): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      port.disconnect();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ b64: null, error: `timeout ${TIMEOUT_MS}ms (${HOST_NAME})` }),
      TIMEOUT_MS,
    );
    port.onMessage.addListener((msg: { ok?: boolean; b64?: string; path?: string }) => {
      finish(
        msg?.ok && typeof msg.b64 === 'string' && msg.b64 !== ''
          ? { b64: msg.b64, ...(typeof msg.path === 'string' ? { path: msg.path } : {}) }
          : { b64: null, error: 'host antwortete ohne Keyfile' },
      );
    });
    port.onDisconnect.addListener(() => {
      // Der Host hat geschlossen (oder existiert nicht) — lastError sagt warum.
      const error = chrome.runtime.lastError?.message;
      finish({ b64: null, error: error ? `disconnect: ${error}` : 'disconnect ohne Fehlertext' });
    });
    port.postMessage({ type: 'getKeyfile' });
  });
}
