import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { kstDayStrOf } from "@/lib/utils/kst-date";

/**
 * Phase 5: allocates system-internal order numbers ("YYYYMMDD" + 4-digit
 * per-tenant sequence, e.g. 202608140001) for a batch of orders about to be
 * created, in one round trip per distinct KST calendar day represented in
 * the batch (not one round trip per order — see next_order_seq_batch's doc
 * comment in migrations/0026 for why: import batches must stay bulk to keep
 * Sprint 14-I's import-performance work intact).
 *
 * Returns numbers in the exact same order as the input `orderDates`.
 */
export async function allocateOrderNumbers(tenantId: string, orderDates: string[]): Promise<string[]> {
  if (orderDates.length === 0) return [];

  const dayStrs = orderDates.map(kstDayStrOf);
  const countByDay = new Map<string, number>();
  for (const day of dayStrs) countByDay.set(day, (countByDay.get(day) ?? 0) + 1);

  const admin = getSupabaseAdmin();
  const startSeqByDay = new Map<string, number>();
  for (const [day, count] of countByDay) {
    const { data, error } = await admin.rpc("next_order_seq_batch", {
      p_tenant_id: tenantId,
      p_day_str: day,
      p_count: count,
    });
    if (error) throw error;
    startSeqByDay.set(day, data as number);
  }

  const nextSeqByDay = new Map(startSeqByDay);
  return dayStrs.map((day) => {
    const seq = nextSeqByDay.get(day)!;
    nextSeqByDay.set(day, seq + 1);
    return `${day}${String(seq).padStart(4, "0")}`;
  });
}
