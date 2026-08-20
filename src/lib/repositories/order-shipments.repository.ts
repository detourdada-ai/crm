import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { kstDayStartIso, kstDayEndIso } from "@/lib/utils/kst-date";
import { syncOrdersFromShipments } from "@/lib/services/order-shipment-sync.service";
import type { Order, OrderShipment, FulfillmentMethod } from "@/types/domain";

export interface OrderShipmentInsert {
  id?: string; // client-generated (crypto.randomUUID()) — lets order_items reference the shipment before the actual insert round-trip, same pattern as OrderInsert.id
  order_id: string;
  tenant_id: string;
  owner_username: string;
  delivery_date?: string | null;
}

/**
 * S1-1 Phase 5: 배송관리/기사배정/배송완료가 이제 이 행 하나를 단위로
 * 동작한다. `id`는 실제 주문 id(주문상세 링크·수령인/주소 등 스냅샷은 여전히
 * orders에서 온다)이고, 배송 운영 필드(driver_id/delivery_status 등)는
 * 배송건 자신의 값으로 덮어써져 있다 — actions/orders.ts의 OrderShipmentRow와
 * 동일한 패턴이며, 이 타입이 그 상위 호환이다(delivery_date만 덮던 것에서
 * 운영 필드 전체를 덮는 것으로 확장).
 */
export interface OrderShipmentBoardRow extends Order {
  shipmentId: string;
  rowKey: string;
}

function toBoardRows(shipments: OrderShipment[], orders: Order[]): OrderShipmentBoardRow[] {
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const rows: OrderShipmentBoardRow[] = [];
  for (const s of shipments) {
    const order = orderById.get(s.order_id);
    if (!order) continue; // 방어적: FK cascade 반영 전 시점의 정합성 어긋남 대비
    rows.push({
      ...order,
      shipmentId: s.id,
      rowKey: s.id,
      delivery_date: s.delivery_date,
      driver_id: s.driver_id,
      delivery_status: s.delivery_status,
      completed_at: s.completed_at,
      cancelled_at: s.cancelled_at,
      bag_number: s.bag_number,
      bag_returned: s.bag_returned,
      fulfillment_method: s.fulfillment_method,
      delivery_group_id: s.delivery_group_id,
    });
  }
  return rows;
}

async function fetchBoardRowsForShipments(shipments: OrderShipment[]): Promise<OrderShipmentBoardRow[]> {
  if (shipments.length === 0) return [];
  const orderIds = Array.from(new Set(shipments.map((s) => s.order_id)));
  const { data: orderRows, error } = await getSupabaseAdmin().from("orders").select("*").in("id", orderIds);
  if (error) throw error;
  return toBoardRows(shipments, (orderRows as Order[]) ?? []);
}

/** findByDeliveryDate/findEligibleForGrouping이 공유하는 배송건 범위 조회 — 취소 제외 + 소유권 스코프. */
async function fetchShipmentsInRange(dateStr: string, ownerUsername?: string): Promise<OrderShipmentBoardRow[]> {
  let q = getSupabaseAdmin()
    .from("order_shipments")
    .select("*")
    .neq("delivery_status", "취소")
    .gte("delivery_date", kstDayStartIso(dateStr))
    .lte("delivery_date", kstDayEndIso(dateStr));
  if (ownerUsername) q = q.eq("owner_username", ownerUsername);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) throw error;
  return fetchBoardRowsForShipments((data as OrderShipment[]) ?? []);
}

