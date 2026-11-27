/**
 * Offscreen-Dokument für Clipboard-Zugriff (Chrome-MV3: kein DOM im SW).
 * Nur Schreiben — Auto-Clear entfernt (nie gefordert, 2026-11-27).
 */

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse): boolean => {
  const msg = raw as { type?: string; text?: string } | undefined;
  if (msg?.type === 'CLIPBOARD_WRITE') {
    void navigator.clipboard.writeText(String(msg.text ?? '')).then(() => sendResponse({ done: true }));
    return true;
  }
  return false;
});
