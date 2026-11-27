/** chrome.*-Callback-APIs → Promise. Einziger Ort, der das Muster wiederholt. */
export function wrap<T>(fn: (cb: (result: T) => void) => void): Promise<T> {
  return new Promise((resolve) => fn((result) => resolve(result)));
}
