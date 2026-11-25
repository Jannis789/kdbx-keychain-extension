/**
 * Clipboard via Offscreen-Dokument (ADR-009).
 *
 * MV3-Service-Worker haben kein DOM — navigator.clipboard existiert dort
 * nicht zuverlässig. Chrome-Boardmittel ist das Offscreen-Dokument
 * (Reason: CLIPBOARD). Firefox (Phase 4) hat für sein Background-Dokument
 * einen anderen Weg → feature-detected.
 *
 * Auto-Clear ist zweifach abgesichert: der Background hält den erwarteten
 * Wert im RAM und das Offscreen-Dokument vergleicht vor dem Löschen den
 * tatsächlichen Clipboard-Inhalt — fremde Inhalte werden nie überschrieben.
 */
import type { OffscreenMessage } from '../shared/messages';
import { chromeAlarms } from './ports';

export const CLIPBOARD_CLEAR_ALARM = 'kdbx-clipboard-clear';

const OFFSCREEN_URL = 'offscreen/clipboard.html';

let creating: Promise<void> | null = null;

function wrap<T>(fn: (cb: (result: T) => void) => void): Promise<T> {
  return new Promise((resolve) => fn((result) => resolve(result)));
}

async function ensureOffscreen(): Promise<void> {
  if (typeof chrome.offscreen === 'undefined') {
    // Firefox/Event-Page-Fallback: Phase 4, bis dahin kein Clipboard im Hintergrund.
    throw new Error('offscreen-API nicht verfügbar (Firefox folgt in Phase 4)');
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
            justification: 'Zwischenablage schreiben und Auto-Clear (ADR-009)',
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

async function sendToOffscreen<T>(message: OffscreenMessage): Promise<T | undefined> {
  await ensureOffscreen();
  return wrap<T | undefined>((cb) =>
    chrome.runtime.sendMessage(message as unknown as Record<string, unknown>, (r) => {
      void chrome.runtime.lastError; // bewusst ignorieren: Offscreen antwortet
      cb(r);
    }),
  );
}

/** Erwarteten Clipboard-Inhalt merken (nur RAM — stirbt mit dem SW). */
let clipboardExpected: string | null = null;

export function setClipboardExpected(value: string): void {
  clipboardExpected = value;
}

export async function copyToClipboard(text: string): Promise<void> {
  await sendToOffscreen<{ done: boolean }>({ type: 'CLIPBOARD_WRITE', text });
}

export async function clearClipboardIfExpected(): Promise<boolean> {
  const expected = clipboardExpected;
  clipboardExpected = null;
  if (!expected) return false;
  const res = await sendToOffscreen<{ cleared: boolean }>({
    type: 'CLIPBOARD_CLEAR_IF_SAME',
    expected,
  });
  return res?.cleared === true;
}

export async function armClipboardClear(seconds: number): Promise<void> {
  await chromeAlarms().create(CLIPBOARD_CLEAR_ALARM, seconds);
}
