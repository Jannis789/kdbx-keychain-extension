/** RPC-Helfer für UI-Kontexte (Popup/Options): Message rein, Daten raus. */
import type { RuntimeMessage, RuntimeResponse } from './messages';

export async function callBackground<T>(message: RuntimeMessage): Promise<T> {
  const res = (await chrome.runtime.sendMessage(message)) as RuntimeResponse<T> | undefined;
  if (!res) throw new Error('Keine Antwort vom Hintergrunddienst');
  if (!res.ok) throw new Error(res.error ?? 'Unbekannter Fehler');
  return res.data as T;
}
