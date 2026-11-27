/**
 * Uint8Array <-> Base64 über die Plattform (btoa/atob) — in Service Worker,
 * Event Page und Node vorhanden. chrome.storage und runtime-Messages sind
 * JSON-basiert; ArrayBuffer kommt dort nicht heil an, daher der String-Umweg.
 */

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
