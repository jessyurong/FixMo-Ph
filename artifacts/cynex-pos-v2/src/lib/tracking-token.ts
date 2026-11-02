/**
 * Public-tracking token generation.
 * Kept dependency-free so the Dexie upgrade, backup restore, and data services
 * can all generate the same kind of token without import cycles.
 */

const TOKEN_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generate a random, URL-safe token. The default is 24 characters, comfortably
 * above the 12-character minimum, using the browser crypto RNG when available.
 */
export function generateTrackingToken(length = 24): string {
  const size = Math.max(12, Math.floor(length) || 24);
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;

  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(size);
    cryptoObj.getRandomValues(bytes);
    let token = '';
    for (let i = 0; i < bytes.length; i += 1) {
      token += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
    }
    return token;
  }

  // Extremely old browsers: still guarantee a 12+ character random-looking value.
  let fallback = '';
  while (fallback.length < size) {
    fallback += Math.random().toString(36).slice(2);
  }
  return fallback.slice(0, size);
}
