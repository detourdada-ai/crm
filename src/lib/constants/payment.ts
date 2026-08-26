import type { PaymentMethod, PaymentStatus } from "@/types/domain";

/**
 * Phase 2 §5(2026-08 CPO 작업지시): 결제상태/방법은 자유 텍스트를 허용하지
 * 않는다 — "계좌/계좌이체/입금/무통장" 같은 표기 흔들림이 생기면 검색·통계가
 * 망가진다는 CPO 지적. 수동주문 select와 표준엑셀 가이드시트가 이 목록 하나만
 * 참조하도록 여기에 단일 소스로 둔다.
 */
export const PAYMENT_STATUS_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: "결제완료", label: "결제완료" },
  { value: "미결제", label: "미결제" },
  { value: "부분결제", label: "부분결제" },
  { value: "환불", label: "환불" },
];

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "카드", label: "카드" },
  { value: "계좌이체", label: "계좌이체" },
  { value: "현금", label: "현금" },
  { value: "네이버페이", label: "네이버페이" },
  { value: "기타", label: "기타" },
];

export const DEFAULT_PAYMENT_STATUS: PaymentStatus = "결제완료";

export const PAYMENT_STATUS_BADGE_VARIANT: Record<PaymentStatus, "outline" | "secondary" | "default" | "destructive"> = {
  결제완료: "default",
  미결제: "destructive",
  부분결제: "secondary",
  환불: "destructive",
};

/** 수동 주문 폼의 "결제방법 선택 안 함" sentinel — 실제 PaymentMethod 값과 겹치지 않는다. */
export const NO_PAYMENT_METHOD_VALUE = "__none__";

export function isPaymentStatus(value: string): value is PaymentStatus {
  return PAYMENT_STATUS_OPTIONS.some((opt) => opt.value === value);
}

export function isPaymentMethod(value: string): value is PaymentMethod {
  return PAYMENT_METHOD_OPTIONS.some((opt) => opt.value === value);
}
