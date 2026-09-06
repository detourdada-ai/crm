import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { PaymentIntent, PaymentStatus } from "./types";
import type { PaymentStore } from "./payment.service";

type Row = {
  id: string;
  owner_username: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider: string;
  provider_payment_id: string | null;
  idempotency_key: string;
  failure_reason: string | null;
  created_at: string;
  confirmed_at: string | null;
};

function toIntent(row: Row): PaymentIntent {
  return {
    paymentId: row.id,
    ownerUsername: row.owner_username,
    amount: row.amount,
    currency: "KRW",
    status: row.status,
    idempotencyKey: row.idempotency_key,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    failureReason: row.failure_reason,
  };
}

const SELECT = "id, owner_username, amount, currency, status, provider, provider_payment_id, idempotency_key, failure_reason, created_at, confirmed_at";

/**
 * STEP15-F3A — DB 기반 Payment 저장소.
 *
 * 멱등성의 최종 방어선은 애플리케이션이 아니라 **DB unique 제약**이다
 * (`uq_payments_owner_idempotency`, `uq_payments_provider_payment_id`,
 *  `uq_payment_events_provider_event`). 그래서 insert가 unique 위반으로 실패하면
 * 실패로 처리하지 않고 **이미 있는 행을 돌려준다** — 동시 요청에서 진 쪽도 같은 결제를 본다.
 */
export class SupabasePaymentStore implements PaymentStore {
  constructor(private readonly tenantIdResolver: (ownerUsername: string) => Promise<string | null>) {}

  async findByIdempotencyKey(ownerUsername: string, idempotencyKey: string): Promise<PaymentIntent | null> {
    const { data } = await getSupabaseAdmin()
      .from("payments")
      .select(SELECT)
      .eq("owner_username", ownerUsername)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    return data ? toIntent(data as Row) : null;
  }

  async findByProviderPaymentId(provider: string, providerPaymentId: string): Promise<PaymentIntent | null> {
    const { data } = await getSupabaseAdmin()
      .from("payments")
      .select(SELECT)
      .eq("provider", provider)
      .eq("provider_payment_id", providerPaymentId)
      .maybeSingle();
    return data ? toIntent(data as Row) : null;
  }

  async findById(paymentId: string): Promise<PaymentIntent | null> {
    const { data } = await getSupabaseAdmin().from("payments").select(SELECT).eq("id", paymentId).maybeSingle();
    return data ? toIntent(data as Row) : null;
  }

  async insert(intent: PaymentIntent): Promise<PaymentIntent> {
    const tenantId = await this.tenantIdResolver(intent.ownerUsername);
    if (!tenantId) throw new Error("tenant_not_found");
    const { data, error } = await getSupabaseAdmin()
      .from("payments")
      .insert({
        id: intent.paymentId,
        tenant_id: tenantId,
        owner_username: intent.ownerUsername,
        amount: intent.amount,
        currency: intent.currency,
        status: intent.status,
        provider: intent.provider,
        provider_payment_id: intent.providerPaymentId,
        idempotency_key: intent.idempotencyKey,
        failure_reason: intent.failureReason,
      })
      .select(SELECT)
      .maybeSingle();

    if (error) {
      // unique 위반 = 동시 요청에서 진 쪽. 새로 만들지 말고 이미 있는 것을 돌려준다.
      const existing = await this.findByIdempotencyKey(intent.ownerUsername, intent.idempotencyKey);
      if (existing) return existing;
      throw error;
    }
    return toIntent(data as Row);
  }

  async updateStatus(
    paymentId: string,
    patch: Partial<Pick<PaymentIntent, "status" | "providerPaymentId" | "confirmedAt" | "failureReason">>
  ): Promise<void> {
    await getSupabaseAdmin()
      .from("payments")
      .update({
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.providerPaymentId !== undefined ? { provider_payment_id: patch.providerPaymentId } : {}),
        ...(patch.confirmedAt !== undefined ? { confirmed_at: patch.confirmedAt } : {}),
        ...(patch.failureReason !== undefined ? { failure_reason: patch.failureReason } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId);
  }

  /** 이미 처리한 이벤트면 false. unique 위반을 그대로 멱등 판정에 쓴다. */
  async markWebhookProcessed(provider: string, eventId: string): Promise<boolean> {
    const { error } = await getSupabaseAdmin().from("payment_events").insert({ provider, event_id: eventId });
    return !error;
  }

  /** 이벤트 원본과 처리 결과를 남긴다 — 거부된 이벤트도 "받은 적 없다"가 되면 안 된다. */
  async recordEvent(input: {
    provider: string;
    eventId: string;
    paymentId?: string | null;
    status?: PaymentStatus | null;
    rawStatus?: string | null;
    amount?: number | null;
    payload?: unknown;
    processingResult: "received" | "applied" | "duplicate" | "rejected" | "error";
    rejectionReason?: string | null;
  }): Promise<void> {
    await getSupabaseAdmin()
      .from("payment_events")
      .update({
        payment_id: input.paymentId ?? null,
        status: input.status ?? null,
        raw_status: input.rawStatus ?? null,
        amount: input.amount ?? null,
        payload: (input.payload ?? null) as Record<string, unknown> | null,
        processing_result: input.processingResult,
        rejection_reason: input.rejectionReason ?? null,
        processed_at: new Date().toISOString(),
      })
      .eq("provider", input.provider)
      .eq("event_id", input.eventId);
  }
}

/** 기본 인스턴스 — tenant_id는 slug로 찾는다(프로젝트 관례). */
export function createPaymentStore(): SupabasePaymentStore {
  return new SupabasePaymentStore(async (ownerUsername) => {
    const { data } = await getSupabaseAdmin().from("tenants").select("id").eq("slug", ownerUsername).maybeSingle();
    return data?.id ?? null;
  });
}
