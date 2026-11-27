/**
 * Clipboard (ADR-009, eingedampft): nur schreiben — kein Auto-Clear
 * (Produktentscheidung 2026-11-27: nie gefordertes Feature).
 *
 * Browsergetrennt: Chrome-MV3-SW hat kein DOM → Offscreen-Dokument
 * (Reason: CLIPBOARD); Firefox-Event-Page schreibt direkt per
 * navigator.clipboard.
 */

const OFFSCREEN_URL = 'offscreen/clipboard.html';
let creating: Promise<void> | null = null;

function wrap<T>(fn: (cb: (result: T) => void) => void): Promise<T> {
  return new Promise((resolve) => fn((result) => resolve(result)));
}

/** Chrome-MV3-Pfad verfügbar? (Firefox: Event-Page ohne chrome.offscreen) */
function hasOffscreen(): boolean {
  return (
    typeof chrome.offscreen !== 'undefined' &&
    typeof chrome.runtime.getContexts === 'function'
  );
}

async function ensureOffscreen(): Promise<void> {
  if (typeof chrome.offscreen === 'undefined') {
    throw new Error('offscreen-API nicht verfügbar');
  }
  if (creating) return creating;
  creating = (async () => {
    const contexts = await wrap<chrome.runtime.ExtensionContext[]>((cb) =>
      chrome.runtime.getContexts(
        { contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] },
        cb,
      ),
    );
    if (contexts.length > 0) return;
    try {
      await wrap<void>((cb) =>
        chrome.offscreen.createDocument(
          {
            url: OFFSCREEN_URL,
            reasons: [chrome.offscreen.Reason.CLIPBOARD],
            justification: 'Zwischenablage schreiben (Kopieren)',
          },
          cb,
        ),
      );
    } catch (e) {
      if (!String(e).includes('already exist')) throw e;
    }
  })().finally(() => {
    creating = null;
  });
  return creating;
}

export async function copyToClipboard(text: string): Promise<void> {
  if (hasOffscreen()) {
    await ensureOffscreen();
    await wrap<unknown>((cb) =>
      chrome.runtime.sendMessage(
        { type: 'CLIPBOARD_WRITE', text } as unknown as Record<string, unknown>,
        (r) => {
          void chrome.runtime.lastError; // bewusst ignorieren: Offscreen antwortet
          cb(r);
        },
      ),
    );
  } else {
    await navigator.clipboard.writeText(text);
  }
}
