import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { kstDayStartIso, kstDayEndIso, kstDayDateStrOf } from "@/lib/utils/kst-date";
import { syncOrdersFromShipments } from "@/lib/services/order-shipment-sync.service";
import { notifyCustomerDeliveryStarted, notifyCustomerDeliveryCompleted } from "@/lib/services/customer-notification.service";
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
  /** S2-B: 기사별·배송일별 방문 순서(1부터). 미지정이면 null. */
  route_order: number | null;
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
      route_order: s.route_order,
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

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

/**
 * S2-B 정규화: 특정 기사·배송일(KST 달력일)의 route_order를 1..N 연속
 * 번호로 다시 채운다(구멍 제거) — 현재 route_order(nulls last) → created_at
 * 순으로 순번을 매긴다. 재정렬/재배정/직접수령 전환 등 기사의 경로에서
 * 배송건이 빠질 때마다 호출한다.
 */
async function compactRouteOrder(admin: AdminClient, driverId: string, day: string): Promise<void> {
  const { data, error } = await admin
    .from("order_shipments")
    .select("id")
    .eq("driver_id", driverId)
    .gte("delivery_date", kstDayStartIso(day))
    .lte("delivery_date", kstDayEndIso(day))
    .neq("delivery_status", "취소")
    .order("route_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  await Promise.all((data ?? []).map((row, idx) => admin.from("order_shipments").update({ route_order: idx + 1 }).eq("id", row.id)));
}

/**
 * S2-B 정규화: 기사 배정/재배정 직후 route_order를 맞춘다. 배송일(KST
 * 달력일)별로 묶어, 대상 기사의 그 날짜 리스트 맨 뒤에 shipmentIds가 넘어온
 * 순서(=화면에 보이던 순서) 그대로 이어붙인다(CPO 지시: 일괄배정은 표시
 * 순서를 유지). 배송일이 없는 배송건은 route_order 개념이 없어 건드리지
 * 않는다. 기존에 다른 기사가 배정돼 있던 배송건은 그 기사 쪽에 구멍이
 * 남으므로 함께 압축한다.
 */
async function normalizeRouteOrderOnAssign(
  admin: AdminClient,
  targets: { id: string; driver_id: string | null; delivery_date: string | null }[],
  targetDriverId: string,
  shipmentIdsInDisplayOrder: string[]
): Promise<void> {
  const targetsById = new Map(targets.map((t) => [t.id, t]));

  const byDay = new Map<string, string[]>();
  for (const id of shipmentIdsInDisplayOrder) {
    const t = targetsById.get(id);
    if (!t?.delivery_date) continue;
    const day = kstDayDateStrOf(t.delivery_date);
    const list = byDay.get(day) ?? [];
    list.push(id);
    byDay.set(day, list);
  }

  const sourceDriverDays = new Set<string>();
  for (const id of shipmentIdsInDisplayOrder) {
    const t = targetsById.get(id);
    if (!t?.delivery_date || !t.driver_id || t.driver_id === targetDriverId) continue;
    sourceDriverDays.add(`${t.driver_id}::${kstDayDateStrOf(t.delivery_date)}`);
  }

  for (const [day, ids] of byDay) {
    const idSet = new Set(ids);
    const { data: existing, error } = await admin
      .from("order_shipments")
      .select("id")
      .eq("driver_id", targetDriverId)
      .gte("delivery_date", kstDayStartIso(day))
      .lte("delivery_date", kstDayEndIso(day))
      .neq("delivery_status", "취소");
    if (error) throw error;
    let next = (existing ?? []).filter((r) => !idSet.has(r.id)).length + 1;
    for (const id of ids) {
      await admin.from("order_shipments").update({ route_order: next }).eq("id", id);
      next += 1;
    }
  }

  for (const key of sourceDriverDays) {
    const [srcDriverId, day] = key.split("::");
    await compactRouteOrder(admin, srcDriverId, day);
  }
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

  /** STEP2(누적 스마트스토어 엑셀 중복판정 재설계): 여러 부모 주문의 배송건을 한 번에 조회 — Import Phase 1의 배치 조회 원칙과 동일(그룹마다 DB 왕복하지 않음). */
  async findByOrderIds(orderIds: string[]): Promise<OrderShipment[]> {
    if (orderIds.length === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("order_shipments").select("*").in("order_id", orderIds);
    if (error) throw error;
    return (data as OrderShipment[]) ?? [];
  },

  /**
   * S2-B STEP0: 주문 배송일 수정 시 order_shipments도 함께 맞춘다 — 이전에는
   * orders.delivery_date만 바뀌고 order_shipments는 예전 날짜로 남아
   * 배송관리/배송일 필터 주문관리가 서로 다른 날짜를 보여주던 dual-write
   * 결함이 있었다. dayChanged(호출자가 KST 달력일 기준으로 판정)일 때만
   * route_order를 null로 리셋한다 — 같은 날짜 안에서의 사소한 수정으로 기사
   * 배정 순서가 불필요하게 날아가면 안 된다(CPO 지시).
   */
  async updateDeliveryDateForOrder(orderId: string, deliveryDate: string | null, dayChanged: boolean): Promise<void> {
    const update: { delivery_date: string | null; route_order?: null } = { delivery_date: deliveryDate };
    if (dayChanged) update.route_order = null;
    const { error } = await getSupabaseAdmin().from("order_shipments").update(update).eq("order_id", orderId);
    if (error) throw error;
  },

  /**
   * UX11-STEP1 P0-1: 여러 주문의 "배송일 미지정" 배송건에 한 번에 배송일을
   * 지정한다(updateDeliveryDateForOrder의 배치 버전) — 이미 날짜가 있는
   * 배송건은 `.is("delivery_date", null)`로 걸러 절대 덮어쓰지 않는다. 갓
   * 업로드된 주문에는 route_order가 원래 없으므로(신규 배송건) 별도 리셋이
   * 필요 없다. 반환값은 실제로 갱신된 배송건 수(업로드 결과 화면에 표시).
   */
  async assignMissingDeliveryDateForOrders(orderIds: string[], deliveryDate: string): Promise<number> {
    if (orderIds.length === 0) return 0;
    const { data, error } = await getSupabaseAdmin()
      .from("order_shipments")
      .update({ delivery_date: deliveryDate })
      .in("order_id", orderIds)
      .is("delivery_date", null)
      .select("id");
    if (error) throw error;
    return data?.length ?? 0;
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
      .select("id, order_id, delivery_status, driver_id, delivery_date")
      .in("id", shipmentIds);
    if (targetsError) throw targetsError;
    const blocked = (targets ?? []).filter((s) => s.delivery_status === "완료" || s.delivery_status === "취소");
    if (blocked.length > 0) {
      throw new Error("이미 배송완료되었거나 취소된 배송건은 기사를 배정/변경할 수 없습니다.");
    }

    const { error } = await admin.from("order_shipments").update({ driver_id: driverId, delivery_status: "배송중" }).in("id", shipmentIds);
    if (error) throw error;

    // S2-B: 배정된 배송건은 대상 기사의 그날 경로 맨 뒤(화면에 보이던 순서
    // 그대로)로 붙고, 기존에 다른 기사가 배정돼 있었다면 그 기사 쪽 route_order도
    // 압축(정규화)한다.
    await normalizeRouteOrderOnAssign(admin, targets ?? [], driverId, shipmentIds);

    await syncOrdersFromShipments((targets ?? []).map((s) => s.order_id));
    await Promise.all((targets ?? []).map((s) => notifyCustomerDeliveryStarted(s.order_id, s.id)));
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
      .select("id, order_id, delivery_status, driver_id, delivery_date")
      .in("id", shipmentIds);
    if (targetsError) throw targetsError;
    const blocked = (targets ?? []).filter((s) => s.delivery_status === "완료" || s.delivery_status === "취소");
    if (blocked.length > 0) {
      throw new Error("이미 배송완료되었거나 취소된 배송건은 배정을 해제할 수 없습니다.");
    }

    const { error } = await admin
      .from("order_shipments")
      .update({ driver_id: null, delivery_status: "배송대기", route_order: null })
      .in("id", shipmentIds);
    if (error) throw error;

    // S2-B: 배정 해제로 빠진 기사의 그날 route_order에 생긴 구멍을 압축한다.
    const affectedDriverDays = new Set<string>();
    for (const t of targets ?? []) {
      if (t.driver_id && t.delivery_date) affectedDriverDays.add(`${t.driver_id}::${kstDayDateStrOf(t.delivery_date)}`);
    }
    for (const key of affectedDriverDays) {
      const [driverId, day] = key.split("::");
      await compactRouteOrder(admin, driverId, day);
    }

    await syncOrdersFromShipments((targets ?? []).map((s) => s.order_id));
  },

  /**
   * S2-B STEP3: 사장님이 배송관리 기사별 View에서 ↑/↓로 순서를 바꾸면
   * 호출된다. orderedShipmentIds는 그 기사·그 배송일의 배송건 "전체"를 새
   * 순서대로 넘겨받는다고 가정하고, 항상 1..N으로 다시 번호를 매긴다
   * (정규화 — 중간 번호가 비지 않는다). 넘어온 배송건들이 실제로 같은
   * 기사·같은 KST 달력일에 속하는지 방어적으로 검증한다.
   */
  async reorderForDriver(orderedShipmentIds: string[], ownerUsername?: string): Promise<void> {
    if (orderedShipmentIds.length === 0) return;
    const admin = getSupabaseAdmin();

    const { data: rows, error } = await admin
      .from("order_shipments")
      .select("id, driver_id, delivery_date, owner_username")
      .in("id", orderedShipmentIds);
    if (error) throw error;
    if ((rows?.length ?? 0) !== orderedShipmentIds.length) {
      throw new Error("존재하지 않는 배송건이 포함되어 있습니다.");
    }

    const distinctDrivers = new Set((rows ?? []).map((r) => r.driver_id));
    if (distinctDrivers.size !== 1 || [...distinctDrivers][0] === null) {
      throw new Error("같은 기사에게 배정된 배송건끼리만 순서를 변경할 수 있습니다.");
    }
    const distinctDays = new Set((rows ?? []).map((r) => (r.delivery_date ? kstDayDateStrOf(r.delivery_date) : null)));
    if (distinctDays.size !== 1 || [...distinctDays][0] === null) {
      throw new Error("같은 배송일의 배송건끼리만 순서를 변경할 수 있습니다.");
    }
    if (ownerUsername && (rows ?? []).some((r) => r.owner_username !== ownerUsername)) {
      throw new Error("순서를 변경할 권한이 없는 배송건이 포함되어 있습니다.");
    }

    await Promise.all(
      orderedShipmentIds.map((id, idx) => admin.from("order_shipments").update({ route_order: idx + 1 }).eq("id", id))
    );
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
    await Promise.all((data ?? []).map((s) => notifyCustomerDeliveryStarted(s.order_id, s.id)));
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
    if (status === "배송중") {
      await Promise.all((data ?? []).map((s) => notifyCustomerDeliveryStarted(s.order_id, s.id)));
    } else if (status === "완료") {
      await Promise.all((data ?? []).map((s) => notifyCustomerDeliveryCompleted(s.order_id, s.id)));
    }
    return data?.length ?? 0;
  },

  async setFulfillmentMethod(shipmentIds: string[], method: FulfillmentMethod, ownerUsername?: string): Promise<number> {
    if (shipmentIds.length === 0) return 0;
    const admin = getSupabaseAdmin();

    // S2-B: direct_pickup으로 바뀌면 기사 경로에서 빠지므로, 압축 대상을 알기
    // 위해 이전 driver_id/delivery_date를 미리 기억해둔다.
    let previous: { id: string; driver_id: string | null; delivery_date: string | null }[] = [];
    if (method === "direct_pickup") {
      const { data, error } = await admin.from("order_shipments").select("id, driver_id, delivery_date").in("id", shipmentIds);
      if (error) throw error;
      previous = data ?? [];
    }

    const update =
      method === "direct_pickup"
        ? {
            fulfillment_method: method,
            driver_id: null,
            delivery_status: "완료" as const,
            completed_at: new Date().toISOString(),
            route_order: null,
          }
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

    if (method === "direct_pickup") {
      const updatedIds = new Set((data ?? []).map((d) => d.id));
      const affectedDriverDays = new Set<string>();
      for (const t of previous) {
        if (updatedIds.has(t.id) && t.driver_id && t.delivery_date) {
          affectedDriverDays.add(`${t.driver_id}::${kstDayDateStrOf(t.delivery_date)}`);
        }
      }
      for (const key of affectedDriverDays) {
        const [driverId, day] = key.split("::");
        await compactRouteOrder(admin, driverId, day);
      }
    }

    await syncOrdersFromShipments((data ?? []).map((s) => s.order_id));
    if (method === "direct_pickup") {
      await Promise.all((data ?? []).map((s) => notifyCustomerDeliveryCompleted(s.order_id, s.id)));
    }
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
    await Promise.all((data ?? []).map((s) => notifyCustomerDeliveryCompleted(s.order_id, s.id)));
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
      // S2-B STEP7: 사장님이 지정한 route_order 순서 그대로 보여준다(기사는
      // 순서를 바꿀 권한이 없다 — 표시만 한다).
      .order("route_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return fetchBoardRowsForShipments((data as OrderShipment[]) ?? []);
  },

  /**
   * 정산 카운트 기준 — 완료된 배송건(배송건 자신의 delivery_status/completed_at) 수.
   * CPO 지시(2026-08, 정산 집계 불일치 수정): 지급완료(status='paid') 처리되지
   * 않은 기간은 조회할 때마다 이 메서드로 라이브 재계산한다(과거의 "이미
   * settlements 행이 있으면 orders 기준으로 고정" 방식은 실제 배송건과
   * 어긋나는(legacy orders.delivery_status가 갱신 안 되는) 버그의 원인이었다
   * — actions/settlements.ts의 resolveSettlement 참고). 이제 소급 변경 방지는
   * "행이 존재하는지"가 아니라 "실제로 지급 처리됐는지(status='paid')"로
   * 판단한다 — 지급 완료된 정산만 그 시점 금액/건수로 고정한다.
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

  /**
   * 정산 일별 이력(CPO 지시, 2026-08) — 선택한 기간 내 완료된 배송건들의
   * completed_at만 뽑아 액션 계층에서 KST 달력일로 묶는다(건수가 한 기사의
   * 한 달치라 몇십~몇백 건 수준이라 그룹은 SQL이 아니라 in-memory로 처리).
   */
  async listCompletedAtByDriverInPeriod(driverId: string, periodStartIso: string, periodEndIso: string): Promise<string[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("order_shipments")
      .select("completed_at")
      .eq("driver_id", driverId)
      .eq("delivery_status", "완료")
      .gte("completed_at", periodStartIso)
      .lte("completed_at", periodEndIso);
    if (error) throw error;
    return (data ?? []).map((r) => r.completed_at).filter((v): v is string => v != null);
  },

  /**
   * 가방번호/회수는 배송관리 전용 입력이다(주문관리는 조회만) — 기사에게
   * 배정하면서, 또는 배송 목록에서 언제든 가방번호를 등록·수정하고 회수
   * 여부를 체크한다. 물리적 가방은 한정된 개수를 돌려쓰므로, 같은
   * 가방번호가 아직 회수되지 않은 채로 더 늦은 배송일에 다시 등록되면 그
   * 가방은 실제로는 이미 돌아온 것 — 이전 배송건들을 자동으로 회수 처리한다
   * (사장님이 매번 "이전 것도 회수됐나요?"를 수동으로 체크하지 않아도 됨).
   * 갱신 후에는 orders 테이블에도 항상 동기화한다(syncOrdersFromShipments —
   * 주문관리의 "전체" 조회가 이 스냅샷을 읽는다).
   */
  async updateBag(
    shipmentId: string,
    input: { bagNumber: string | null; bagReturned: boolean },
    ownerUsername?: string
  ): Promise<{ autoReturnedCount: number }> {
    const admin = getSupabaseAdmin();

    // 속도 개선(2026-08): 회수 체크박스만 토글할 때는(가방번호 변경 없음)
    // "이전 미회수 가방 자동회수" 조회 자체를 건너뛴다 — 실사용에서 가장
    // 잦은 조작(회수 체크)이 매번 불필요한 추가 쿼리를 타던 것이 체감
    // 지연의 주 원인이었다. 변경 전 값을 알아야 하므로 update보다 먼저
    // 현재 행을 읽는다.
    let selectQ = admin
      .from("order_shipments")
      .select("id, order_id, owner_username, delivery_date, bag_number")
      .eq("id", shipmentId);
    if (ownerUsername) selectQ = selectQ.eq("owner_username", ownerUsername);
    const { data: current, error: selectError } = await selectQ.maybeSingle();
    if (selectError) throw selectError;
    if (!current) throw new Error("배송건을 찾을 수 없거나 권한이 없습니다.");

    const { error: updateError } = await admin
      .from("order_shipments")
      .update({ bag_number: input.bagNumber, bag_returned: input.bagReturned })
      .eq("id", shipmentId);
    if (updateError) throw updateError;

    let autoReturnedCount = 0;
    const orderIdsToSync = [current.order_id];
    const bagNumberChanged = input.bagNumber !== current.bag_number;

    if (input.bagNumber && bagNumberChanged && current.delivery_date) {
      const { data: priorReturned, error: priorError } = await admin
        .from("order_shipments")
        .update({ bag_returned: true })
        .eq("owner_username", current.owner_username)
        .eq("bag_number", input.bagNumber)
        .eq("bag_returned", false)
        .neq("id", shipmentId)
        .lt("delivery_date", current.delivery_date)
        .select("id, order_id");
      if (priorError) throw priorError;
      autoReturnedCount = priorReturned?.length ?? 0;
      orderIdsToSync.push(...(priorReturned ?? []).map((r) => r.order_id));
    }

    await syncOrdersFromShipments(orderIdsToSync);
    return { autoReturnedCount };
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
    await notifyCustomerDeliveryCompleted(data.order_id, data.id);
    return data as OrderShipment;
  },
};
