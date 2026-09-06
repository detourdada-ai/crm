import type { PaymentStatus } from "./types";

/**
 * STEP15-F3A — 결제 상태 전이 규칙.
 * 표는 코드보다 먼저 확정했다 → docs/product/STEP15F3A-PAYMENT-STATE-TRANSITIONS.md
 *
 * 핵심은 두 가지다.
 *   ① confirmed는 사실상 종착점 — 늦게 도착한 pending이 확정을 되돌리지 못한다.
 *   ② failed → confirmed만 예외 — 승인 지연/재시도로 나중에 승인되는 경우가 실재한다.
 *      (단 이때도 서버 조회 재확인 + 금액 대조를 통과해야 한다.)
 */
const ALLOWED: Record<PaymentStatus, PaymentStatus[]> = {
  created: ["pending", "confirmed", "failed", "cancelled", "expired"],
  pending: ["confirmed", "failed", "cancelled", "expired"],
  confirmed: [],
  failed: ["confirmed"],
  cancelled: [],
  expired: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return true; // 같은 상태 재적용은 멱등 no-op이며 오류가 아니다.
  return ALLOWED[from].includes(to);
}
