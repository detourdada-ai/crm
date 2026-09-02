import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { kstDayStartIso, kstDayEndIso } from "@/lib/utils/kst-date";
import { digitsOnly, formatPhoneNumber } from "@/lib/utils/phone";
import { isUuid } from "@/lib/utils/id";
import type { Order, OrderItem, OrderSource, DeliveryStatus, FulfillmentMethod, GeocodeStatus, PaymentStatus, PaymentMethod } from "@/types/domain";

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
  buyer_phone_snapshot?: string | null;
  recipient_phone_snapshot?: string | null;
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
  /** Phase 2 §5: null = "확인 필요"(표준엑셀 값이 4개 표준값 중 아무 것도 아님) — 컬럼 자체가 없는 파일/수동주문은 호출부가 명시적으로 "결제완료"를 채운다. */
  payment_status?: PaymentStatus | null;
  payment_method?: PaymentMethod | null;
  paid_at?: string | null;
  delivery_fee?: number;
  discount_amount?: number;
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
  payment_status?: PaymentStatus | null;
  payment_method?: PaymentMethod | null;
  paid_at?: string | null;
  delivery_fee?: number;
  discount_amount?: number;
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
  /** Phase 2 §5(2026-08 CPO 작업지시): "unknown"은 payment_status IS NULL("확인 필요")만 걸러본다. */
  paymentStatus?: PaymentStatus | "unknown";
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
  /**
   * STD-6/7: 상품 집계 칩을 클릭했을 때 "이 상품이 포함된 주문 id" 목록으로
   * 좁힌다. order_items.product_name 기준으로 미리 조회한 order_id 목록을
   * 넘겨받는 형태 — actions/orders.ts에서 findOrderIdsByProductName()으로
   * 구해서 넘긴다(레포지토리는 문자열 매칭을 모르고 id 필터만 안다).
   * search()(주문 단위 조회) 전용.
   */
  productOrderIds?: string[];
  /** 긴급수정(2026-08): searchByShipmentDate(배송건 단위 조회) 전용 — 같은 주문의 다른 배송건까지 끌려오지 않도록 배송건 id로 좁힌다. */
  productShipmentIds?: string[];
}

/**
 * S1-3: 배송건 단위 조회 결과 행. `delivery_date`는 주문 전체가 아니라 이
 * 배송건 하나의 발송일로 덮어써져 있다 — 같은 주문이 여러 행으로 나타날 때
 * 각 행이 서로 다른 날짜를 보여주기 위함이다. `id`는 여전히 실제 주문 id라
 * 상세페이지 링크(/orders/[id])는 그대로 동작하고, `rowKey`(=shipmentId)를
 * React key/상품요약 조회 키로 따로 써서 같은 주문의 여러 행이 서로
 * 충돌하지 않게 한다.
 */
export interface OrderShipmentRow extends Order {
  shipmentId: string;
  rowKey: string;
}

export interface OrderItemInsert {
  order_id: string;
  tenant_id: string;
  shipment_id?: string | null;
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

