// AES-256-GCM encryption for secrets at rest (Google refresh tokens).
// Key: TOKEN_ENCRYPTION_KEY env var, base64-encoded 32 bytes.
// Wire format: `iv.ciphertext.tag` — three base64 parts joined by dots.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, the GCM recommendation
const TAG_BYTES = 16;

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to .env."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be base64 for exactly ${KEY_BYTES} bytes; decoded to ${key.length} bytes. ` +
        "Generate a valid key with `openssl rand -base64 32`."
    );
  }
  return key;
}

/** Encrypt a secret. Returns `iv.ciphertext.tag` (base64 parts). */
export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${ciphertext.toString("base64")}.${tag.toString("base64")}`;
}

/** Decrypt a payload produced by {@link encryptSecret}. Throws on tampering or a wrong key. */
export function decryptSecret(payload: string): string {
  const key = getKey();
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new Error(
      "Malformed encrypted payload: expected three base64 parts in the form `iv.ciphertext.tag`."
    );
  }
  const iv = Buffer.from(parts[0], "base64");
  const ciphertext = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  if (iv.length !== IV_BYTES) {
    throw new Error(`Malformed encrypted payload: IV must be ${IV_BYTES} bytes, got ${iv.length}.`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(`Malformed encrypted payload: auth tag must be ${TAG_BYTES} bytes, got ${tag.length}.`);
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(
      "Failed to decrypt secret: wrong TOKEN_ENCRYPTION_KEY or corrupted payload. " +
        "If the key was rotated, previously stored tokens must be re-obtained (users reconnect Gmail)."
    );
  }
}
