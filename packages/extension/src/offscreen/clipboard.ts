/**
 * Offscreen-Dokument für Clipboard-Zugriff (ADR-009).
 * Schreibt Werte und löscht NUR, wenn die Zwischenablage noch unseren
 * erwarteten Inhalt hat — fremde Kopien bleiben unberührt.
 */

interface OffscreenPayload {
  type: 'CLIPBOARD_WRITE' | 'CLIPBOARD_CLEAR_IF_SAME';
  text?: string;
  expected?: string;
}

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse): boolean => {
  const msg = raw as OffscreenPayload | undefined;
  if (msg?.type === 'CLIPBOARD_WRITE') {
    void write(String(msg.text ?? '')).then(() => sendResponse({ done: true }));
    return true;
  }
  if (msg?.type === 'CLIPBOARD_CLEAR_IF_SAME') {
    void clearIfSame(String(msg.expected ?? '')).then((res) => sendResponse(res));
    return true;
  }
  return false;
});

async function write(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

async function readClipboard(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    // Fallback: execCommand('paste') in einem versteckten Textfeld
    try {
      const ta = document.createElement('textarea');
      ta.setAttribute('contenteditable', 'true');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('paste');
      const value = ok ? ta.value : null;
      ta.remove();
      return value;
    } catch {
      return null;
    }
  }
}

async function clearIfSame(expected: string): Promise<{ cleared: boolean }> {
  const current = await readClipboard();
  if (current !== null && current === expected) {
    await navigator.clipboard.writeText('');
    return { cleared: true };
  }
  return { cleared: false };
}
