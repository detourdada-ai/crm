import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * STEP15-F3C — 충전 의도(Charge Intent).
 *
 *   payments  = 돈을 낸 사실
 *   intent    = **어떤 이유로 얼마의 크레딧을 지급할 것인가**
 *   wallet    = 실제 잔액
 *
 * 지급 실행은 전부 `message_charge_intent_grant()` RPC로만 한다. 애플리케이션에서
 * "Wallet 충전 → Intent 갱신" 두 번으로 나누면 중간 장애 때 반쪽 상태가 생긴다.
 *
 * 금액 정책(충전 상품·보너스)은 **여기에 없다.** 호출자가 넘긴 값을 그대로 쓰고,
 * 그 시점 근거는 `policySnapshot`에 데이터로 남는다.
 */
export type ChargeIntentKind = "payment" | "admin_grant" | "promotion" | "compensation";
export type ChargeIntentStatus = "created" | "pending" | "granted" | "cancelled" | "failed" | "expired";

export interface ChargeIntent {
  id: string;
  ownerUsername: string;
  kind: ChargeIntentKind;
  status: ChargeIntentStatus;
  walletAmount: number;
  bonusAmount: number;
  totalAmount: number;
  paymentId: string | null;
  reason: string | null;
  grantedAt: string | null;
  grantedBy: string | null;
  createdAt: string;
}

const SELECT =
  "id, owner_username, kind, status, wallet_amount, bonus_amount, total_amount, payment_id, reason, granted_at, granted_by, created_at";

type Row = {
  id: string;
  owner_username: string;
  kind: ChargeIntentKind;
  status: ChargeIntentStatus;
  wallet_amount: number;
  bonus_amount: number;
  total_amount: number;
  payment_id: string | null;
  reason: string | null;
  granted_at: string | null;
  granted_by: string | null;
  created_at: string;
};

function toIntent(row: Row): ChargeIntent {
  return {
    id: row.id,
    ownerUsername: row.owner_username,
    kind: row.kind,
    status: row.status,
    walletAmount: row.wallet_amount,
    bonusAmount: row.bonus_amount,
    totalAmount: row.total_amount,
    paymentId: row.payment_id,
    reason: row.reason,
    grantedAt: row.granted_at,
    grantedBy: row.granted_by,
    createdAt: row.created_at,
  };
}

export interface CreateChargeIntentInput {
  ownerUsername: string;
  kind: ChargeIntentKind;
  walletAmount: number;
  bonusAmount?: number;
  paymentId?: string | null;
  policySnapshot?: Record<string, unknown> | null;
  reason?: string | null;
  idempotencyKey: string;
  status?: ChargeIntentStatus;
}

export const chargeIntentService = {
  async create(
    input: CreateChargeIntentInput
  ): Promise<{ ok: boolean; intent?: ChargeIntent; duplicated?: boolean; error?: string }> {
    try {
      const bonus = input.bonusAmount ?? 0;
      if (!Number.isInteger(input.walletAmount) || input.walletAmount < 0) return { ok: false, error: "invalid_wallet_amount" };
      if (!Number.isInteger(bonus) || bonus < 0) return { ok: false, error: "invalid_bonus_amount" };
      if (input.walletAmount + bonus <= 0) return { ok: false, error: "invalid_total_amount" };

      const admin = getSupabaseAdmin();
      const { data: tenant } = await admin.from("tenants").select("id").eq("slug", input.ownerUsername).maybeSingle();
      if (!tenant) return { ok: false, error: "tenant_not_found" };

      const { data, error } = await admin
        .from("message_charge_intents")
        .insert({
          tenant_id: tenant.id,
          owner_username: input.ownerUsername,
          kind: input.kind,
          status: input.status ?? "created",
          wallet_amount: input.walletAmount,
          bonus_amount: bonus,
          total_amount: input.walletAmount + bonus,
          payment_id: input.paymentId ?? null,
          policy_snapshot: input.policySnapshot ?? null,
          reason: input.reason ?? null,
          idempotency_key: input.idempotencyKey,
        })
        .select(SELECT)
        .maybeSingle();

      if (error) {
        // unique 위반 = 같은 요청이 두 번 왔다. 새로 만들지 않고 기존 것을 돌려준다.
        const existing = await this.findByIdempotencyKey(input.ownerUsername, input.idempotencyKey);
        if (existing) return { ok: true, intent: existing, duplicated: true };
        return { ok: false, error: error.message };
      }
      return { ok: true, intent: toIntent(data as Row) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "charge_intent_error" };
    }
  },

  async findById(id: string): Promise<ChargeIntent | null> {
    const { data } = await getSupabaseAdmin().from("message_charge_intents").select(SELECT).eq("id", id).maybeSingle();
    return data ? toIntent(data as Row) : null;
  },

  async findByIdempotencyKey(ownerUsername: string, idempotencyKey: string): Promise<ChargeIntent | null> {
    const { data } = await getSupabaseAdmin()
      .from("message_charge_intents")
      .select(SELECT)
      .eq("owner_username", ownerUsername)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    return data ? toIntent(data as Row) : null;
  },

  /**
   * 지급 실행. Wallet 충전과 Intent 상태 변경이 **한 트랜잭션**에서 일어난다.
   * 실패하면 둘 다 롤백되고, 이미 지급된 건은 `duplicated: true`로 돌아온다.
   */
  async grant(intentId: string, performedBy = "system"): Promise<{ ok: boolean; duplicated?: boolean; error?: string }> {
    try {
      const { data, error } = await getSupabaseAdmin().rpc("message_charge_intent_grant", {
        p_intent_id: intentId,
        p_performed_by: performedBy,
      });
      if (error) return { ok: false, error: error.message };
      const result = data as { duplicated?: boolean };
      return { ok: true, duplicated: result?.duplicated === true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "grant_error" };
    }
  },
};
