import "server-only";
import type { PaymentProvider, PaymentResult, PaymentWebhookEvent } from "./types";

/**
 * STEP15-F3 — 기본 구현체. **실제 결제를 만들지 않는다.**
 * PG를 아직 고르지 않았으므로 어떤 SDK도 가져오지 않는다.
 */
export class NoopPaymentProvider implements PaymentProvider {
  readonly name = "noop";

  isConfigured(): boolean {
    return false;
  }

  async createPayment(): Promise<PaymentResult> {
    return {
      provider: this.name,
      providerPaymentId: null,
      status: "failed",
      rawStatus: null,
      confirmedAmount: null,
      confirmedAt: null,
      failureReason: "payment_provider_not_configured",
    };
  }

  async getPayment(): Promise<PaymentResult> {
    return {
      provider: this.name,
      providerPaymentId: null,
      status: "failed",
      rawStatus: null,
      confirmedAmount: null,
      confirmedAt: null,
      failureReason: "payment_provider_not_configured",
    };
  }

  verifyWebhook(): PaymentWebhookEvent | null {
    // 검증할 서명 규칙 자체가 없다 — 어떤 payload도 이벤트로 인정하지 않는다.
    return null;
  }
}

/**
 * 환경변수로 Provider를 고른다. 지금은 어떤 PG도 등록하지 않았으므로 항상 Noop이다.
 * PG가 정해지면 여기 한 줄만 늘어나고 제품 로직은 바뀌지 않는다.
 */
export function getPaymentProvider(): PaymentProvider {
  return new NoopPaymentProvider();
}
