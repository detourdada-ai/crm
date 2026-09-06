import "server-only";
import { randomUUID } from "node:crypto";
import { getPaymentProvider } from "./noop-provider";
import type { PaymentIntent, PaymentProvider, PaymentStatus, PaymentWebhookEvent } from "./types";

/**
 * STEP15-F3 — 결제 도메인 서비스.
 *
 * **저장소를 아직 만들지 않았다.** Payment 테이블은 migration이 필요하고, 그건
 * STOP 보고 대상이라 이번 단계에서 적용하지 않는다. 대신 저장 요구사항을
 * `PaymentStore` 인터페이스로 못 박아 두고, 지금은 메모리 구현으로 경계를 검증한다.
 * DB가 승인되면 이 인터페이스를 구현한 repository만 갈아끼우면 된다.
 */
export interface PaymentStore {
  findByIdempotencyKey(ownerUsername: string, idempotencyKey: string): Promise<PaymentIntent | null>;
  findByProviderPaymentId(provider: string, providerPaymentId: string): Promise<PaymentIntent | null>;
  findById(paymentId: string): Promise<PaymentIntent | null>;
  insert(intent: PaymentIntent): Promise<PaymentIntent>;
  updateStatus(paymentId: string, patch: Partial<Pick<PaymentIntent, "status" | "providerPaymentId" | "confirmedAt" | "failureReason">>): Promise<void>;
  /** 같은 webhook 이벤트를 두 번 처리하지 않기 위한 기록. 이미 있으면 false. */
  markWebhookProcessed(provider: string, eventId: string): Promise<boolean>;
}

/** F3 검증용 인메모리 구현 — 프로덕션 경로에서는 쓰지 않는다. */
export class InMemoryPaymentStore implements PaymentStore {
  private readonly intents = new Map<string, PaymentIntent>();
  private readonly events = new Set<string>();

  async findByIdempotencyKey(ownerUsername: string, idempotencyKey: string): Promise<PaymentIntent | null> {
    for (const intent of this.intents.values()) {
      if (intent.ownerUsername === ownerUsername && intent.idempotencyKey === idempotencyKey) return intent;
    }
    return null;
  }
  async findByProviderPaymentId(provider: string, providerPaymentId: string): Promise<PaymentIntent | null> {
    for (const intent of this.intents.values()) {
      if (intent.provider === provider && intent.providerPaymentId === providerPaymentId) return intent;
    }
    return null;
  }
  async findById(paymentId: string): Promise<PaymentIntent | null> {
    return this.intents.get(paymentId) ?? null;
  }
  async insert(intent: PaymentIntent): Promise<PaymentIntent> {
    this.intents.set(intent.paymentId, intent);
    return intent;
  }
  async updateStatus(paymentId: string, patch: Partial<PaymentIntent>): Promise<void> {
    const cur = this.intents.get(paymentId);
    if (cur) this.intents.set(paymentId, { ...cur, ...patch });
  }
  async markWebhookProcessed(provider: string, eventId: string): Promise<boolean> {
    const key = `${provider}:${eventId}`;
    if (this.events.has(key)) return false;
    this.events.add(key);
    return true;
  }
}

export interface CreatePaymentOutcome {
  ok: boolean;
  intent?: PaymentIntent;
  /** 같은 idempotencyKey로 이미 만든 결제를 그대로 돌려준 경우 — 실패가 아니다. */
  duplicated?: boolean;
  error?: string;
}

export class PaymentService {
  constructor(
    private readonly store: PaymentStore,
    private readonly provider: PaymentProvider = getPaymentProvider()
  ) {}

  /**
   * 충전 결제 생성. 같은 키로 다시 부르면 새 결제를 만들지 않는다.
   * Provider가 미설정이면 **결제를 만들지 않고** 그 사실만 알린다(가짜 성공 금지).
   */
  async createPayment(params: { ownerUsername: string; amount: number; idempotencyKey: string }): Promise<CreatePaymentOutcome> {
    try {
      if (!Number.isInteger(params.amount) || params.amount <= 0) return { ok: false, error: "invalid_amount" };

      const existing = await this.store.findByIdempotencyKey(params.ownerUsername, params.idempotencyKey);
      if (existing) return { ok: true, intent: existing, duplicated: true };

      if (!this.provider.isConfigured()) return { ok: false, error: "payment_provider_not_configured" };

      const result = await this.provider.createPayment(params);
      const intent: PaymentIntent = {
        paymentId: randomUUID(),
        ownerUsername: params.ownerUsername,
        amount: params.amount,
        currency: "KRW",
        status: result.status === "confirmed" ? "pending" : result.status,
        idempotencyKey: params.idempotencyKey,
        provider: this.provider.name,
        providerPaymentId: result.providerPaymentId,
        createdAt: new Date().toISOString(),
        confirmedAt: null,
        failureReason: result.failureReason ?? null,
      };
      // 생성 응답만으로 confirmed를 만들지 않는다 — 확정은 서버 조회/Webhook 검증 후다.
      await this.store.insert(intent);
      return { ok: true, intent };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "payment_error" };
    }
  }

  /**
   * Webhook 처리 경계.
   *
   *   payload → verifyWebhook(서명 검증) → 중복 이벤트 차단 → 서버 조회로 재확인
   *   → 금액 대조 → 상태 반영
   *
   * **결제 성공이 잔액을 바꾸지 않는다.** 충전은 확인된 결제를 근거로 별도의
   * wallet charge에서 일어나야 하고, F3에서는 그 연결을 하지 않는다.
   */
  async handleWebhook(payload: unknown, headers: Record<string, string>): Promise<{ ok: boolean; status?: PaymentStatus; reason?: string }> {
    try {
      const event: PaymentWebhookEvent | null = this.provider.verifyWebhook(payload, headers);
      // 검증되지 않은 payload는 이벤트로 취급하지 않는다(위조 방지).
      if (!event) return { ok: false, reason: "invalid_signature" };

      const fresh = await this.store.markWebhookProcessed(event.provider, event.eventId);
      if (!fresh) return { ok: true, reason: "duplicate_event" };

      const intent = await this.store.findByProviderPaymentId(event.provider, event.providerPaymentId);
      if (!intent) return { ok: false, reason: "unknown_payment" };

      // Webhook 값만 믿지 않는다 — 최종 근거는 서버 대 서버 조회다.
      const verified = await this.provider.getPayment(event.providerPaymentId);
      if (verified.status === "confirmed") {
        if (verified.confirmedAmount !== intent.amount) {
          await this.store.updateStatus(intent.paymentId, { status: "failed", failureReason: "amount_mismatch" });
          return { ok: false, reason: "amount_mismatch" };
        }
        await this.store.updateStatus(intent.paymentId, {
          status: "confirmed",
          confirmedAt: verified.confirmedAt ?? new Date().toISOString(),
        });
        return { ok: true, status: "confirmed" };
      }

      await this.store.updateStatus(intent.paymentId, { status: verified.status, failureReason: verified.failureReason ?? null });
      return { ok: true, status: verified.status };
    } catch {
      // 결제 처리 실패가 다른 업무로 번지지 않게 한다(메시지 dispatch와 같은 원칙).
      return { ok: false, reason: "handler_error" };
    }
  }
}
