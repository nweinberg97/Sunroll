/** Random identifiers and secrets, generated with the platform CSPRNG. */

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** 14 base58 characters (≈ 82 bits), the same shape the server produces. */
export function newEventId(): string {
  let out = '';
  while (out.length < 14) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    for (const b of bytes) {
      if (b < 232 && out.length < 14) out += BASE58[b % 58];
    }
  }
  return out;
}

/** 144-bit base64url secret. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const EVENT_ID_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{14}$/;

/** SHA-256 hex of a secret. Falls back to a non-cryptographic hash only where SubtleCrypto is missing (insecure local origins). */
export async function hashSecret(secret: string): Promise<string> {
  const data = new TextEncoder().encode(secret);
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const c of data) {
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  return `fnv-${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}
