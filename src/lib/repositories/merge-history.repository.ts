import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { MergeHistoryRecord } from "@/types/domain";

export interface MergeCustomersResult {
  merge_history_id: string;
  kept_customer_id: string;
  removed_customer_id: string;
  orders_moved: number;
}

export interface UnmergeCustomersResult {
  merge_history_id: string;
  kept_customer_id: string;
  removed_customer_id: string;
  orders_restored: number;
  orders_skipped: number;
  orders_total: number;
}

export const mergeHistoryRepository = {
  async findById(id: string): Promise<MergeHistoryRecord | null> {
    const { data, error } = await getSupabaseAdmin().from("merge_history").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data as MergeHistoryRecord | null;
  },

  async listByCustomer(customerId: string): Promise<MergeHistoryRecord[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("merge_history")
      .select("*")
      .or(`kept_customer_id.eq.${customerId},removed_customer_id.eq.${customerId}`)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as MergeHistoryRecord[]) ?? [];
  },

  /**
   * STEP12-15: 병합 전체(주문 재할당 + merge_history 기록 + 고객 상태 변경 +
   * 후보 상태 처리)를 단일 Postgres 함수 호출로 실행한다 — 함수 호출 자체가
   * 하나의 트랜잭션이라 중간 실패 시 전체가 롤백된다(0052 마이그레이션).
   */
  async mergeCustomers(candidateId: string, performedBy: string): Promise<MergeCustomersResult> {
    const { data, error } = await getSupabaseAdmin().rpc("merge_customers", {
      p_candidate_id: candidateId,
      p_performed_by: performedBy,
    });
    if (error) throw error;
    return data as MergeCustomersResult;
  },

  /**
   * STEP12-15: merge_history.moved_order_ids에 기록된 주문 중 지금도 여전히
   * kept_customer_id 소유인 것만 되돌린다 — 연쇄 병합으로 이미 다른 곳으로
   * 넘어간 주문은 건드리지 않는다(0052 마이그레이션의 unmerge_customers).
   */
  async unmergeCustomers(mergeHistoryId: string, performedBy: string): Promise<UnmergeCustomersResult> {
    const { data, error } = await getSupabaseAdmin().rpc("unmerge_customers", {
      p_merge_history_id: mergeHistoryId,
      p_performed_by: performedBy,
    });
    if (error) throw error;
    return data as UnmergeCustomersResult;
  },
};
