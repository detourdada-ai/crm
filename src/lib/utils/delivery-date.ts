/**
 * Smartstore's 옵션정보(option) column often embeds a delivery-area +
 * delivery-date choice as free text, e.g.
 * "하남/강동(일부): 미사/풍산/덕풍/신장/창우/강일/고덕/명일 / 날짜 선택: 07월16일"
 * This pulls just the "MM월DD일" date out of that text.
 */
const DATE_PATTERN = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/;

/**
 * Resolves the parsed month/day against a reference date (normally the
 * order_date), rolling into the next year if the parsed date would
 * otherwise land more than ~2 months in the past (handles December orders
 * with a January delivery date).
 */
export function parseDeliveryDateFromOption(optionText: string | null | undefined, referenceDate: Date): string | null {
  if (!optionText) return null;
  const match = optionText.match(DATE_PATTERN);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const year = referenceDate.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month - 1, day));
  const diffDays = (candidate.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < -60) {
    candidate = new Date(Date.UTC(year + 1, month - 1, day));
  }
  return candidate.toISOString();
}
