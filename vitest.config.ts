import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts'],
    // KDBX-Roundtrips mit Argon2 können quelques Sekunden dauern (asm.js/WASM-KDF).
    testTimeout: 60_000,
  },
});
