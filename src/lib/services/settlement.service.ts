import "server-only";

export type SettlementPeriodType = "daily" | "weekly" | "monthly";

export interface PeriodRange {
  start: string; // yyyy-mm-dd
  end: string;
}

/** Resolves a period type + reference date into an inclusive [start, end] date range (주는 월~일). */
export function resolvePeriodRange(periodType: SettlementPeriodType, referenceDateIso: string): PeriodRange {
  const ref = new Date(referenceDateIso);
  ref.setHours(0, 0, 0, 0);

  if (periodType === "daily") {
    return { start: toDateString(ref), end: toDateString(ref) };
  }

  if (periodType === "weekly") {
    const day = ref.getDay(); // 0 = Sunday
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(ref);
    monday.setDate(ref.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: toDateString(monday), end: toDateString(sunday) };
  }

  const monthStart = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const monthEnd = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  return { start: toDateString(monthStart), end: toDateString(monthEnd) };
}

function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
