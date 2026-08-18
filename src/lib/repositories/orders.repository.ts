import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { kstDayStartIso, kstDayEndIso } from "@/lib/utils/kst-date";
import { digitsOnly, formatPhoneNumber } from "@/lib/utils/phone";
import type { Order, OrderItem, OrderSource, DeliveryStatus, FulfillmentMethod, GeocodeStatus } from "@/types/domain";

export interface OrderInsert {
  id?: string; // client-generated (crypto.randomUUID()) for batch import — lets order_items reference the order before the actual insert round-trip
  customer_id: string;
  order_number?: string | null;
  internal_order_number: string;
  order_date: string;
  status?: string;
  total_amount: number;
  recipient_name: string;
  phone_snapshot?: string | null;
  address_snapshot?: string | null;
  road_address_snapshot?: string | null;
  detail_address_snapshot?: string | null;
  zipcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  sido?: string | null;
  sigungu?: string | null;
  eupmyeondong?: string | null;
  sido_code?: string | null;
  sigungu_code?: string | null;
  eupmyeondong_code?: string | null;
  geocode_status?: GeocodeStatus;
  geocoded_at?: string | null;
  delivery_memo?: string | null;
  order_memo?: string | null;
  internal_memo?: string | null;
  courier?: string | null;
  tracking_number?: string | null;
  sales_channel?: string | null;
  buyer_name?: string | null;
  buyer_id?: string | null;
  shipped_at?: string | null;
  delivery_date?: string | null;
  delivery_area?: string | null;
  bag_number?: string | null;
  bag_returned?: boolean;
  order_source?: OrderSource;
  delivery_status?: DeliveryStatus;
  fulfillment_method?: FulfillmentMethod;
  driver_id?: string | null;
  completed_at?: string | null;
  import_id?: string | null;
  owner_username: string;
  tenant_id: string;
}

export interface OrderUpdate {
  bag_number?: string | null;
  bag_returned?: boolean;
  delivery_date?: string | null;
  delivery_status?: DeliveryStatus;
  fulfillment_method?: FulfillmentMethod;
  driver_id?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  recipient_name?: string;
  phone_snapshot?: string | null;
  address_snapshot?: string | null;
  road_address_snapshot?: string | null;
  detail_address_snapshot?: string | null;
  zipcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  sido?: string | null;
  sigungu?: string | null;
  eupmyeondong?: string | null;
  sido_code?: string | null;
  sigungu_code?: string | null;
  eupmyeondong_code?: string | null;
  geocode_status?: GeocodeStatus;
  geocoded_at?: string | null;
  delivery_memo?: string | null;
  order_memo?: string | null;
  internal_memo?: string | null;
  order_date?: string;
  status?: string;
  total_amount?: number;
  order_source?: OrderSource;
}

export type OrderSortField =
  | "order_number"
  | "internal_order_number"
  | "order_date"
  | "delivery_date"
  | "recipient_name"
  | "phone_snapshot"
  | "address_snapshot"
  | "total_amount"
  | "delivery_status"
  | "driver_id";

export interface OrderSearchParams {
  page?: number;
  pageSize?: number;
  ownerUsername?: string;
  deliveryStatus?: DeliveryStatus;
  bagReturned?: boolean;
  /** F8: 고객명(recipient_name)/전화번호(phone_snapshot)/주문번호(order_number, internal_order_number) 통합 검색어. */
  query?: string;
  orderSource?: OrderSource;
  /** KST calendar-day strings ("YYYY-MM-DD"); converted to precise UTC instants internally — see kst-date.ts. */
  orderDateFrom?: string;
  orderDateTo?: string;
  /** @deprecated single-day form, kept for any caller not yet on the range params. Prefer deliveryDateFrom/To. */
  deliveryDate?: string;
  deliveryDateFrom?: string;
  deliveryDateTo?: string;
  sortBy?: OrderSortField;
  sortAscending?: boolean;
}

