import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * STEP15-F2 — 메시지 지갑.
 *
 * **금액은 정수만 다룬다.** 최소 단위는 1/100원(전)이고, 화면에 보여줄 때만 100으로
 * 나눈다. 알림톡 6.5원 같은 원 단위 이하 단가를 650으로 정확히 표현하기 위해서다
 * (부동소수점을 쓰면 반올림 오차가 원장에 남는다).
 *
 * 잔액 변경과 원장 기록은 **한 트랜잭션**이어야 하므로 전부 RPC 하나
 * (`message_wallet_apply_transaction`)로 처리한다. PostgREST로 update+insert를
 * 나눠 부르면 중간에 실패했을 때 "돈은 줄었는데 기록이 없는" 상태가 생긴다.
 */
export const AMOUNT_UNIT_PER_KRW = 100;

export type WalletTransactionType = "charge" | "reserve" | "capture" | "release" | "adjust";

export interface WalletBalance {
  availableBalance: number;
  reservedBalance: number;
  amountUnit: string;
}

export interface WalletTransactionRow {
  id: string;
  type: WalletTransactionType;
  amount: number;
  reference_type: string;
  reason: string | null;
  created_by: string;
  available_after: number;
  reserved_after: number;
  created_at: string;
}

export interface ApplyResult {
  ok: boolean;
  transactionId?: string;
  availableBalance?: number;
  reservedBalance?: number;
  /** 이미 처리된 거래를 다시 요청한 경우 — 실패가 아니다. */
  duplicated?: boolean;
  error?: string;
}

/** 1/100원 단위 정수를 화면용 원 문자열로. */
export function formatAmount(units: number): string {
  const won = units / AMOUNT_UNIT_PER_KRW;
  return `${Number.isInteger(won) ? won.toLocaleString() : won.toFixed(2)}원`;
}

export const walletService = {
  /** 지갑이 없으면 null. 조회만으로는 지갑을 만들지 않는다(거래가 생길 때 RPC가 만든다). */
  async getBalance(ownerUsername: string): Promise<WalletBalance | null> {
    const { data } = await getSupabaseAdmin()
      .from("message_wallet")
      .select("available_balance, reserved_balance, amount_unit")
      .eq("owner_username", ownerUsername)
      .maybeSingle();
    if (!data) return null;
    return {
      availableBalance: data.available_balance,
      reservedBalance: data.reserved_balance,
      amountUnit: data.amount_unit,
    };
  },

  async listTransactions(ownerUsername: string, limit = 50): Promise<WalletTransactionRow[]> {
    const { data } = await getSupabaseAdmin()
      .from("message_wallet_transactions")
      .select("id, type, amount, reference_type, reason, created_by, available_after, reserved_after, created_at")
      .eq("owner_username", ownerUsername)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data as WalletTransactionRow[]) ?? [];
  },

  /**
   * 모든 금액 이동의 단일 진입점.
   * `idempotencyKey`를 주면 같은 키의 같은 종류 거래는 두 번 생기지 않는다
   * (DB unique 인덱스가 최종 방어선이라 다중 인스턴스에서도 안전하다).
   */
  async apply(params: {
    ownerUsername: string;
    type: WalletTransactionType;
    amount: number;
    referenceType?: string;
    referenceId?: string | null;
    messageLogId?: string | null;
    idempotencyKey?: string | null;
    createdBy?: string;
    reason?: string | null;
  }): Promise<ApplyResult> {
    try {
      const { data, error } = await getSupabaseAdmin().rpc("message_wallet_apply_transaction", {
        p_owner_username: params.ownerUsername,
        p_type: params.type,
        p_amount: params.amount,
        p_reference_type: params.referenceType ?? "system",
        p_reference_id: params.referenceId ?? null,
        p_message_log_id: params.messageLogId ?? null,
        p_idempotency_key: params.idempotencyKey ?? null,
        p_created_by: params.createdBy ?? "system",
        p_reason: params.reason ?? null,
      });
      if (error) return { ok: false, error: error.message };
      const result = data as { transaction_id: string; available_balance: number; reserved_balance: number; duplicated: boolean };
      return {
        ok: true,
        transactionId: result.transaction_id,
        availableBalance: result.available_balance,
        reservedBalance: result.reserved_balance,
        duplicated: result.duplicated,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "wallet_error" };
    }
  },
};
