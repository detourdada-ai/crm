/**
 * Phone number normalization.
 * "01012341234" -> "010-1234-1234"
 * Also handles Seoul (02) and other area-code landlines.
 */

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatPhoneNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = digitsOnly(raw);
  if (digits.length < 9) return raw.trim() || null;

  if (digits.startsWith("02")) {
    // Seoul: 02 + 7 or 8 digit local number
    const local = digits.slice(2);
    if (local.length === 7) return `02-${local.slice(0, 3)}-${local.slice(3)}`;
    if (local.length === 8) return `02-${local.slice(0, 4)}-${local.slice(4)}`;
    return raw.trim();
  }

  if (digits.length === 11) {
    // Mobile (010/011/...) or 3-digit area code landline with 8-digit local number
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    // 3-digit area code + 7-digit local number, or older 10-digit mobile
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return raw.trim();
}

export function isSamePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return digitsOnly(a) === digitsOnly(b);
}