export interface OrderItemInsert {
  order_id: string;
  product_order_number?: string | null;
  product_code?: string | null;
  product_id?: string | null;
  product_name: string;
  option_name?: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  extra?: Record<string, unknown>;
}

export const ordersRepository = {
  async findById(id: string): Promise<Order | null> {
    const { data, error } = await getSupabaseAdmin().from("orders").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data as Order | null;
  },

  async findByIds(ids: string[]): Promise<Order[]> {
    if (ids.length === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("orders").select("*").in("id", ids);
    if (error) throw error;
    return (data as Order[]) ?? [];
  },

  /** Phase 4: 그룹 기사 배정 시 이 그룹에 속한 주문 id 목록을 얻는 데 쓴다(기존 assignDriver를 그대로 재사용하기 위함). */
  async findByGroupId(groupId: string): Promise<Order[]> {
    const { data, error } = await getSupabaseAdmin().from("orders").select("*").eq("delivery_group_id", groupId);
    if (error) throw error;
    return (data as Order[]) ?? [];
  },

  /** Phase 4: 그룹 재계산 시 "재계산 직전" 소속 스냅샷을 한 번에 가져오는 데 쓴다(기존 그룹 ↔ 새 클러스터 매칭용). */
  async findByGroupIds(groupIds: string[]): Promise<Order[]> {
    if (groupIds.length === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("orders").select("*").in("delivery_group_id", groupIds);
    if (error) throw error;
    return (data as Order[]) ?? [];
  },

  async findByOrderNumber(orderNumber: string): Promise<Order | null> {
    const { data, error } = await getSupabaseAdmin()
      .from("orders")
      .select("*")
      .eq("order_number", orderNumber)
      .maybeSingle();
    if (error) throw error;
    return data as Order | null;
  },

  /**
   * Batch import: which of these order_numbers already exist, checked in a
   * handful of round-trips instead of one findByOrderNumber call per row.
   * PostgREST sends `.in()` filters as a GET query string, which hits
   * Node's ~16KB header-size limit somewhere past ~1000 order numbers — so
   * this chunks the check rather than sending it all as a single filter.
   *
   * P5: tenantId is required now — this previously queried across ALL
   * tenants, so two sellers whose Smartstore order_number happened to
   * collide would have tenant B's import silently skip a row as
   * "already exists" (tenant A's row), a cross-tenant silent-skip bug found
   * during the 엑셀 261→157 investigation. order_number itself isn't unique
   * per-tenant in the DB either, so this filter is the only thing preventing
   * the collision now.
   */
  async findExistingOrderNumbers(orderNumbers: string[], tenantId: string): Promise<Set<string>> {
    if (orderNumbers.length === 0) return new Set();
    const CHUNK_SIZE = 300;
    const found = new Set<string>();
    for (let i = 0; i < orderNumbers.length; i += CHUNK_SIZE) {
      const chunk = orderNumbers.slice(i, i + CHUNK_SIZE);
      const { data, error } = await getSupabaseAdmin()
        .from("orders")
        .select("order_number")
        .eq("tenant_id", tenantId)
        .in("order_number", chunk);
      if (error) throw error;
      for (const r of data ?? []) found.add(r.order_number as string);
    }
    return found;
  },

  async findByCustomerId(customerId: string): Promise<Order[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("orders")
      .select("*")
      .eq("customer_id", customerId)
      .order("order_date", { ascending: false });
    if (error) throw error;
    return (data as Order[]) ?? [];
  },

  async listRecent(page = 1, pageSize = 20, ownerUsername?: string) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let q = getSupabaseAdmin().from("orders").select("*", { count: "exact" });
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error, count } = await q.order("order_date", { ascending: false }).range(from, to);
    if (error) throw error;
    return { orders: (data as Order[]) ?? [], total: count ?? 0 };
  },

  async search({
    page = 1,
    pageSize = 20,
    ownerUsername,
    deliveryStatus,
    bagReturned,
    query,
    orderSource,
    orderDateFrom,
    orderDateTo,
    deliveryDate,
    deliveryDateFrom,
    deliveryDateTo,
    sortBy = "delivery_date",
    sortAscending = false,
  }: OrderSearchParams) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let q = getSupabaseAdmin().from("orders").select("*", { count: "exact" });
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    if (deliveryStatus) q = q.eq("delivery_status", deliveryStatus);
    if (bagReturned !== undefined) q = q.eq("bag_returned", bagReturned);
    if (orderSource) q = q.eq("order_source", orderSource);
    if (query && query.trim()) {
      const term = query.trim();
      // F8: 고객명/전화번호(하이픈 유무 무관)/원본·내부 주문번호를 한 번에 검색.
      const digits = digitsOnly(term);
      const phoneVariant = digits.length >= 8 ? formatPhoneNumber(digits) : null;
      const phoneClause = phoneVariant && phoneVariant !== term ? `,phone_snapshot.ilike.%${phoneVariant}%` : "";
      q = q.or(
        `recipient_name.ilike.%${term}%,phone_snapshot.ilike.%${term}%${phoneClause},order_number.ilike.%${term}%,internal_order_number.ilike.%${term}%`
      );
    }
    // KST calendar-day boundaries, not bare date strings — see kst-date.ts's doc comment for why.
    if (orderDateFrom) q = q.gte("order_date", kstDayStartIso(orderDateFrom));
    if (orderDateTo) q = q.lte("order_date", kstDayEndIso(orderDateTo));
    if (deliveryDateFrom || deliveryDateTo) {
      if (deliveryDateFrom) q = q.gte("delivery_date", kstDayStartIso(deliveryDateFrom));
      if (deliveryDateTo) q = q.lte("delivery_date", kstDayEndIso(deliveryDateTo));
    } else if (deliveryDate) {
      q = q.gte("delivery_date", kstDayStartIso(deliveryDate)).lte("delivery_date", kstDayEndIso(deliveryDate));
    }

    const { data, error, count } = await q
      .order(sortBy, { ascending: sortAscending, nullsFirst: false })
      .order("order_date", { ascending: false })
      .range(from, to);
    if (error) throw error;
    return { orders: (data as Order[]) ?? [], total: count ?? 0 };
  },

  async findByImportId(importId: string): Promise<Order[]> {
    const { data, error } = await getSupabaseAdmin().from("orders").select("*").eq("import_id", importId);
    if (error) throw error;
    return (data as Order[]) ?? [];
  },

  /**
   * All orders whose delivery_date falls within the given KST calendar-day
   * range (inclusive) — 배송관리 board. `dateTo` defaults to `dateFrom` for
   * the common single-day case. `dateFrom === null` means no date bound at
   * all ("전체") — this also surfaces orders with delivery_date IS NULL
   * (엑셀 옵션정보에 날짜 패턴이 없어 배송일이 비어있는 주문 등), which is
   * exactly the case Phase 4-B STEP1 found silently invisible everywhere.
   *
   * Phase 4-B: boundaries now go through kstDayStartIso/kstDayEndIso instead
   * of `new Date(dateIso); .setHours(0,0,0,0)`, which only produced correct
   * KST boundaries when the server process's own OS timezone happened to be
   * Asia/Seoul — see kst-date.ts's doc comment.
   *
   * Phase 2: excludes 취소(cancelled) orders — a cancelled order is not
   * something to deliver, so it never enters the board, never counts toward
   * "배정 필요"/"배송 중", and can never be assigned a driver from here.
   * It's still fully visible on the order detail page and in 주문 목록.
   */
  async findByDeliveryDate(dateFrom: string | null, ownerUsername?: string, dateTo?: string): Promise<Order[]> {
    let q = getSupabaseAdmin().from("orders").select("*").neq("delivery_status", "취소");
    if (dateFrom) {
      q = q.gte("delivery_date", kstDayStartIso(dateFrom)).lte("delivery_date", kstDayEndIso(dateTo ?? dateFrom));
    }
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("created_at", { ascending: true });
    if (error) throw error;
    return (data as Order[]) ?? [];
  },

  /**
   * Phase 4: 배송 그룹화 대상 — 취소 주문 제외(findByDeliveryDate와 동일
   * 원칙 재사용) + 좌표 확보(geocode_status='success', 위경도 not null)까지
   * 추가로 요구한다. 좌표가 없거나 지오코딩 실패한 주문은 여기서 아예 걸러져
   * 화면에서 "미그룹 — 좌표 없음"으로 별도 표시된다(actions/delivery-groups.ts).
   */
  async findEligibleForGrouping(dateStr: string, ownerUsername?: string): Promise<Order[]> {
    let q = getSupabaseAdmin()
      .from("orders")
      .select("*")
      .neq("delivery_status", "취소")
      .eq("geocode_status", "success")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .gte("delivery_date", kstDayStartIso(dateStr))
      .lte("delivery_date", kstDayEndIso(dateStr));
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("created_at", { ascending: true });
    if (error) throw error;
    return (data as Order[]) ?? [];
  },

  /** Phase 4: 그룹 재계산 시작 시 해당 (tenant, 배송일)의 기존 그룹 소속을 모두 비운다 — 이후 새 클러스터링 결과로 다시 채운다. */
  async clearDeliveryGroupsForDate(tenantId: string, dateStr: string): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from("orders")
      .update({ delivery_group_id: null })
      .eq("tenant_id", tenantId)
      .gte("delivery_date", kstDayStartIso(dateStr))
      .lte("delivery_date", kstDayEndIso(dateStr))
      .not("delivery_group_id", "is", null);
    if (error) throw error;
  },

  /** Phase 4: 클러스터링 결과에 따라 주문들을 그룹에 배정한다. */
  async assignOrdersToGroup(orderIds: string[], groupId: string): Promise<void> {
    if (orderIds.length === 0) return;
    const { error } = await getSupabaseAdmin().from("orders").update({ delivery_group_id: groupId }).in("id", orderIds);
    if (error) throw error;
  },

  /**
   * Assigns a driver to the given orders and moves them into 배송중. Also
   * used for "기사 변경" — reassigning an already-in-progress order to a
   * different driver is just calling this again with a new driverId, no
   * separate codepath needed.
   *
   * Sprint 14-I hotfix: `ownerUsername`, when passed (i.e. caller isn't
   * admin), is a second line of defense on top of the action-layer check —
   * it re-verifies every order id AND the driver itself belong to that
   * owner *before* issuing the UPDATE, so a bypassed/buggy action layer
   * still can't cross-tenant-assign. All-or-nothing: any mismatch throws
   * and nothing is written.
   *
   * Phase 2: also re-verifies (still all-or-nothing) that none of the
   * target orders are already 완료(delivered) or 취소(cancelled) — a
   * completed delivery's history shouldn't be reopened, and a cancelled
   * order was deliberately taken out of the delivery flow.
   */
  async assignDriver(orderIds: string[], driverId: string, ownerUsername?: string): Promise<void> {
    if (orderIds.length === 0) return;
    const admin = getSupabaseAdmin();

    if (ownerUsername) {
      const [{ data: owned, error: ordersCheckError }, { data: driver, error: driverCheckError }] = await Promise.all([
        admin.from("orders").select("id").in("id", orderIds).eq("owner_username", ownerUsername),
        admin.from("drivers").select("id").eq("id", driverId).eq("owner_username", ownerUsername).maybeSingle(),
      ]);
      if (ordersCheckError) throw ordersCheckError;
      if (driverCheckError) throw driverCheckError;
      if ((owned?.length ?? 0) !== orderIds.length || !driver) {
        throw new Error("배정 권한이 없는 주문 또는 기사가 포함되어 있습니다.");
      }
    }

    const { data: targets, error: targetsError } = await admin.from("orders").select("id, delivery_status").in("id", orderIds);
    if (targetsError) throw targetsError;
    const blocked = (targets ?? []).filter((o) => o.delivery_status === "완료" || o.delivery_status === "취소");
    if (blocked.length > 0) {
      throw new Error("이미 배송완료되었거나 취소된 주문은 기사를 배정/변경할 수 없습니다.");
    }

    const { error } = await admin.from("orders").update({ driver_id: driverId, delivery_status: "배송중" }).in("id", orderIds);
    if (error) throw error;
  },

  /**
   * Removes the driver from the given orders and moves them back to
   * 배송대기 ("배정 해제"). Blocked for already-완료/취소 orders for the
   * same reason as assignDriver.
   */
  async unassignDriver(orderIds: string[], ownerUsername?: string): Promise<void> {
    if (orderIds.length === 0) return;
    const admin = getSupabaseAdmin();
    if (ownerUsername) {
      const { data: owned, error: checkError } = await admin.from("orders").select("id").in("id", orderIds).eq("owner_username", ownerUsername);
      if (checkError) throw checkError;
      if ((owned?.length ?? 0) !== orderIds.length) {
        throw new Error("배정 해제 권한이 없는 주문이 포함되어 있습니다.");
      }
    }

    const { data: targets, error: targetsError } = await admin.from("orders").select("id, delivery_status").in("id", orderIds);
    if (targetsError) throw targetsError;
    const blocked = (targets ?? []).filter((o) => o.delivery_status === "완료" || o.delivery_status === "취소");
    if (blocked.length > 0) {
      throw new Error("이미 배송완료되었거나 취소된 주문은 배정을 해제할 수 없습니다.");
    }

    const { error } = await admin.from("orders").update({ driver_id: null, delivery_status: "배송대기" }).in("id", orderIds);
    if (error) throw error;
  },

  /**
   * F13: Seller가 (기사 배정 없이) 직접 "배송 시작"을 눌러 배송대기→배송중으로
   * 전환한다 — 1인 사업자의 자가배송처럼 기사 개념이 필요 없는 경우를 위한
   * 경로. assignDriver와 달리 driver_id는 건드리지 않는다. 대상 중 이미
   * 배송대기가 아닌 건(배송중/완료/취소)은 조용히 건너뛰고, 실제로 전환된
   * 건수만 반환 — 다건 선택 시 일부만 대상이어도 전체가 실패하지 않는다.
   */
  async startDelivery(orderIds: string[], ownerUsername?: string): Promise<number> {
    if (orderIds.length === 0) return 0;
    const admin = getSupabaseAdmin();
    // P5 12번: 기사 미배정 + 배송대기 상태에서는 배송중으로 갈 수 없다.
    // 단, 직접수령(fulfillment_method='direct_pickup')은 예외 — driver_id
    // 없이도 배송중으로 진행 가능(고객이 매장에서 직접 받는 흐름이므로).
    let q = admin
      .from("orders")
      .update({ delivery_status: "배송중" })
      .in("id", orderIds)
      .eq("delivery_status", "배송대기")
      .or("driver_id.not.is.null,fulfillment_method.eq.direct_pickup");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("id");
    if (error) throw error;
    return data?.length ?? 0;
  },

  /**
   * P5 11번: 클릭 한 번으로 배송대기/배송중/완료 사이를 양방향으로 전환한다
   * (되돌리기 포함 — 완료→배송중, 배송중→배송대기 등 운영상 실수/재조정을
   * 위해 허용). 취소된 주문은 대상에서 제외(취소/복구는 별도 흐름 유지).
   * 배송중으로 "가는" 경우에만 startDelivery와 동일한 기사-또는-직접수령
   * 규칙을 적용 — 배송대기/완료로 가는 데는 그 제약이 없다.
   * 완료를 벗어나면 completed_at을 지운다(되돌렸다는 사실을 반영).
   */
  async setDeliveryStatus(
    orderIds: string[],
    status: "배송대기" | "배송중" | "완료",
    ownerUsername?: string
  ): Promise<number> {
    if (orderIds.length === 0) return 0;
    const admin = getSupabaseAdmin();
    let q = admin
      .from("orders")
      .update({
        delivery_status: status,
        completed_at: status === "완료" ? new Date().toISOString() : null,
      })
      .in("id", orderIds)
      .neq("delivery_status", "취소");
    if (status === "배송중") {
      q = q.or("driver_id.not.is.null,fulfillment_method.eq.direct_pickup");
    }
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("id");
    if (error) throw error;
    return data?.length ?? 0;
  },

  /**
   * P5 13번: "직접수령" 선택 — 가짜 기사 레코드를 만들지 않고
   * fulfillment_method 컬럼만 바꾼다. direct_pickup으로 바꿀 때는 driver_id를
   * 같이 비운다(배정된 기사와 직접수령은 동시에 성립할 수 없는 상태이므로,
   * 배송관리 상단 집계의 "기사배정/미배정/직접수령" 세 버킷이 항상 서로
   * 배타적이도록). delivery로 되돌릴 때는 driver_id를 건드리지 않는다(원래
   * 없었으니 그대로 미배정 상태로 남고, 필요하면 별도로 기사를 배정한다).
   */
  async setFulfillmentMethod(orderIds: string[], method: FulfillmentMethod, ownerUsername?: string): Promise<number> {
    if (orderIds.length === 0) return 0;
    const admin = getSupabaseAdmin();
    let q = admin
      .from("orders")
      .update(method === "direct_pickup" ? { fulfillment_method: method, driver_id: null } : { fulfillment_method: method })
      .in("id", orderIds)
      .neq("delivery_status", "완료")
      .neq("delivery_status", "취소");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("id");
    if (error) throw error;
    return data?.length ?? 0;
  },

  /**
   * F13: Seller가 직접 "배송 완료"를 눌러 배송중→완료로 전환한다(기사 앱의
   * markDelivered와 동일한 목적지 상태지만, 기사 세션이 아닌 Seller 세션에서
   * 호출되므로 별도 메서드로 둔다 — driver_id 소유 검증 대신 owner_username
   * 검증). startDelivery와 동일하게 대상이 아닌 건은 조용히 건너뛴다.
   */
  async completeDelivery(orderIds: string[], ownerUsername?: string): Promise<number> {
    if (orderIds.length === 0) return 0;
    const admin = getSupabaseAdmin();
    let q = admin
      .from("orders")
      .update({ delivery_status: "완료", completed_at: new Date().toISOString() })
      .in("id", orderIds)
      .eq("delivery_status", "배송중");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("id");
    if (error) throw error;
    return data?.length ?? 0;
  },

  /** A driver's own orders — either their currently in-progress deliveries or (with includeCompleted) their full history, for the driver-only delivery view. */
  async findByDriverId(driverId: string, deliveryStatus?: DeliveryStatus): Promise<Order[]> {
    let q = getSupabaseAdmin().from("orders").select("*").eq("driver_id", driverId);
    if (deliveryStatus) q = q.eq("delivery_status", deliveryStatus);
    const { data, error } = await q.order("delivery_date", { ascending: true });
    if (error) throw error;
    return (data as Order[]) ?? [];
  },

  /** F15: driverId가 주어지면(기사 세션 호출) 본인에게 배정된 주문만 완료 처리된다. */
  async markDelivered(orderId: string, driverId?: string): Promise<Order> {
    let q = getSupabaseAdmin()
      .from("orders")
      .update({ delivery_status: "완료", completed_at: new Date().toISOString() })
      .eq("id", orderId)
      .neq("delivery_status", "취소");
    if (driverId) q = q.eq("driver_id", driverId);
    const { data, error } = await q.select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("이미 취소된 주문이거나 처리 권한이 없습니다.");
    return data as Order;
  },

  /**
   * Soft-cancels an order ("취소"): the row is never deleted, only its
   * delivery_status changes, so the order stays visible on its detail page
   * and in 주문 목록 as history. Clears driver_id so it can't linger as
   * "assigned" on a delivery that no longer happens. Blocked for orders
   * already 완료(delivered) — a completed delivery isn't undone by cancelling.
   */
  async cancelOrder(orderId: string, ownerUsername?: string): Promise<Order> {
    let q = getSupabaseAdmin()
      .from("orders")
      .update({ delivery_status: "취소", cancelled_at: new Date().toISOString(), driver_id: null })
      .eq("id", orderId)
      .neq("delivery_status", "완료");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("이미 배송완료된 주문이거나 취소 권한이 없습니다.");
    return data as Order;
  },

  /** Reverses cancelOrder — only valid from 취소, returns the order to 배송대기 for normal processing. */
  async uncancelOrder(orderId: string, ownerUsername?: string): Promise<Order> {
    let q = getSupabaseAdmin()
      .from("orders")
      .update({ delivery_status: "배송대기", cancelled_at: null })
      .eq("id", orderId)
      .eq("delivery_status", "취소");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("취소된 주문이 아니거나 처리 권한이 없습니다.");
    return data as Order;
  },

  async deleteMany(orderIds: string[]): Promise<void> {
    if (orderIds.length === 0) return;
    const { error } = await getSupabaseAdmin().from("orders").delete().in("id", orderIds);
    if (error) throw error;
  },

  /** Completed-delivery count for one driver within [periodStartIso, periodEndIso] — the basis for 정산관리's amount = count × rate. */
  async countCompletedByDriverInPeriod(driverId: string, periodStartIso: string, periodEndIso: string): Promise<number> {
    const { count, error } = await getSupabaseAdmin()
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("driver_id", driverId)
      .eq("delivery_status", "완료")
      .gte("completed_at", periodStartIso)
      .lte("completed_at", periodEndIso);
    if (error) throw error;
    return count ?? 0;
  },

  /**
   * F15: ownerUsername이 주어지면(비-admin 호출) DB 쿼리 자체에도 소유권
   * 조건을 걸어, action layer 체크가 우회되더라도 다른 tenant의 주문은
   * 수정되지 않는다 — assignDriver 등과 동일한 방어 수준으로 통일.
   */
  async update(id: string, input: OrderUpdate, ownerUsername?: string): Promise<Order> {
    let q = getSupabaseAdmin().from("orders").update(input).eq("id", id);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("주문을 찾을 수 없거나 권한이 없습니다.");
    return data as Order;
  },

  /** Other not-yet-returned bags for the same customer, delivered before `beforeIso` — used for the "이전 미회수 가방" confirm alert on order detail. */
  async findUnreturnedPriorOrders(customerId: string, excludeOrderId: string, beforeIso: string): Promise<Order[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("orders")
      .select("*")
      .eq("customer_id", customerId)
      .eq("bag_returned", false)
      .neq("id", excludeOrderId)
      .lt("delivery_date", beforeIso)
      .order("delivery_date", { ascending: true });
    if (error) throw error;
    return (data as Order[]) ?? [];
  },

  /** Sprint 14-I P1 hotfix: `ownerUsername`, when passed, is re-verified against every id before the UPDATE runs — second line of defense alongside the action-layer check (see markBagReturnedAction). */
  async markManyBagsReturned(orderIds: string[], ownerUsername?: string): Promise<void> {
    if (orderIds.length === 0) return;
    if (ownerUsername) {
      const { data: owned, error: checkError } = await getSupabaseAdmin()
        .from("orders")
        .select("id")
        .in("id", orderIds)
        .eq("owner_username", ownerUsername);
      if (checkError) throw checkError;
      if ((owned?.length ?? 0) !== orderIds.length) {
        throw new Error("회수 처리 권한이 없는 주문이 포함되어 있습니다.");
      }
    }
    const { error } = await getSupabaseAdmin().from("orders").update({ bag_returned: true }).in("id", orderIds);
    if (error) throw error;
  },

  async createMany(orders: OrderInsert[]): Promise<Order[]> {
    if (orders.length === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("orders").insert(orders).select("*");
    if (error) throw error;
    return (data as Order[]) ?? [];
  },

  async createItems(items: OrderItemInsert[]): Promise<OrderItem[]> {
    if (items.length === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("order_items").insert(items).select("*");
    if (error) throw error;
    return data ?? [];
  },

  async updateItem(
    itemId: string,
    input: {
      product_id?: string | null;
      product_name: string;
      option_name?: string | null;
      quantity: number;
      unit_price: number;
      amount: number;
    }
  ): Promise<OrderItem> {
    const { data, error } = await getSupabaseAdmin().from("order_items").update(input).eq("id", itemId).select("*").single();
    if (error) throw error;
    return data as OrderItem;
  },

  /** Deletes a single order (cascades order_items via FK). Only ever called for orders with import_id=null — orders created by the Excel bulk-import pipeline are never deletable from the UI. */
  async deleteOne(orderId: string, ownerUsername?: string): Promise<void> {
    let q = getSupabaseAdmin().from("orders").delete().eq("id", orderId);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("주문을 찾을 수 없거나 권한이 없습니다.");
  },

  async findItemsByOrderIds(orderIds: string[]): Promise<OrderItem[]> {
    if (orderIds.length === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("order_items").select("*").in("order_id", orderIds);
    if (error) throw error;
    return data ?? [];
  },

  /** Repoints every order of `fromCustomerId` onto `toCustomerId`. Used by the merge flow. */
  async reassignCustomer(fromCustomerId: string, toCustomerId: string): Promise<number> {
    const { data, error } = await getSupabaseAdmin()
      .from("orders")
      .update({ customer_id: toCustomerId })
      .eq("customer_id", fromCustomerId)
      .select("id");
    if (error) throw error;
    return data?.length ?? 0;
  },

  /** Phase 2: excludes 취소 orders — this backs the "총 주문" dashboard stat, and a cancelled order isn't a real one anymore. */
  async count(ownerUsername?: string): Promise<number> {
    let q = getSupabaseAdmin().from("orders").select("*", { count: "exact", head: true }).neq("delivery_status", "취소");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  },

  /** Just customer_id for orders since a date — used for the new-vs-repeat breakdown (lighter than fetching full rows). Excludes 취소 orders. */
  async findCustomerIdsSince(sinceIso: string, ownerUsername?: string): Promise<string[]> {
    let q = getSupabaseAdmin().from("orders").select("customer_id").gte("order_date", sinceIso).neq("delivery_status", "취소");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => r.customer_id as string);
  },

  /** Phase 2: excludes 취소 orders from a customer's totals (VIP 판정/구매금액 등). */
  async aggregateStatsByCustomer(customerId: string) {
    const { data, error } = await getSupabaseAdmin()
      .from("orders")
      .select("total_amount, order_date")
      .eq("customer_id", customerId)
      .neq("delivery_status", "취소")
      .order("order_date", { ascending: true });
    if (error) throw error;
    const rows = data ?? [];
    const totalOrders = rows.length;
    const totalAmount = rows.reduce((sum, r) => sum + Number(r.total_amount), 0);
    return {
      totalOrders,
      totalAmount,
      averageAmount: totalOrders > 0 ? totalAmount / totalOrders : 0,
      firstOrderAt: rows[0]?.order_date ?? null,
      lastOrderAt: rows[rows.length - 1]?.order_date ?? null,
    };
  },
};