  /**
   * P4C STEP3-C(2026-08 CPO 작업지시): 도로명주소 추출 정정(geocoding.service.ts)
   * 이후 재지오코딩 백필 대상 — 이전에 실패로 남은 주문만, 주소 원문이 있는
   * 것만 대상으로 한다("pending"은 애초에 시도한 적이 없어 대상이 아니다).
   */
  async findFailedGeocode(): Promise<Pick<Order, "id" | "address_snapshot" | "owner_username">[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("orders")
      .select("id, address_snapshot, owner_username")
      .eq("geocode_status", "failed")
      .not("address_snapshot", "is", null);
    if (error) throw error;
    return (data as Pick<Order, "id" | "address_snapshot" | "owner_username">[]) ?? [];
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

  /**
   * STEP2(누적 스마트스토어 엑셀 중복판정 재설계, 2026-08 CPO 작업지시): 상품주문번호
   * (product_order_number) 기준 1차 중복 판정 — tenant 범위 안에서만 조회한다.
   * order_number(부모)는 더 이상 중복판정 키가 아니라 그룹 연결 정보로만 쓰인다.
   * 전체 행을 반환하는 이유: §6/QA-7 "정보 차이 표시"(배송일/주소 등)를 위해
   * shipment_id로 배송건을 마저 조회해야 하고, 단순 존재 여부(Set)만으로는
   * 부족하다.
   */
  async findExistingProductOrderItems(productOrderNumbers: string[], tenantId: string): Promise<OrderItem[]> {
    if (productOrderNumbers.length === 0) return [];
    const CHUNK_SIZE = 300;
    const found: OrderItem[] = [];
    for (let i = 0; i < productOrderNumbers.length; i += CHUNK_SIZE) {
      const chunk = productOrderNumbers.slice(i, i + CHUNK_SIZE);
      const { data, error } = await getSupabaseAdmin()
        .from("order_items")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("product_order_number", chunk);
      if (error) throw error;
      found.push(...((data as OrderItem[]) ?? []));
    }
    return found;
  },

  /**
   * STEP2: 이미 이 tenant에 존재하는 부모 주문(order_number)을 찾는다 — 신규
   * 상품주문을 붙일 기존 order_id를 알아야 하기 때문(§2-2, §8 Case B/D).
   * order_number 없이 새 orders row를 만드는 게 아니라, 있으면 반드시
   * 재사용한다(부모 주문 중복 생성 방지).
   */
  async findOrdersByOrderNumbersForTenant(orderNumbers: string[], tenantId: string): Promise<Map<string, Order>> {
    const result = new Map<string, Order>();
    if (orderNumbers.length === 0) return result;
    const CHUNK_SIZE = 300;
    for (let i = 0; i < orderNumbers.length; i += CHUNK_SIZE) {
      const chunk = orderNumbers.slice(i, i + CHUNK_SIZE);
      const { data, error } = await getSupabaseAdmin().from("orders").select("*").eq("tenant_id", tenantId).in("order_number", chunk);
      if (error) throw error;
      for (const o of (data as Order[]) ?? []) if (o.order_number) result.set(o.order_number, o);
    }
    return result;
  },

  /**
   * §CPO 작업지시(누적 표준 엑셀 중복방지): 주문번호가 없는 업로드 행의 중복
   * 판정용 후보 풀 — tenant 범위 안에서 phone_snapshot이 일치하는 주문만
   * 가져온다(§17 tenant 격리). 취소된 주문은 "더 이상 유효하지 않은 주문"이라
   * 재업로드를 막을 이유가 없으므로 후보에서 제외한다 — 이 판단은 CTO
   * 재량으로 최종보고서에 명시한다.
   */
  async findByPhonesForDedup(tenantId: string, phones: string[]): Promise<Order[]> {
    if (phones.length === 0) return [];
    const CHUNK_SIZE = 300;
    const result: Order[] = [];
    for (let i = 0; i < phones.length; i += CHUNK_SIZE) {
      const chunk = phones.slice(i, i + CHUNK_SIZE);
      const { data, error } = await getSupabaseAdmin()
        .from("orders")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("phone_snapshot", chunk)
        .neq("delivery_status", "취소");
      if (error) throw error;
      result.push(...((data as Order[]) ?? []));
    }
    return result;
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

  /** UX11: "표시 컬럼"에 노출할 엑셀 원본 컬럼 후보를 만들기 위해, 이 계정의 최근 주문 id만 가볍게 가져온다(order_items.extra 스캔용 — 전체 이력을 다 훑을 필요는 없다). */
  async findRecentOrderIdsForExtraScan(ownerUsername: string, limit = 300): Promise<string[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("orders")
      .select("id")
      .eq("owner_username", ownerUsername)
      .order("order_date", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r) => r.id as string);
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
    paymentStatus,
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
    productOrderIds,
  }: OrderSearchParams) {
    if (productOrderIds && productOrderIds.length === 0) return { orders: [] as Order[], total: 0 };
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let q = getSupabaseAdmin().from("orders").select("*", { count: "exact" });
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    if (deliveryStatus) q = q.eq("delivery_status", deliveryStatus);
    if (paymentStatus === "unknown") q = q.is("payment_status", null);
    else if (paymentStatus) q = q.eq("payment_status", paymentStatus);
    if (bagReturned !== undefined) q = q.eq("bag_returned", bagReturned);
    if (orderSource) q = q.eq("order_source", orderSource);
    if (productOrderIds) q = q.in("id", productOrderIds);
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

  /**
   * STD-5: search()와 동일한 필터를 페이지네이션 없이 적용해 "이 필터에
   * 걸리는 전체 주문 id"만 얻는다 — 상품 집계(현재 페이지가 아니라 필터
   * 전체 기준)를 계산하려면 order_items를 이 id 전체에 대해 조회해야 하기
   * 때문. search()와 필터 조건을 반드시 같이 맞춰야 한다(필터 로직이
   * 갈라지면 "목록에 안 보이는데 집계엔 잡히는" 불일치가 생긴다).
   */
  async findAllMatchingOrderIds({
    ownerUsername,
    deliveryStatus,
    paymentStatus,
    bagReturned,
    query,
    orderSource,
    orderDateFrom,
    orderDateTo,
    deliveryDate,
    deliveryDateFrom,
    deliveryDateTo,
  }: OrderSearchParams): Promise<string[]> {
    let q = getSupabaseAdmin().from("orders").select("id");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    if (deliveryStatus) q = q.eq("delivery_status", deliveryStatus);
    if (paymentStatus === "unknown") q = q.is("payment_status", null);
    else if (paymentStatus) q = q.eq("payment_status", paymentStatus);
    if (bagReturned !== undefined) q = q.eq("bag_returned", bagReturned);
    if (orderSource) q = q.eq("order_source", orderSource);
    if (query && query.trim()) {
      const term = query.trim();
      const digits = digitsOnly(term);
      const phoneVariant = digits.length >= 8 ? formatPhoneNumber(digits) : null;
      const phoneClause = phoneVariant && phoneVariant !== term ? `,phone_snapshot.ilike.%${phoneVariant}%` : "";
      q = q.or(
        `recipient_name.ilike.%${term}%,phone_snapshot.ilike.%${term}%${phoneClause},order_number.ilike.%${term}%,internal_order_number.ilike.%${term}%`
      );
    }
    if (orderDateFrom) q = q.gte("order_date", kstDayStartIso(orderDateFrom));
    if (orderDateTo) q = q.lte("order_date", kstDayEndIso(orderDateTo));
    if (deliveryDateFrom || deliveryDateTo) {
      if (deliveryDateFrom) q = q.gte("delivery_date", kstDayStartIso(deliveryDateFrom));
      if (deliveryDateTo) q = q.lte("delivery_date", kstDayEndIso(deliveryDateTo));
    } else if (deliveryDate) {
      q = q.gte("delivery_date", kstDayStartIso(deliveryDate)).lte("delivery_date", kstDayEndIso(deliveryDate));
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => r.id as string);
  },

  /**
   * STD-6/STEP12-10(R06): 상품 집계 칩 클릭 시 그 상품이 포함된 주문 id
   * 목록을 구한다. groupKey는 product-summary.ts의 ProductSummaryEntry.groupKey —
   * 별칭으로 표준상품에 연결된 product_id(UUID)이면 product_id로, 아니면
   * (별칭 없는 과거/미매핑 상품명) product_name 문자열로 매칭한다.
   */
  async findOrderIdsByProductName(groupKey: string): Promise<string[]> {
    let q = getSupabaseAdmin().from("order_items").select("order_id");
    q = isUuid(groupKey) ? q.eq("product_id", groupKey) : q.eq("product_name", groupKey);
    const { data, error } = await q;
    if (error) throw error;
    return Array.from(new Set((data ?? []).map((r) => r.order_id as string)));
  },

  /**
   * 긴급수정(2026-08): 배송건(order_shipments) 단위 조회에서는 "그 상품이
   * 포함된 주문"이 아니라 "그 상품이 포함된 배송건"으로 좁혀야 한다 — 같은
   * 주문이 발송일이 달라 여러 배송건으로 나뉘면(S1-3), order_id 기준 필터는
   * 그 주문의 다른 배송건(오늘이지만 전혀 다른 상품)까지 같이 끌고 와서
   * "상품명 select의 건수"와 "실제 필터링된 목록 건수"가 어긋나는 버그가
   * 있었다(예: 세트봄날반찬 26건인데 목록엔 29건). searchByShipmentDate
   * 전용 — search()의 주문 단위 조회는 findOrderIdsByProductName을 그대로 쓴다.
   */
  async findShipmentIdsByProductName(groupKey: string): Promise<string[]> {
    let q = getSupabaseAdmin().from("order_items").select("shipment_id").not("shipment_id", "is", null);
    q = isUuid(groupKey) ? q.eq("product_id", groupKey) : q.eq("product_name", groupKey);
    const { data, error } = await q;
    if (error) throw error;
    return Array.from(new Set((data ?? []).map((r) => r.shipment_id as string)));
  },

  /**
   * S1-3: 배송일 필터가 걸려 있을 때는 "주문" 대신 "배송건(order_shipments)"이
   * 조회 단위가 된다 — 같은 주문이라도 상품주문별 발송일이 다르면 서로 다른
   * 배송건이므로 여러 행으로 나뉘어 나타난다(CEO 지시: 절대 합산 금지).
   *
   * 배송건은 delivery_date 범위로 먼저 좁혀 작은 집합을 만든 뒤(실제 운영
   * 스케일에서 "오늘"/"이번주" 범위는 항상 소수 건), 그 주문들만 findByIds로
   * 가져와 나머지 필터(상태/출처/검색어/가방)를 메모리에서 적용한다 —
   * PostgREST로 order_shipments↔orders를 텍스트 검색까지 포함해 한 번에
   * 조인하려면 임베디드 필터 문법에 의존해야 하는데, 이 방식이 훨씬 검증하기
   * 쉽고 이 프로젝트 실제 데이터 규모(수백~수천 건)에서 충분히 빠르다.
   *
   * P4C STEP2-A(2026-08 CPO 작업지시): 상태(delivery_status) 필터/표시는
   * order_shipments.delivery_status(이 배송건 자신의 실제 상태)를 기준으로
   * 한다 — S1-1 당시엔 배송관리가 배송건 기준으로 전환되기 전이라 이 컬럼이
   * 신뢰 불가였지만, Phase 5 이후 배정/시작/완료가 전부 배송건 단위로
   * 실시간 갱신되므로 이제는 이 컬럼이 진실이다. orders.delivery_status(부모
   * 롤업)를 계속 쓰면 "한 주문이 여러 배송일로 나뉜 경우, 오늘 배송은 이미
   * 완료됐는데도 다른 날짜 배송이 안 끝나 주문 전체가 '배송중'으로 보여
   * 배송관리(완료)와 어긋나는" 실제 Production 사고(97개 배송건 실측 확인)를
   * 낳았다.
   */
  async searchByShipmentDate({
    page = 1,
    pageSize = 20,
    ownerUsername,
    deliveryStatus,
    paymentStatus,
    bagReturned,
    query,
    orderSource,
    orderDateFrom,
    orderDateTo,
    deliveryDateFrom,
    deliveryDateTo,
    sortBy = "delivery_date",
    sortAscending = false,
    productShipmentIds,
  }: OrderSearchParams): Promise<{ rows: OrderShipmentRow[]; total: number; allShipmentIds: string[]; distinctOrderCount: number }> {
    if (productShipmentIds && productShipmentIds.length === 0)
      return { rows: [], total: 0, allShipmentIds: [], distinctOrderCount: 0 };
    const productShipmentIdSet = productShipmentIds ? new Set(productShipmentIds) : null;
    let sq = getSupabaseAdmin().from("order_shipments").select("id, order_id, delivery_date, delivery_status");
    if (ownerUsername) sq = sq.eq("owner_username", ownerUsername);
    if (deliveryDateFrom) sq = sq.gte("delivery_date", kstDayStartIso(deliveryDateFrom));
    if (deliveryDateTo) sq = sq.lte("delivery_date", kstDayEndIso(deliveryDateTo));
    const { data: shipmentRows, error: shipmentError } = await sq;
    if (shipmentError) throw shipmentError;
    const shipments = shipmentRows ?? [];
    if (shipments.length === 0) return { rows: [], total: 0, allShipmentIds: [], distinctOrderCount: 0 };

    const orderIds = Array.from(new Set(shipments.map((s) => s.order_id)));
    const { data: orderRows, error: orderError } = await getSupabaseAdmin().from("orders").select("*").in("id", orderIds);
    if (orderError) throw orderError;
    const orderById = new Map((orderRows as Order[]).map((o) => [o.id, o]));

    const term = query?.trim();
    const digits = term ? digitsOnly(term) : "";
    const phoneVariant = term && digits.length >= 8 ? formatPhoneNumber(digits) : null;

    let rows: OrderShipmentRow[] = [];
    // UX11: 상품명 select의 옵션 목록(=productSummary 계산에 쓰이는
    // allShipmentIds)은 productName 자신을 제외한 나머지 필터로만 좁혀야
    // 한다 — 안 그러면 "김치"를 선택한 순간 옵션이 "김치" 하나로 붕괴돼
    // 다른 상품으로 바로 전환할 수 없다(search()/findAllMatchingOrderIds의
    // productName-제외 패턴과 동일하게 맞춘다).
    const allShipmentIdsExcludingProduct: string[] = [];
    for (const s of shipments) {
      const order = orderById.get(s.order_id);
      if (!order) continue; // 방어적: 삭제된 주문의 배송건이 FK cascade 반영 전에 조회된 경우
      if (deliveryStatus && s.delivery_status !== deliveryStatus) continue;
      if (paymentStatus === "unknown" && order.payment_status !== null) continue;
      else if (paymentStatus && paymentStatus !== "unknown" && order.payment_status !== paymentStatus) continue;
      if (bagReturned !== undefined && order.bag_returned !== bagReturned) continue;
      if (orderSource && order.order_source !== orderSource) continue;
      if (orderDateFrom && order.order_date < kstDayStartIso(orderDateFrom)) continue;
      if (orderDateTo && order.order_date > kstDayEndIso(orderDateTo)) continue;
      if (term) {
        const matches =
          order.recipient_name?.toLowerCase().includes(term.toLowerCase()) ||
          order.phone_snapshot?.includes(term) ||
          (phoneVariant && order.phone_snapshot?.includes(phoneVariant)) ||
          order.order_number?.toLowerCase().includes(term.toLowerCase()) ||
          order.internal_order_number?.toLowerCase().includes(term.toLowerCase());
        if (!matches) continue;
      }
      allShipmentIdsExcludingProduct.push(s.id);
      if (productShipmentIdSet && !productShipmentIdSet.has(s.id)) continue;
      // P4C STEP2-A: delivery_status도 이 배송건 자신의 실제 상태로 덮어쓴다 —
      // delivery_date와 마찬가지로 order 스프레드 그대로 두면 부모 주문 롤업
      // 상태가 노출돼 배송관리와 어긋나 보인다(위 함수 doc 참고).
      rows.push({
        ...order,
        shipmentId: s.id,
        rowKey: s.id,
        delivery_date: s.delivery_date,
        delivery_status: s.delivery_status as DeliveryStatus,
      });
    }

    // sortBy가 "delivery_date"면 배송건 자신의 날짜(위에서 이미 order.delivery_date
    // 자리에 덮어썼다) 기준으로, 그 외 필드는 원래 주문 값 기준으로 정렬한다.
    // 동률이면 search()와 동일하게 order_date 최신순으로 묶는다.
    const dir = sortAscending ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortBy as keyof Order];
      const bv = b[sortBy as keyof Order];
      if (av == null && bv == null) return b.order_date < a.order_date ? -1 : 1;
      if (av == null) return 1; // nullsFirst: false와 동일하게 null은 항상 뒤로
      if (bv == null) return -1;
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return b.order_date < a.order_date ? -1 : 1;
    });
    const total = rows.length;
    // P4C STEP2-A: "주문 N건 · 배송 M건" 이중 표기를 위해, 페이지네이션으로
    // 잘리기 전 이 필터에 걸리는 전체 배송건이 실제로 서로 다른 주문 몇 건에
    // 속하는지도 함께 센다(§2 — 배송건 수를 주문 수로 강제 통일하지 않되,
    // 둘 다 보여주기 위함).
    const distinctOrderCount = new Set(rows.map((r) => r.id)).size;
    const from = (page - 1) * pageSize;
    rows = rows.slice(from, from + pageSize);
    return { rows, total, allShipmentIds: allShipmentIdsExcludingProduct, distinctOrderCount };
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
   * 완료를 벗어나면 completed_at을 지운다(되돌렸다는 사실을 반영).
   * P9 2번: "기사 미배정 일반배송을 실수로 배송중/완료 처리할 수 없다"를
   * 배송중뿐 아니라 완료에도 적용한다 — 배송대기에서 기사도 없이 바로
   * 완료로 건너뛸 수 있었던 건 "누가 배송했는지" 기록 없이 완료 처리가
   * 되는 허점이었다. 배송대기로 "가는" 데는 여전히 제약이 없다(되돌리기는
   * 항상 허용).
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
    if (status === "배송중" || status === "완료") {
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
   * P7 7-1번: "직접수령 선택 → 상태가 완료로 안 바뀐다"는 지적 — 직접수령은
   * 고객이 매장에서 이미 받아간 사건이라 배송중 단계가 없다. 그래서
   * direct_pickup으로 바꾸는 순간 배송완료까지 같이 처리한다(배송대기→배송중
   * 을 거치지 않고 바로 완료). 잘못 눌렀다면 상태 배지로 완료→배송대기를
   * 되돌린 뒤(7-3) "해제" 버튼으로 배송방식을 되돌리면 된다.
   */
  async setFulfillmentMethod(orderIds: string[], method: FulfillmentMethod, ownerUsername?: string): Promise<number> {
    if (orderIds.length === 0) return 0;
    const admin = getSupabaseAdmin();
    const update =
      method === "direct_pickup"
        ? { fulfillment_method: method, driver_id: null, delivery_status: "완료" as const, completed_at: new Date().toISOString() }
        : { fulfillment_method: method };
    let q = admin
      .from("orders")
      .update(update)
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

  /**
   * P15-B: 기사 화면 — findByDriverId는 배송일 조건이 없어(상태만 필터)
   * "오늘"이 아니라 이 기사에게 배정된 모든 날짜의 해당 상태 주문을
   * 반환한다. 기사 지도/카드는 "오늘 배송"만 봐야 하므로 배송일 범위를
   * 추가한 별도 메서드로 분리한다. 취소 건은 제외하고 배송중+완료를
   * 모두 가져와(완료는 카운트/"완료 보기" 토글용), 화면에서 남은/완료로
   * 나눈다 — 완료 여부와 무관하게 "오늘 이 기사 담당"인 건 전부 필요하기
   * 때문에 상태 인자를 받지 않는다.
   */
  async findByDriverIdAndDeliveryDate(driverId: string, dateStr: string): Promise<Order[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("orders")
      .select("*")
      .eq("driver_id", driverId)
      .neq("delivery_status", "취소")
      .gte("delivery_date", kstDayStartIso(dateStr))
      .lte("delivery_date", kstDayEndIso(dateStr))
      .order("delivery_date", { ascending: true });
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

  /**
   * UX11-STEP1 P0-1: 업로드 직후 "배송일 미지정" 주문들에 한 번에 배송일을
   * 지정한다 — 이미 배송일이 있는 주문은 절대 덮어쓰지 않도록 `.is("delivery_date", null)`로
   * 한 번 더 좁힌다(호출부가 넘긴 orderIds가 실제로 미지정 상태인지와
   * 무관하게 안전). markManyBagsReturned와 동일한 이중검증 패턴 — ownerUsername이
   * 있으면 UPDATE 전에 모든 id의 소유권을 재확인한다.
   */
  async assignMissingDeliveryDate(orderIds: string[], deliveryDate: string, ownerUsername?: string): Promise<void> {
    if (orderIds.length === 0) return;
    if (ownerUsername) {
      const { data: owned, error: checkError } = await getSupabaseAdmin()
        .from("orders")
        .select("id")
        .in("id", orderIds)
        .eq("owner_username", ownerUsername);
      if (checkError) throw checkError;
      if ((owned?.length ?? 0) !== orderIds.length) {
        throw new Error("배송일 지정 권한이 없는 주문이 포함되어 있습니다.");
      }
    }
    const { error } = await getSupabaseAdmin()
      .from("orders")
      .update({ delivery_date: deliveryDate })
      .in("id", orderIds)
      .is("delivery_date", null);
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

  /** S1-3: 배송건 단위 상품요약(productSummary/totalQuantity/totalAmount) 계산용 — 그 배송건에 속한 상품주문만 가져온다(주문 전체 아님). */
  async findItemsByShipmentIds(shipmentIds: string[]): Promise<OrderItem[]> {
    if (shipmentIds.length === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("order_items").select("*").in("shipment_id", shipmentIds);
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