export const orderShipmentsRepository = {
  async createMany(shipments: OrderShipmentInsert[]): Promise<OrderShipment[]> {
    if (shipments.length === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("order_shipments").insert(shipments).select("*");
    if (error) throw error;
    return (data as OrderShipment[]) ?? [];
  },

  async findByIds(shipmentIds: string[]): Promise<OrderShipment[]> {
    if (shipmentIds.length === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("order_shipments").select("*").in("id", shipmentIds);
    if (error) throw error;
    return (data as OrderShipment[]) ?? [];
  },

  /** 주문상세 화면: 이 주문이 발송일 차이로 몇 개의 배송건으로 쪼개졌는지 조회(취소 포함 — 상세화면은 전체를 봐야 함). */
  async findByOrderId(orderId: string): Promise<OrderShipment[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("order_shipments")
      .select("*")
      .eq("order_id", orderId)
      .order("delivery_date", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return (data as OrderShipment[]) ?? [];
  },

  /** 배송그룹 재계산 시 "재계산 직전 소속"을 알아야 group_no/driver_id를 최대한 유지할 수 있다 — 그 소속 조회. */
  async findByGroupIds(groupIds: string[]): Promise<OrderShipment[]> {
    if (groupIds.length === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("order_shipments").select("*").in("delivery_group_id", groupIds);
    if (error) throw error;
    return (data as OrderShipment[]) ?? [];
  },

  /** 배송관리 board: [dateFrom, dateTo] 범위(둘 다 KST 달력일, inclusive)의 배송건 전체 — dateFrom===null이면 "전체". orders.findByDeliveryDate와 동일한 원칙(취소 제외). */
  async findByDeliveryDate(dateFrom: string | null, ownerUsername?: string, dateTo?: string): Promise<OrderShipmentBoardRow[]> {
    let q = getSupabaseAdmin().from("order_shipments").select("*").neq("delivery_status", "취소");
    if (dateFrom) q = q.gte("delivery_date", kstDayStartIso(dateFrom)).lte("delivery_date", kstDayEndIso(dateTo ?? dateFrom));
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("created_at", { ascending: true });
    if (error) throw error;
    return fetchBoardRowsForShipments((data as OrderShipment[]) ?? []);
  },

  /** Phase 4/S1-1 Phase 5: 배송 그룹화 대상 배송건 — 취소 제외 + 부모 주문의 좌표 확보(geocode_status='success')까지 요구한다. */
  async findEligibleForGrouping(dateStr: string, ownerUsername?: string): Promise<OrderShipmentBoardRow[]> {
    const rows = await fetchShipmentsInRange(dateStr, ownerUsername);
    return rows.filter((r) => r.geocode_status === "success" && r.latitude !== null && r.longitude !== null);
  },

  /** 그룹 재계산 시작 시 해당 (tenant, 배송일)의 기존 배송건 그룹 소속을 모두 비운다. */
  async clearDeliveryGroupsForDate(tenantId: string, dateStr: string): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from("order_shipments")
      .update({ delivery_group_id: null })
      .eq("tenant_id", tenantId)
      .gte("delivery_date", kstDayStartIso(dateStr))
      .lte("delivery_date", kstDayEndIso(dateStr))
      .not("delivery_group_id", "is", null);
    if (error) throw error;
  },

  /** 클러스터링 결과에 따라 배송건들을 그룹에 배정한다. */
  async assignShipmentsToGroup(shipmentIds: string[], groupId: string): Promise<void> {
    if (shipmentIds.length === 0) return;
    const { error } = await getSupabaseAdmin().from("order_shipments").update({ delivery_group_id: groupId }).in("id", shipmentIds);
    if (error) throw error;
  },

  /**
   * 배송건에 기사를 배정하고 배송중으로 전환한다("기사 변경"도 동일 — 이미
   * 배송중인 배송건에 다시 호출하면 기사만 바뀐다). orders.assignDriver와
   * 동일한 이중검증(action layer + 여기) 원칙을 그대로 따른다 — ownerUsername이
   * 있으면(비-admin) 배송건과 기사 모두 그 owner 소유인지 재확인한 뒤에만
   * 쓴다. 같은 주문의 다른 배송건은 건드리지 않는다 — 배송일이 다르면
   * 서로 독립적으로 배정 가능해야 한다(CPO 지시).
   */
  async assignDriver(shipmentIds: string[], driverId: string, ownerUsername?: string): Promise<void> {
    if (shipmentIds.length === 0) return;
    const admin = getSupabaseAdmin();

    if (ownerUsername) {
      const [{ data: owned, error: shipmentsCheckError }, { data: driver, error: driverCheckError }] = await Promise.all([
        admin.from("order_shipments").select("id").in("id", shipmentIds).eq("owner_username", ownerUsername),
        admin.from("drivers").select("id").eq("id", driverId).eq("owner_username", ownerUsername).maybeSingle(),
      ]);
      if (shipmentsCheckError) throw shipmentsCheckError;
      if (driverCheckError) throw driverCheckError;
      if ((owned?.length ?? 0) !== shipmentIds.length || !driver) {
        throw new Error("배정 권한이 없는 배송건 또는 기사가 포함되어 있습니다.");
      }
    }

    const { data: targets, error: targetsError } = await admin
      .from("order_shipments")
      .select("id, order_id, delivery_status")
      .in("id", shipmentIds);
    if (targetsError) throw targetsError;
    const blocked = (targets ?? []).filter((s) => s.delivery_status === "완료" || s.delivery_status === "취소");
    if (blocked.length > 0) {
      throw new Error("이미 배송완료되었거나 취소된 배송건은 기사를 배정/변경할 수 없습니다.");
    }

    const { error } = await admin.from("order_shipments").update({ driver_id: driverId, delivery_status: "배송중" }).in("id", shipmentIds);
    if (error) throw error;

    await syncOrdersFromShipments((targets ?? []).map((s) => s.order_id));
  },

  async unassignDriver(shipmentIds: string[], ownerUsername?: string): Promise<void> {
    if (shipmentIds.length === 0) return;
    const admin = getSupabaseAdmin();
    if (ownerUsername) {
      const { data: owned, error: checkError } = await admin
        .from("order_shipments")
        .select("id")
        .in("id", shipmentIds)
        .eq("owner_username", ownerUsername);
      if (checkError) throw checkError;
      if ((owned?.length ?? 0) !== shipmentIds.length) {
        throw new Error("배정 해제 권한이 없는 배송건이 포함되어 있습니다.");
      }
    }

    const { data: targets, error: targetsError } = await admin
      .from("order_shipments")
      .select("id, order_id, delivery_status")
      .in("id", shipmentIds);
    if (targetsError) throw targetsError;
    const blocked = (targets ?? []).filter((s) => s.delivery_status === "완료" || s.delivery_status === "취소");
    if (blocked.length > 0) {
      throw new Error("이미 배송완료되었거나 취소된 배송건은 배정을 해제할 수 없습니다.");
    }

    const { error } = await admin.from("order_shipments").update({ driver_id: null, delivery_status: "배송대기" }).in("id", shipmentIds);
    if (error) throw error;

    await syncOrdersFromShipments((targets ?? []).map((s) => s.order_id));
  },

  async startDelivery(shipmentIds: string[], ownerUsername?: string): Promise<number> {
    if (shipmentIds.length === 0) return 0;
    const admin = getSupabaseAdmin();
    let q = admin
      .from("order_shipments")
      .update({ delivery_status: "배송중" })
      .in("id", shipmentIds)
      .eq("delivery_status", "배송대기")
      .or("driver_id.not.is.null,fulfillment_method.eq.direct_pickup");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("id, order_id");
    if (error) throw error;
    await syncOrdersFromShipments((data ?? []).map((s) => s.order_id));
    return data?.length ?? 0;
  },

  async setDeliveryStatus(shipmentIds: string[], status: "배송대기" | "배송중" | "완료", ownerUsername?: string): Promise<number> {
    if (shipmentIds.length === 0) return 0;
    const admin = getSupabaseAdmin();
    let q = admin
      .from("order_shipments")
      .update({ delivery_status: status, completed_at: status === "완료" ? new Date().toISOString() : null })
      .in("id", shipmentIds)
      .neq("delivery_status", "취소");
    if (status === "배송중" || status === "완료") {
      q = q.or("driver_id.not.is.null,fulfillment_method.eq.direct_pickup");
    }
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("id, order_id");
    if (error) throw error;
    await syncOrdersFromShipments((data ?? []).map((s) => s.order_id));
    return data?.length ?? 0;
  },

  async setFulfillmentMethod(shipmentIds: string[], method: FulfillmentMethod, ownerUsername?: string): Promise<number> {
    if (shipmentIds.length === 0) return 0;
    const admin = getSupabaseAdmin();
    const update =
      method === "direct_pickup"
        ? { fulfillment_method: method, driver_id: null, delivery_status: "완료" as const, completed_at: new Date().toISOString() }
        : { fulfillment_method: method };
    let q = admin
      .from("order_shipments")
      .update(update)
      .in("id", shipmentIds)
      .neq("delivery_status", "완료")
      .neq("delivery_status", "취소");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("id, order_id");
    if (error) throw error;
    await syncOrdersFromShipments((data ?? []).map((s) => s.order_id));
    return data?.length ?? 0;
  },

  async completeDelivery(shipmentIds: string[], ownerUsername?: string): Promise<number> {
    if (shipmentIds.length === 0) return 0;
    const admin = getSupabaseAdmin();
    let q = admin
      .from("order_shipments")
      .update({ delivery_status: "완료", completed_at: new Date().toISOString() })
      .in("id", shipmentIds)
      .eq("delivery_status", "배송중");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("id, order_id");
    if (error) throw error;
    await syncOrdersFromShipments((data ?? []).map((s) => s.order_id));
    return data?.length ?? 0;
  },

  /** P15-B/S1-1 Phase 5: 기사 화면 — 이 기사에게 배정된, 오늘 발송할 배송건 전체(배송중+완료, 취소 제외). */
  async findByDriverIdAndDeliveryDate(driverId: string, dateStr: string): Promise<OrderShipmentBoardRow[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("order_shipments")
      .select("*")
      .eq("driver_id", driverId)
      .neq("delivery_status", "취소")
      .gte("delivery_date", kstDayStartIso(dateStr))
      .lte("delivery_date", kstDayEndIso(dateStr))
      .order("delivery_date", { ascending: true });
    if (error) throw error;
    return fetchBoardRowsForShipments((data as OrderShipment[]) ?? []);
  },

  /**
   * S1-1 Phase 6: 정산 카운트 기준 — 완료된 배송건(배송건 자신의 delivery_status/completed_at) 수.
   * 이미 settlements 행이 존재하는(=한 번이라도 계산된 적 있는) 기간은 CPO 지시에 따라
   * 계속 orders 기준(ordersRepository.countCompletedByDriverInPeriod)으로 재계산해야
   * 소급 변경이 없다 — 이 메서드는 새로 처음 계산되는 기간에만 쓴다(actions/settlements.ts 참고).
   */
  async countCompletedByDriverInPeriod(driverId: string, periodStartIso: string, periodEndIso: string): Promise<number> {
    const { count, error } = await getSupabaseAdmin()
      .from("order_shipments")
      .select("*", { count: "exact", head: true })
      .eq("driver_id", driverId)
      .eq("delivery_status", "완료")
      .gte("completed_at", periodStartIso)
      .lte("completed_at", periodEndIso);
    if (error) throw error;
    return count ?? 0;
  },

  /** 기사 세션에서 배송건 하나를 완료 처리한다. driverId가 주어지면 본인에게 배정된 배송건만 대상이 된다. */
  async markDelivered(shipmentId: string, driverId?: string): Promise<OrderShipment> {
    let q = getSupabaseAdmin()
      .from("order_shipments")
      .update({ delivery_status: "완료", completed_at: new Date().toISOString() })
      .eq("id", shipmentId)
      .neq("delivery_status", "취소");
    if (driverId) q = q.eq("driver_id", driverId);
    const { data, error } = await q.select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("이미 취소된 배송건이거나 처리 권한이 없습니다.");
    await syncOrdersFromShipments([data.order_id]);
    return data as OrderShipment;
  },
};
