/** True if `value` parses to a real, finite date (guards against `new Date(x).toISOString()` throwing on bad query params). */
export function isValidDateString(value: string | null | undefined): value is string {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}
