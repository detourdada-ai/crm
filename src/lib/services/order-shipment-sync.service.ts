import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { DeliveryStatus } from "@/types/domain";

/**
 * S1-1 Phase 5 (dual-write): 배송건(order_shipments)이 실제 배송 운영 단위가 된
 * 뒤에도, orders의 동명 컬럼(driver_id/delivery_status/completed_at/bag_number/
 * bag_returned/fulfillment_method)은 당분간 계속 살아있는 값으로 유지한다 —
 * 주문관리 "전체"(배송일 필터 없음) 화면이 이 컬럼을 그대로 읽으므로, 배송건을
 * 갱신할 때마다 여기서 orders 쪽도 같이 맞춰준다.
 *
 * 한 주문이 배송건 여러 개로 쪼개진 경우(발송일이 서로 다른 상품주문들) orders의
 * 단일 컬럼 하나로는 "그 주문 전체의 상태"를 완벽히 표현할 수 없다 — 이 경우
 * 아래 규칙으로 대표값을 만든다:
 *   - driver_id: 모든 배송건의 기사가 같으면 그 기사, 다르면(또는 일부만 배정)
 *     null(미배정으로 표시 — "여러 기사"를 나타낼 단일 값이 없으므로).
 *   - delivery_status: 취소 아닌 배송건 중 하나라도 배송중이면 배송중, 취소가
 *     아닌 모든 배송건이 완료면 완료, 일부만 완료면 배송중(진행 중으로 취급),
 *     그 외(전부 배송대기)면 배송대기, 전부 취소면 취소.
 *   - completed_at: 완료로 판정된 경우 배송건들의 completed_at 중 가장 늦은 값.
 *   - bag_number/bag_returned/fulfillment_method: 대표로 첫 번째 배송건 값을
 *     그대로 쓴다(가방/수령방식은 배송건마다 다를 수 있지만, orders 쪽은 어차피
 *     과도기 호환용 스냅샷일 뿐이라 완벽한 표현을 시도하지 않는다).
 */
export async function syncOrdersFromShipments(orderIds: string[]): Promise<void> {
  const distinctOrderIds = Array.from(new Set(orderIds));
  if (distinctOrderIds.length === 0) return;
  const admin = getSupabaseAdmin();

  const { data: shipments, error } = await admin
    .from("order_shipments")
    .select("order_id, driver_id, delivery_status, completed_at, bag_number, bag_returned, fulfillment_method")
    .in("order_id", distinctOrderIds);
  if (error) throw error;

  const byOrder = new Map<string, NonNullable<typeof shipments>>();
  for (const s of shipments ?? []) {
    const list = byOrder.get(s.order_id) ?? [];
    list.push(s);
    byOrder.set(s.order_id, list);
  }

  for (const orderId of distinctOrderIds) {
    const list = byOrder.get(orderId);
    if (!list || list.length === 0) continue;

    const distinctDrivers = new Set(list.map((s) => s.driver_id).filter((d): d is string => d !== null));
    const driverId = distinctDrivers.size === 1 ? [...distinctDrivers][0] : null;

    const statuses = list.map((s) => s.delivery_status as DeliveryStatus);
    const nonCancelled = statuses.filter((s) => s !== "취소");
    let deliveryStatus: DeliveryStatus;
    if (nonCancelled.length === 0) deliveryStatus = "취소";
    else if (nonCancelled.some((s) => s === "배송중")) deliveryStatus = "배송중";
    else if (nonCancelled.every((s) => s === "완료")) deliveryStatus = "완료";
    else if (nonCancelled.some((s) => s === "완료")) deliveryStatus = "배송중";
    else deliveryStatus = "배송대기";

    const completedAt =
      deliveryStatus === "완료"
        ? (list
            .map((s) => s.completed_at)
            .filter((v): v is string => v !== null)
            .sort()
            .at(-1) ?? null)
        : null;

    const first = list[0];
    const { error: updateError } = await admin
      .from("orders")
      .update({
        driver_id: driverId,
        delivery_status: deliveryStatus,
        completed_at: completedAt,
        bag_number: first.bag_number,
        bag_returned: first.bag_returned,
        fulfillment_method: first.fulfillment_method as "delivery" | "direct_pickup",
      })
      .eq("id", orderId);
    if (updateError) throw updateError;
  }
}
