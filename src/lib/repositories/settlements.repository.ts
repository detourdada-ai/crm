import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Settlement, SettlementStatus } from "@/types/domain";

export interface SettlementUpsert {
  driver_id: string;
  period_start: string;
  period_end: string;
  delivery_count: number;
  amount: number;
}

export const settlementsRepository = {
  async findById(id: string): Promise<Settlement | null> {
    const { data, error } = await getSupabaseAdmin().from("settlements").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },

  async listByPeriod(periodStart: string, periodEnd: string): Promise<Settlement[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("settlements")
      .select("*")
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd);
    if (error) throw error;
    return data ?? [];
  },

  /** Refreshes delivery_count/amount for this driver+period, leaving `status`/`paid_at` untouched if the row already exists (they're only ever set explicitly by markPaid). */
  async upsertStats(input: SettlementUpsert): Promise<Settlement> {
    const { data, error } = await getSupabaseAdmin()
      .from("settlements")
      .upsert(input, { onConflict: "driver_id,period_start,period_end" })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * P8 2번: 완료→배송대기 되돌리기가 안전한지 판단하는 기준 — 정산은
   * completed_at을 매번 라이브 재계산하므로(computeSettlementRows 참고),
   * 이미 "지급완료"로 표시된 기간의 배송을 되돌리면 금액만 조용히 줄고
   * status는 paid로 남아 장부가 어긋난다. 그 기간에 이미 지급완료 정산이
   * 있는지만 확인한다(period_start/period_end는 KST 달력일 문자열).
   */
  async findPaidCoveringDate(driverId: string, kstDateStr: string): Promise<Settlement | null> {
    const { data, error } = await getSupabaseAdmin()
      .from("settlements")
      .select("*")
      .eq("driver_id", driverId)
      .eq("status", "paid")
      .lte("period_start", kstDateStr)
      .gte("period_end", kstDateStr)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * F15: ownerUsername이 주어지면(비-admin 호출) 정산 건이 속한 기사가
   * 실제로 그 소유주의 기사인지 DB에서 다시 확인한다 — settlements 테이블
   * 자체엔 owner_username이 없으므로 driver_id를 경유해 검증한다.
   */
  async updateStatus(id: string, status: SettlementStatus, ownerUsername?: string): Promise<Settlement> {
    const admin = getSupabaseAdmin();
    if (ownerUsername) {
      const { data: settlement, error: settlementError } = await admin
        .from("settlements")
        .select("driver_id")
        .eq("id", id)
        .maybeSingle();
      if (settlementError) throw settlementError;
      if (!settlement) throw new Error("정산 건을 찾을 수 없습니다.");
      const { data: driver, error: driverError } = await admin
        .from("drivers")
        .select("id")
        .eq("id", settlement.driver_id)
        .eq("owner_username", ownerUsername)
        .maybeSingle();
      if (driverError) throw driverError;
      if (!driver) throw new Error("이 정산 건을 처리할 권한이 없습니다.");
    }
    const { data, error } = await admin
      .from("settlements")
      .update({ status, paid_at: status === "paid" ? new Date().toISOString() : null })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },
};
