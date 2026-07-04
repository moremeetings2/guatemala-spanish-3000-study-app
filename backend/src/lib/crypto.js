// Password hashing and token helpers built on the Web Crypto API
// (available in the Cloudflare Workers runtime — no native deps required).

const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;

/** @param {ArrayBuffer|Uint8Array} buf */
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** @param {string} hex */
function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Derive a PBKDF2-SHA256 hash for a password.
 * @param {string} password
 * @param {string} [saltHex] reuse an existing salt (for verification); random if omitted
 * @returns {Promise<{ salt: string, hash: string }>}
 */
export async function hashPassword(password, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_LENGTH_BYTES * 8
  );
  return { salt: toHex(salt), hash: toHex(bits) };
}

/**
 * Verify a password against a stored salt + hash, in constant time.
 * @param {string} password
 * @param {string} saltHex
 * @param {string} expectedHashHex
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, saltHex, expectedHashHex) {
  const { hash } = await hashPassword(password, saltHex);
  return timingSafeEqual(hash, expectedHashHex);
}

/** Constant-time string comparison to avoid leaking timing information. */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A cryptographically-random opaque session token (64 hex chars). */
export function randomToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 hex digest of a string (used to store session tokens hashed). */
export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(digest);
}
