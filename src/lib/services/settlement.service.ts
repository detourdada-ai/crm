import "server-only";
import { resolveKstQuickRange } from "@/lib/utils/kst-date";

export type SettlementPeriodType = "daily" | "weekly" | "monthly";

export interface PeriodRange {
  start: string; // yyyy-mm-dd
  end: string;
}

/**
 * Resolves a period type + reference date (KST calendar day, "YYYY-MM-DD")
 * into an inclusive [start, end] date range (주는 월~일).
 *
 * Phase 7 STEP1: previously used `new Date(referenceDateIso)` +
 * `.setHours()`/`.getDay()`/`.getFullYear()` etc — all local-timezone
 * getters/setters, which only produced correct KST boundaries by
 * coincidence on a KST-configured server (see kst-date.ts's own doc
 * comment for the same historical bug). Now delegates to kst-date.ts's
 * `resolveKstQuickRange`, the same explicit-+09:00-offset logic already
 * used by 주문관리/배송관리/Dashboard — one date-boundary implementation
 * for the whole app, not a second parallel one for 정산관리.
 */
export function resolvePeriodRange(periodType: SettlementPeriodType, referenceDateIso: string): PeriodRange {
  if (periodType === "daily") {
    return { start: referenceDateIso, end: referenceDateIso };
  }
  if (periodType === "weekly") {
    return resolveKstQuickRange("week", referenceDateIso);
  }
  return resolveKstQuickRange("month", referenceDateIso);
}
