import "server-only";
import { resolveKstQuickRange } from "@/lib/utils/kst-date";

export type SettlementPeriodType = "daily" | "weekly" | "monthly" | "custom";

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
 *
 * CPO 지시(2026-08): "배송일 기준" 임의 구간 조회를 위한 custom 타입 추가 —
 * customRange가 주어지면 그대로 사용하고, 없으면(방어적으로) referenceDate
 * 하루로 좁힌다.
 */
export function resolvePeriodRange(
  periodType: SettlementPeriodType,
  referenceDateIso: string,
  customRange?: PeriodRange
): PeriodRange {
  if (periodType === "custom") {
    return customRange ?? { start: referenceDateIso, end: referenceDateIso };
  }
  if (periodType === "daily") {
    return { start: referenceDateIso, end: referenceDateIso };
  }
  if (periodType === "weekly") {
    return resolveKstQuickRange("week", referenceDateIso);
  }
  return resolveKstQuickRange("month", referenceDateIso);
}
