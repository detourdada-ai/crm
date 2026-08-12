import crypto from "node:crypto";

// Excludes 0/O/1/I to avoid visual ambiguity when an admin reads a key aloud
// or copies it by hand.
const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomSegment(length: number): string {
  return Array.from(crypto.randomBytes(length))
    .map((b) => KEY_ALPHABET[b % KEY_ALPHABET.length])
    .join("");
}

/** Format: ODF-XXXX-XXXX-XXXX. Shown to the admin exactly once — never persisted in plaintext. */
export function generateAccessKey(): string {
  return `ODF-${randomSegment(4)}-${randomSegment(4)}-${randomSegment(4)}`;
}

/**
 * SHA-256, not scrypt: access keys are already high-entropy random strings
 * (unlike human passwords), so a fast one-way hash is sufficient for a
 * lookup-by-hash use case and avoids scrypt's deliberate slowness.
 */
export function hashAccessKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}
