// Lazy loader for Baileys to avoid CJS/ESM interop issues.
import type { WASocket, proto } from '@whiskeysockets/baileys';

let cached: typeof import('@whiskeysockets/baileys') | null = null;

export async function loadBaileys() {
  if (!cached) {
    cached = await import('@whiskeysockets/baileys');
  }
  return cached;
}

export type { WASocket, proto };
