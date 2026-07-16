/**
 * Address helpers.
 *  - cleanAddress: human-readable display value (trim + collapse whitespace)
 *  - normalizeAddressForCompare: aggressive normalization used ONLY for
 *    duplicate-detection / equality checks, never for display.
 */

export function cleanAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\s+/g, " ");
  return cleaned || null;
}

const SPECIAL_CHARS_REGEX = /[^\p{L}\p{N}]/gu;

export function normalizeAddressForCompare(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(SPECIAL_CHARS_REGEX, "");
  return normalized || null;
}

export function isSameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeAddressForCompare(a);
  const nb = normalizeAddressForCompare(b);
  if (!na || !nb) return false;
  return na === nb;
}
