/**
 * STEP15-F3(CPO 작업지시, 2026-09-06) — 결제 경계(boundary).
 *
 * 이 단계의 목적은 결제창을 만드는 것이 아니라, **우리 SaaS가 외부 결제수단과
 * 연결될 수 있는 표준 경계**를 정의하는 것이다. 실제 PG SDK·충전 상품·가격은 없다.
 *
 * ## 가장 중요한 원칙 — 두 원장을 섞지 않는다
 *   Payment          = 고객이 실제로 돈을 낸 **외부 거래 사실**
 *   Wallet Ledger    = 우리 서비스 내부 **잔액 거래**
 *   Admin Adjust     = 운영자 보정
 * 결제 성공이 곧바로 잔액을 바꾸지 않는다. 확인된 결제를 근거로 **별도의**
 * wallet charge가 일어나야 하고, F3에서는 그 연결을 하지 않는다.
 */

/**
 * 우리 내부 결제 상태. PG의 모든 상태를 복제하지 않는다 — 우리 SaaS가 실제로
 * 구분해야 하는 것만 남긴다. 근거는 STEP15F3-PAYMENT-FOUNDATION.md §2.
 *
 *   created    우리 쪽에서 결제를 만들었고 아직 결제창으로 가지 않음
 *   pending    사용자가 결제 진행 중이거나, 승인/입금을 기다리는 중
 *   confirmed  금액까지 검증된 최종 성공 — 이 상태에서만 충전 근거가 된다
 *   failed     실패(승인 거절 등)
 *   cancelled  사용자가 취소했거나 우리가 취소함
 *   expired    유효시간 초과 — 다시 시도해야 한다
 */
export type PaymentStatus = "created" | "pending" | "confirmed" | "failed" | "cancelled" | "expired";

/** 결제 요청의 내부 표준 모델. PG 응답 형태에 종속되지 않는다. */
export interface PaymentIntent {
  paymentId: string;
  ownerUsername: string;
  /** 1/100원 단위 정수. Wallet과 같은 단위를 쓴다(부동소수점 금지). */
  amount: number;
  currency: "KRW";
  status: PaymentStatus;
  /** 같은 충전 요청이 두 번 만들어지지 않게 한다. */
  idempotencyKey: string;
  provider: string;
  providerPaymentId: string | null;
  createdAt: string;
  confirmedAt: string | null;
  /** 실패/취소 사유. 민감정보는 담지 않는다. */
  failureReason: string | null;
}

/**
 * Provider가 돌려주는 결과. `rawStatus`로 원본을 보존하되, 제품 로직은 우리
 * `status`만 본다 — 그래야 PG를 바꿔도 도메인이 흔들리지 않는다.
 */
export interface PaymentResult {
  provider: string;
  providerPaymentId: string | null;
  status: PaymentStatus;
  /** PG 원본 상태 문자열(예: DONE / IN_PROGRESS / WAITING_FOR_DEPOSIT). 감사·디버깅용. */
  rawStatus: string | null;
  /** PG가 실제로 승인했다고 알려준 금액. 우리 요청 금액과 반드시 대조한다. */
  confirmedAmount: number | null;
  confirmedAt: string | null;
  failureReason?: string | null;
}

/** Webhook 원문을 검증해 얻은 내부 이벤트. 검증 실패는 이벤트가 아니다. */
export interface PaymentWebhookEvent {
  provider: string;
  providerPaymentId: string;
  /** 같은 이벤트가 여러 번 와도 한 번만 처리하기 위한 키. */
  eventId: string;
  status: PaymentStatus;
  rawStatus: string | null;
  amount: number | null;
  occurredAt: string;
}

export interface PaymentProvider {
  readonly name: string;
  /** 자격증명이 없으면 false — 호출 전에 확인해서 "실패"가 아니라 "미설정"으로 다룬다. */
  isConfigured(): boolean;
  /** 결제 생성. 실제 결제창 URL은 Provider가 준다(F3에서는 만들지 않는다). */
  createPayment(input: { ownerUsername: string; amount: number; idempotencyKey: string }): Promise<PaymentResult>;
  /** 서버 대 서버 조회 — 결제 성공 판단의 **최종 근거**는 항상 이쪽이다. */
  getPayment(providerPaymentId: string): Promise<PaymentResult>;
  /** 서명·무결성 검증. 검증되지 않은 payload는 이벤트로 만들지 않는다. */
  verifyWebhook(payload: unknown, headers: Record<string, string>): PaymentWebhookEvent | null;
}
