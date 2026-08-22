"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { ordersRepository, type OrderSortField } from "@/lib/repositories/orders.repository";
import { orderShipmentsRepository } from "@/lib/repositories/order-shipments.repository";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { productsRepository } from "@/lib/repositories/products.repository";
import { createCustomerDirect } from "@/lib/services/customer.service";
import { allocateOrderNumbers } from "@/lib/services/order-number.service";
import { geocodeAddress } from "@/lib/services/geocoding.service";
import { triggerDeliveryGroupRegeneration } from "@/lib/services/delivery-group-regeneration.service";
import { formatPhoneNumber } from "@/lib/utils/phone";
import { toActionError } from "@/lib/utils/action-error";
import { isUuid } from "@/lib/utils/id";
import { kstDayDateStrOf } from "@/lib/utils/kst-date";
import { ownerScopeFor, requireSession, tenantScopeFor } from "@/lib/auth/current-session";
import { isOrderSource } from "@/lib/constants/order-source";
import type { Order, OrderItem, OrderShipment, DeliveryStatus, OrderSource, Customer } from "@/types/domain";

export async function listOrdersAction(page = 1, pageSize = 20) {
  const session = await requireSession();
  return ordersRepository.listRecent(page, pageSize, ownerScopeFor(session));
}

export interface OrderItemSummary {
  productSummary: string;
  totalQuantity: number;
  /** S1-3: 이 요약이 어느 범위(주문 전체 vs 배송건 하나)의 합인지에 따라 값이 다르다 — 배송일 필터가 걸린 목록에서는 order.total_amount(주문 전체 합)를 쓰면 안 되고 반드시 이 값을 써야 한다. */
  totalAmount: number;
}

export interface SearchOrdersParams {
  page?: number;
  pageSize?: number;
  deliveryStatus?: DeliveryStatus;
  bagReturned?: boolean;
  /** F8: 고객명/전화번호/주문번호 통합 검색어. */
  query?: string;
  orderSource?: OrderSource;
  orderDateFrom?: string;
  orderDateTo?: string;
  /** @deprecated single-day form — prefer deliveryDateFrom/To */
  deliveryDate?: string;
  deliveryDateFrom?: string;
  deliveryDateTo?: string;
  sortBy?: OrderSortField;
  sortAscending?: boolean;
}

/** S1-3: 목록 한 행 — 배송일 필터가 걸려 있으면 배송건 하나(rowKey=shipmentId), 아니면 주문 전체(rowKey=order.id)다. */
export type OrderListRow = Order & { rowKey: string; shipmentId?: string };

export interface SearchOrdersResult {
  orders: OrderListRow[];
  total: number;
  itemSummaries: Record<string, OrderItemSummary>;
  driverNames: Record<string, string>;
}

function summarize(items: OrderItem[]): OrderItemSummary {
  const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalAmount = items.reduce((sum, i) => sum + i.amount, 0);
  const productSummary =
    items.length === 0 ? "-" : items.length === 1 ? items[0].product_name : `${items[0].product_name} 외 ${items.length - 1}건`;
  return { productSummary, totalQuantity, totalAmount };
}

/**
 * "상품A 외 N건" 요약 문자열 + 총수량/총금액을 주문 전체 기준으로 계산한다.
 * Phase 6 STEP4: 배송관리 보드도 주문관리와 동일하게 상품 요약을 보여줘야
 * 해서 공용으로 뺐다. S1-3: 배송일 필터가 걸린 주문관리 목록에서는 이 함수
 * 대신 buildShipmentItemSummaries를 써야 한다 — 여기는 여전히 "주문에 속한
 * 모든 상품"을 합치므로, 배송일별로 갈라 보여줘야 하는 화면에 쓰면 CEO가
 * 금지한 "여러 날짜 금액을 합쳐서 표시"가 재발한다.
 */
export async function buildOrderItemSummaries(orders: Order[]): Promise<Record<string, OrderItemSummary>> {
  const items = await ordersRepository.findItemsByOrderIds(orders.map((o) => o.id));
  const byOrder = new Map<string, OrderItem[]>();
  for (const item of items) {
    const list = byOrder.get(item.order_id) ?? [];
    list.push(item);
    byOrder.set(item.order_id, list);
  }

  const itemSummaries: Record<string, OrderItemSummary> = {};
  for (const order of orders) {
    itemSummaries[order.id] = summarize(byOrder.get(order.id) ?? []);
  }
  return itemSummaries;
}

/**
 * S1-3/Phase 5: 배송건 하나에 속한 상품주문만 합친다 — 같은 주문의 다른
 * 배송일 상품은 절대 섞이지 않는다. 주문관리(OrderShipmentRow)와
 * 배송관리(OrderShipmentBoardRow) 둘 다 구조적으로 동일한 모양(Order &
 * {shipmentId, rowKey})이라 이 함수 하나를 공유한다.
 */
export async function buildShipmentItemSummaries(
  rows: { shipmentId: string; rowKey: string }[]
): Promise<Record<string, OrderItemSummary>> {
  const items = await ordersRepository.findItemsByShipmentIds(rows.map((r) => r.shipmentId));
  const byShipment = new Map<string, OrderItem[]>();
  for (const item of items) {
    if (!item.shipment_id) continue;
    const list = byShipment.get(item.shipment_id) ?? [];
    list.push(item);
    byShipment.set(item.shipment_id, list);
  }

  const itemSummaries: Record<string, OrderItemSummary> = {};
  for (const row of rows) {
    itemSummaries[row.rowKey] = summarize(byShipment.get(row.shipmentId) ?? []);
  }
  return itemSummaries;
}

export async function searchOrdersAction(params: SearchOrdersParams): Promise<SearchOrdersResult> {
  const session = await requireSession();
  const ownerUsername = ownerScopeFor(session);

  // S1-3: 배송일 필터가 걸려 있으면(기본값이 "오늘"이라 사실상 항상) 배송건
  // 단위로 조회한다 — 같은 주문이라도 상품주문별 발송일이 다르면 여러 행으로
  // 나타난다. 배송일 필터가 없는("전체") 경우에만 기존 주문 단위 조회로
  // 돌아간다.
  if (params.deliveryDateFrom || params.deliveryDateTo) {
    const { rows, total } = await ordersRepository.searchByShipmentDate({ ...params, ownerUsername });
    const orders: OrderListRow[] = rows.map((r) => ({ ...r, rowKey: r.rowKey, shipmentId: r.shipmentId }));
    const itemSummaries = await buildShipmentItemSummaries(rows);

    const driverIds = Array.from(new Set(rows.map((r) => r.driver_id).filter((id): id is string => id !== null)));
    const drivers = await driversRepository.findByIds(driverIds);
    const driverNames = Object.fromEntries(drivers.map((d) => [d.id, d.name]));

    return { orders, total, itemSummaries, driverNames };
  }

  const { orders: rawOrders, total } = await ordersRepository.search({ ...params, ownerUsername });
  const orders: OrderListRow[] = rawOrders.map((o) => ({ ...o, rowKey: o.id }));
  const itemSummaries = await buildOrderItemSummaries(rawOrders);

  const driverIds = Array.from(new Set(rawOrders.map((o) => o.driver_id).filter((id): id is string => id !== null)));
  const drivers = await driversRepository.findByIds(driverIds);
  const driverNames = Object.fromEntries(drivers.map((d) => [d.id, d.name]));

  return { orders, total, itemSummaries, driverNames };
}

export interface OrderDetail {
  order: Order;
  items: OrderItem[];
  driverName: string | null;
  shipments: OrderShipment[];
  shipmentDriverNames: Record<string, string>;
}

export async function getOrderDetailAction(id: string): Promise<OrderDetail | null> {
  const session = await requireSession();
  if (!isUuid(id)) return null;
  const order = await ordersRepository.findById(id);
  if (!order) return null;
  if (session.role !== "admin" && order.owner_username !== session.username) return null;

  const [items, driver, shipments] = await Promise.all([
    ordersRepository.findItemsByOrderIds([id]),
    order.driver_id ? driversRepository.findById(order.driver_id) : Promise.resolve(null),
    orderShipmentsRepository.findByOrderId(id),
  ]);
  const shipmentDriverIds = Array.from(new Set(shipments.map((s) => s.driver_id).filter((d): d is string => d !== null)));
  const shipmentDrivers = await driversRepository.findByIds(shipmentDriverIds);
  const shipmentDriverNames = Object.fromEntries(shipmentDrivers.map((d) => [d.id, d.name]));
  return { order, items, driverName: driver?.name ?? null, shipments, shipmentDriverNames };
}

export interface UpdateOrderBagActionState {
  ok: boolean;
  error: string | null;
}

export async function updateOrderBagAction(
  orderId: string,
  input: { bagNumber: string | null; bagReturned: boolean }
): Promise<UpdateOrderBagActionState> {
  const session = await requireSession();
  const order = await ordersRepository.findById(orderId);
  if (!order) return { ok: false, error: "주문을 찾을 수 없습니다." };
  if (session.role !== "admin" && order.owner_username !== session.username) {
    return { ok: false, error: "이 주문을 수정할 권한이 없습니다." };
  }

  await ordersRepository.update(
    orderId,
    { bag_number: input.bagNumber, bag_returned: input.bagReturned },
    session.role === "admin" ? undefined : session.username
  );
  revalidatePath("/orders");
  // 배송관리 화면에서도 가방 회수 여부를 바로 토글할 수 있어야 한다는
  // 실사용 피드백 반영 — 이 액션을 배송관리에서도 재사용하므로 그 화면도 갱신한다.
  revalidatePath("/delivery");
  return { ok: true, error: null };
}

export interface PriorUnreturnedBagsResult {
  count: number;
  orderIds: string[];
}

/** Checked before marking an order's bag as returned — surfaces earlier orders for the same customer that are still unreturned, so the shop owner can clear the backlog in one confirm. */
export async function checkPriorUnreturnedBagsAction(orderId: string): Promise<PriorUnreturnedBagsResult> {
  const session = await requireSession();
  const order = await ordersRepository.findById(orderId);
  if (!order) throw new Error("주문을 찾을 수 없습니다.");
  if (session.role !== "admin" && order.owner_username !== session.username) {
    throw new Error("이 주문을 수정할 권한이 없습니다.");
  }

  const referenceDate = order.delivery_date ?? order.order_date;
  const priorOrders = await ordersRepository.findUnreturnedPriorOrders(order.customer_id, orderId, referenceDate);
  return { count: priorOrders.length, orderIds: priorOrders.map((o) => o.id) };
}

/**
 * Marks the given order's bag returned, plus any additionally-selected prior orders ("전체 회수").
 *
 * Sprint 14-I P1 hotfix: previously only `orderId` (the primary order) was
 * ownership-checked — `includeOrderIds` was passed straight through to a raw
 * bulk UPDATE with no verification, letting any Seller flip another Seller's
 * orders to bag_returned=true. Non-admin callers must now own every id in
 * `includeOrderIds` too; any mismatch rejects the whole batch (the primary
 * order's own update also doesn't happen). Empty `includeOrderIds` behaves
 * exactly as before. `markManyBagsReturned()` re-verifies server-side too.
 */
export async function markBagReturnedAction(
  orderId: string,
  bagNumber: string | null,
  includeOrderIds: string[] = []
): Promise<UpdateOrderBagActionState> {
  const session = await requireSession();
  const order = await ordersRepository.findById(orderId);
  if (!order) return { ok: false, error: "주문을 찾을 수 없습니다." };
  if (session.role !== "admin" && order.owner_username !== session.username) {
    return { ok: false, error: "이 주문을 수정할 권한이 없습니다." };
  }

  if (includeOrderIds.length > 0 && session.role !== "admin") {
    const others = await ordersRepository.findByIds(includeOrderIds);
    const allOwned = others.length === includeOrderIds.length && others.every((o) => o.owner_username === session.username);
    if (!allOwned) {
      return { ok: false, error: "회수 처리할 권한이 없는 주문이 포함되어 있습니다." };
    }
  }

  await ordersRepository.update(
    orderId,
    { bag_number: bagNumber, bag_returned: true },
    session.role === "admin" ? undefined : session.username
  );
  await ordersRepository.markManyBagsReturned(includeOrderIds, session.role === "admin" ? undefined : session.username);
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  return { ok: true, error: null };
}

export interface CreateManualOrderState {
  ok: boolean;
  error: string | null;
  internalOrderNumber?: string;
}

/** F7: AddressSearchInput이 `${prefix}PostalCode`/`${prefix}RoadAddress`/`${prefix}DetailAddress` 3개 필드로 제출한 값을 조합한다. */
function readAddressFields(formData: FormData, prefix: string) {
  const postalCode = String(formData.get(`${prefix}PostalCode`) || "").trim() || null;
  const roadAddress = String(formData.get(`${prefix}RoadAddress`) || "").trim() || null;
  const detailAddress = String(formData.get(`${prefix}DetailAddress`) || "").trim() || null;
  const composed = [roadAddress, detailAddress].filter(Boolean).join(" ") || null;
  return { postalCode, roadAddress, detailAddress, composed };
}

/**
 * F6: 표준 수동 주문 등록. 고객은 "기존 고객 검색 후 선택" 또는 "신규 고객
 * 등록" 중 사용자가 명시적으로 고른 경로로만 정해진다 — 엑셀 임포트처럼
 * 이름+전화+주소 일치로 뒤에서 자동 매칭하지 않는다(사람이 이미 검색해서
 * 못 찾았다면 신규가 맞다는 판단을 신뢰한다). 수령인/연락처/주소는 고객의
 * 현재 정보와 독립된 이 주문만의 snapshot이다(F7) — 고객을 선택해도 값은
 * 폼에 채워질 뿐 이후 고객 정보가 바뀌어도 이 주문엔 영향이 없다.
 */
export async function createManualOrderAction(
  _prevState: CreateManualOrderState,
  formData: FormData
): Promise<CreateManualOrderState> {
  const session = await requireSession();

  const customerMode = String(formData.get("customerMode") || "new");
  const recipientName = String(formData.get("recipientName") || "").trim();
  const recipientPhoneRaw = String(formData.get("recipientPhone") || "").trim() || null;
  if (!recipientName) return { ok: false, error: "수령인 이름을 입력해주세요." };
  if (!recipientPhoneRaw) return { ok: false, error: "수령인 연락처를 입력해주세요." };

  const { postalCode, roadAddress, detailAddress, composed: address } = readAddressFields(formData, "delivery");
  if (!roadAddress) return { ok: false, error: "주소 검색으로 배송지를 선택해주세요." };

  const orderSourceRaw = String(formData.get("orderSource") || "").trim();
  if (!isOrderSource(orderSourceRaw)) return { ok: false, error: "주문 출처를 선택해주세요." };

  const productName = String(formData.get("productName") || "").trim();
  if (!productName) return { ok: false, error: "상품명을 입력해주세요." };
  const optionName = String(formData.get("optionName") || "").trim() || null;
  const productIdRaw = String(formData.get("productId") || "").trim() || null;

  const deliveryMemo = String(formData.get("deliveryMemo") || "").trim() || null;
  const orderMemo = String(formData.get("orderMemo") || "").trim() || null;
  const internalMemo = String(formData.get("internalMemo") || "").trim() || null;
  const orderDateRaw = String(formData.get("orderDate") || "").trim();
  const deliveryDateRaw = String(formData.get("deliveryDate") || "").trim();
  if (!deliveryDateRaw) return { ok: false, error: "배송일을 선택해주세요." };
  const status = String(formData.get("status") || "").trim() || "접수완료";
  const quantity = Math.max(1, Number(formData.get("quantity")) || 1);
  const unitPrice = Math.max(0, Number(formData.get("unitPrice")) || 0);

  const orderDate = orderDateRaw ? new Date(orderDateRaw).toISOString() : new Date().toISOString();
  const deliveryDate = new Date(deliveryDateRaw).toISOString();
  const amount = quantity * unitPrice;

  try {
    const tenantId = await tenantScopeFor(session);

    let customer: Customer;
    if (customerMode === "existing") {
      const existingCustomerId = String(formData.get("existingCustomerId") || "").trim();
      if (!existingCustomerId) return { ok: false, error: "기존 고객을 검색해서 선택해주세요." };
      const found = await customersRepository.findById(existingCustomerId);
      if (!found) return { ok: false, error: "선택한 고객을 찾을 수 없습니다." };
      if (session.role !== "admin" && found.owner_username !== session.username) {
        return { ok: false, error: "이 고객에 대한 권한이 없습니다." };
      }
      customer = found;
    } else {
      const newCustomerName = String(formData.get("newCustomerName") || "").trim();
      const newCustomerPhone = String(formData.get("newCustomerPhone") || "").trim() || null;
      if (!newCustomerName) return { ok: false, error: "신규 고객 이름을 입력해주세요." };
      customer = await createCustomerDirect({
        name: newCustomerName,
        rawPhone: newCustomerPhone,
        postalCode,
        roadAddress,
        detailAddress,
        ownerUsername: session.username,
      });
    }

    const [internalOrderNumber] = await allocateOrderNumbers(tenantId, [orderDate]);

    // Phase 1: 이 주문 생성 시점의 배송지를 독립적으로 지오코딩한다 — 고객
    // 프로필의 좌표와는 별개의 스냅샷이며, 실패해도 주문 저장은 계속된다.
    const geo = await geocodeAddress(roadAddress);

    // F-P3C: productId는 참조용 FK일 뿐이고 실제 저장되는 productName/unitPrice는
    // 이 폼의 값을 그대로 스냅샷으로 남긴다 — 그래도 다른 계정 상품을 가리키는
    // productId가 조작되어 들어오는 것은 막는다(소유권 불일치 시 조용히 무시).
    let productId: string | null = null;
    if (productIdRaw) {
      const product = await productsRepository.findById(productIdRaw);
      if (product && (session.role === "admin" || product.owner_username === session.username)) {
        productId = product.id;
      }
    }

    // 스마트스토어 주문만 order_number가 필수 — 수동 주문은 없어도 된다 (null).
    const [order] = await ordersRepository.createMany([
      {
        customer_id: customer.id,
        order_number: null,
        internal_order_number: internalOrderNumber,
        order_date: orderDate,
        status,
        total_amount: amount,
        recipient_name: recipientName,
        phone_snapshot: formatPhoneNumber(recipientPhoneRaw),
        address_snapshot: address,
        road_address_snapshot: roadAddress,
        detail_address_snapshot: detailAddress,
        zipcode: postalCode,
        ...geo,
        geocoded_at: new Date().toISOString(),
        delivery_memo: deliveryMemo,
        order_memo: orderMemo,
        internal_memo: internalMemo,
        delivery_date: deliveryDate,
        order_source: orderSourceRaw,
        owner_username: session.username,
        tenant_id: tenantId,
      },
    ]);

    // P0: 엑셀 임포트(import.service.ts)는 주문마다 order_shipments를 1건씩
    // 만드는데, 수동 주문 생성 경로는 이 배송건을 만들지 않아 배송관리/배송일
    // 필터가 걸린 주문관리(둘 다 order_shipments 기준으로 조회) 양쪽에서
    // 수동 주문이 보이지 않는 결함이 있었다. 엑셀 경로와 동일한 최소 필드
    // (id/order_id/tenant_id/owner_username/delivery_date)만 채우고 나머지
    // 운영 필드(driver_id/delivery_status/fulfillment_method 등)는 컬럼
    // 기본값에 맡긴다 — import.service.ts의 newShipmentInserts.push(...)와
    // 완전히 동일한 패턴.
    const shipmentId = randomUUID();
    await orderShipmentsRepository.createMany([
      {
        id: shipmentId,
        order_id: order.id,
        tenant_id: tenantId,
        owner_username: session.username,
        delivery_date: deliveryDate,
      },
    ]);

    await ordersRepository.createItems([
      {
        order_id: order.id,
        shipment_id: shipmentId,
        product_id: productId,
        product_name: productName,
        option_name: optionName,
        quantity,
        unit_price: unitPrice,
        amount,
      },
    ]);

    // P15-A: 신규 주문은 배송그룹에 새로 편입될 수 있으므로 그 배송일 하나만
    // 재계산한다 — 실패해도 주문 저장 자체는 이미 성공했으므로 무시(로그만).
    await triggerDeliveryGroupRegeneration(tenantId, kstDayDateStrOf(deliveryDate), session.username);

    revalidatePath("/orders");
    revalidatePath("/customers");
    revalidatePath("/");
    return { ok: true, error: null, internalOrderNumber };
  } catch (e) {
    return { ok: false, error: toActionError(e, "주문 등록 중 오류가 발생했습니다.") };
  }
}

export interface UpdateManualOrderState {
  ok: boolean;
  error: string | null;
}

/**
 * 주문 내용을 수정한다 (수동/엑셀 주문 모두 가능).
 *
 * Phase 2 P0: 이전에는 order_source==='manual'인 주문만 수정 가능했으나,
 * 실제 운영에서는 엑셀로 들어온 주문도 오타 수정/배송일 변경 등이 반드시
 * 필요해 이 제한을 없앤다. 원본 데이터 보존은 이미 order_items.extra에
 * 임포트 시점의 엑셀 원본 행이 그대로 저장되어 있고 이 경로에서 건드리지
 * 않으므로(updateItem은 product_name/quantity/unit_price/amount만 갱신)
 * 별도의 스냅샷 구조를 새로 만들 필요가 없다 — 주문 상세의 "엑셀 원본
 * 데이터" 펼침 영역에서 항상 원본을 확인할 수 있다.
 */
export async function updateManualOrderAction(
  orderId: string,
  _prevState: UpdateManualOrderState,
  formData: FormData
): Promise<UpdateManualOrderState> {
  const session = await requireSession();
  const order = await ordersRepository.findById(orderId);
  if (!order) return { ok: false, error: "주문을 찾을 수 없습니다." };
  if (session.role !== "admin" && order.owner_username !== session.username) {
    return { ok: false, error: "이 주문을 수정할 권한이 없습니다." };
  }
  if (order.delivery_status === "취소") {
    return { ok: false, error: "취소된 주문은 수정할 수 없습니다. 먼저 취소를 해제해주세요." };
  }

  // F12 STEP15: 신규 주문 등록(createManualOrderAction)에서는 연락처/배송일을
  // 필수로 바꿨지만, 이 수정 액션은 그대로 둔다 — "배송일 미지정" 주문을
  // 명시적으로 지원하는 기존 정책(Phase 5 STEP5)과 충돌하지 않기 위해서다.
  // 연락처가 아예 없던 과거 주문(F6 이전엔 전화/주소 중 하나만 필수)도
  // 이 수정 화면에서 다른 필드만 고치다가 막히면 안 된다.
  const recipientName = String(formData.get("name") || "").trim();
  const recipientPhoneRaw = String(formData.get("phone") || "").trim() || null;
  if (!recipientName) return { ok: false, error: "수령인 이름을 입력해주세요." };

  const { postalCode, roadAddress, detailAddress, composed: address } = readAddressFields(formData, "delivery");
  if (!roadAddress) return { ok: false, error: "주소 검색으로 배송지를 선택해주세요." };

  const orderSourceRaw = String(formData.get("orderSource") || "").trim();
  if (!isOrderSource(orderSourceRaw)) return { ok: false, error: "주문 출처를 선택해주세요." };

  const productName = String(formData.get("productName") || "").trim();
  if (!productName) return { ok: false, error: "상품명을 입력해주세요." };
  const optionName = String(formData.get("optionName") || "").trim() || null;

  const deliveryMemo = String(formData.get("deliveryMemo") || "").trim() || null;
  const orderMemo = String(formData.get("orderMemo") || "").trim() || null;
  const internalMemo = String(formData.get("internalMemo") || "").trim() || null;
  const orderDateRaw = String(formData.get("orderDate") || "").trim();
  const deliveryDateRaw = String(formData.get("deliveryDate") || "").trim();
  // S1-7: 운영 UI에서 이 필드의 입력창을 없앴다 — DB 컬럼은 유지하되, 폼에
  // 값이 없으면(항상 없음) 기존 값을 그대로 보존한다. "접수완료"로 덮어쓰면
  // 안 된다(그건 신규 생성 시에만 쓰는 기본값이다).
  const status = String(formData.get("status") || "").trim() || order.status;
  const quantity = Math.max(1, Number(formData.get("quantity")) || 1);
  const unitPrice = Math.max(0, Number(formData.get("unitPrice")) || 0);

  const orderDate = orderDateRaw ? new Date(orderDateRaw).toISOString() : order.order_date;
  const deliveryDate = deliveryDateRaw ? new Date(deliveryDateRaw).toISOString() : null;
  const amount = quantity * unitPrice;

  // Phase 1: 배송지 주소 텍스트가 실제로 바뀐 경우에만 재지오코딩한다 — 그
  // 외 필드만 고치는 흔한 수정에서 불필요한 API 호출/지연을 피하기 위해서다.
  const addressChanged =
    roadAddress !== order.road_address_snapshot || detailAddress !== order.detail_address_snapshot;
  const geo = addressChanged
    ? { ...(await geocodeAddress(roadAddress)), geocoded_at: new Date().toISOString() }
    : {
        latitude: order.latitude,
        longitude: order.longitude,
        sido: order.sido,
        sigungu: order.sigungu,
        eupmyeondong: order.eupmyeondong,
        sido_code: order.sido_code,
        sigungu_code: order.sigungu_code,
        eupmyeondong_code: order.eupmyeondong_code,
        geocode_status: order.geocode_status,
        geocoded_at: order.geocoded_at,
      };

  // P15-A: 주소 또는 배송일이 실제로 바뀐 경우에만 그룹을 재계산한다 — 그
  // 외 필드만 고치는 흔한 수정에서 불필요한 재계산을 피한다. 배송일이 바뀌면
  // 예전 날짜(그 그룹에서 빠져야 함)와 새 날짜(그 그룹에 들어가야 함) 둘 다
  // 재계산해야 한다.
  const oldDateStr = order.delivery_date ? kstDayDateStrOf(order.delivery_date) : null;
  const newDateStr = deliveryDate ? kstDayDateStrOf(deliveryDate) : null;
  const deliveryDateChanged = oldDateStr !== newDateStr;

  try {
    await ordersRepository.update(orderId, {
      recipient_name: recipientName,
      phone_snapshot: formatPhoneNumber(recipientPhoneRaw),
      address_snapshot: address,
      road_address_snapshot: roadAddress,
      detail_address_snapshot: detailAddress,
      zipcode: postalCode,
      ...geo,
      delivery_memo: deliveryMemo,
      order_memo: orderMemo,
      internal_memo: internalMemo,
      order_date: orderDate,
      delivery_date: deliveryDate,
      status,
      total_amount: amount,
      order_source: orderSourceRaw,
    }, session.role === "admin" ? undefined : session.username);

    // S2-B STEP0: orders.delivery_date만 바뀌고 order_shipments.delivery_date는
    // 예전 값으로 남아 배송관리/배송일 필터 주문관리가 서로 다른 날짜를 보여주던
    // dual-write 결함 수정 — 이 주문의 배송건도 함께 맞춘다. 배송일이 실제로
    // (KST 달력일 기준) 바뀐 경우에만 route_order를 리셋한다 — 같은 날짜 안에서의
    // 사소한 수정으로 기사 배정 순서가 불필요하게 날아가면 안 된다(CPO 지시).
    await orderShipmentsRepository.updateDeliveryDateForOrder(orderId, deliveryDate, deliveryDateChanged);

    const [existingItem] = await ordersRepository.findItemsByOrderIds([orderId]);
    if (existingItem) {
      await ordersRepository.updateItem(existingItem.id, {
        product_name: productName,
        option_name: optionName,
        quantity,
        unit_price: unitPrice,
        amount,
      });
    } else {
      await ordersRepository.createItems([
        { order_id: orderId, product_name: productName, option_name: optionName, quantity, unit_price: unitPrice, amount },
      ]);
    }

    if (addressChanged || deliveryDateChanged) {
      if (oldDateStr) await triggerDeliveryGroupRegeneration(order.tenant_id, oldDateStr, order.owner_username);
      if (newDateStr && newDateStr !== oldDateStr) {
        await triggerDeliveryGroupRegeneration(order.tenant_id, newDateStr, order.owner_username);
      }
    }

    revalidatePath("/orders");
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/delivery");
    revalidatePath("/");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "주문 수정 중 오류가 발생했습니다.") };
  }
}

export interface DeleteManualOrderState {
  ok: boolean;
  error: string | null;
}

/**
 * 수동 등록 주문만 삭제 가능. 엑셀 업로드 자동 파이프라인으로 들어온 주문은
 * 업로드 이력 삭제(재처리) 경로로만 제거된다.
 *
 * F6~F10: order_source가 "전화/문자/SNS/엑셀/기타"라는 순수 채널 메타데이터로
 * 바뀌면서(엑셀 주문출처를 고른 수동 주문도 존재) 이 판정은 더 이상
 * order_source로 할 수 없다 — 자동 파이프라인 여부를 정확히 나타내는
 * import_id(파이프라인이 생성한 주문에만 not null)로 판정한다.
 */
export async function deleteManualOrderAction(orderId: string): Promise<DeleteManualOrderState> {
  const session = await requireSession();
  const order = await ordersRepository.findById(orderId);
  if (!order) return { ok: false, error: "주문을 찾을 수 없습니다." };
  if (session.role !== "admin" && order.owner_username !== session.username) {
    return { ok: false, error: "이 주문을 삭제할 권한이 없습니다." };
  }
  if (order.import_id !== null) {
    return { ok: false, error: "엑셀 업로드로 등록된 주문은 삭제할 수 없습니다." };
  }

  try {
    await ordersRepository.deleteOne(orderId, session.role === "admin" ? undefined : session.username);
    // P15-A: 삭제된 주문이 그룹에 속해 있었을 수 있으므로 그 배송일만 재계산.
    if (order.delivery_date) {
      await triggerDeliveryGroupRegeneration(order.tenant_id, kstDayDateStrOf(order.delivery_date), order.owner_username);
    }
    revalidatePath("/orders");
    revalidatePath("/customers");
    revalidatePath("/");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "주문 삭제 중 오류가 발생했습니다.") };
  }
}

export interface OrderCancelActionState {
  ok: boolean;
  error: string | null;
}

/**
 * 주문을 소프트 취소한다 (delivery_status='취소'). 물리적으로 삭제하지
 * 않으므로 주문 상세/주문 목록에서는 계속 조회 가능하고, 배송관리 보드와
 * 통계/매출 집계에서만 제외된다(orders.repository.ts 참고). 수동/엑셀
 * 주문 모두 취소 가능 — 이미 배송완료된 주문은 취소할 수 없다.
 */
export async function cancelOrderAction(orderId: string): Promise<OrderCancelActionState> {
  const session = await requireSession();
  const order = await ordersRepository.findById(orderId);
  if (!order) return { ok: false, error: "주문을 찾을 수 없습니다." };
  if (session.role !== "admin" && order.owner_username !== session.username) {
    return { ok: false, error: "이 주문을 취소할 권한이 없습니다." };
  }

  try {
    await ordersRepository.cancelOrder(orderId, session.role === "admin" ? undefined : session.username);
    // P15-A: 취소된 주문은 배송그룹 대상에서 빠져야 하므로 그 배송일만 재계산.
    if (order.delivery_date) {
      await triggerDeliveryGroupRegeneration(order.tenant_id, kstDayDateStrOf(order.delivery_date), order.owner_username);
    }
    revalidatePath("/orders");
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/delivery");
    revalidatePath("/");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "주문 취소 중 오류가 발생했습니다.") };
  }
}

/** 취소를 해제하고 주문을 다시 배송대기 상태로 되돌린다. */
export async function uncancelOrderAction(orderId: string): Promise<OrderCancelActionState> {
  const session = await requireSession();
  const order = await ordersRepository.findById(orderId);
  if (!order) return { ok: false, error: "주문을 찾을 수 없습니다." };
  if (session.role !== "admin" && order.owner_username !== session.username) {
    return { ok: false, error: "이 주문을 처리할 권한이 없습니다." };
  }

  try {
    await ordersRepository.uncancelOrder(orderId, session.role === "admin" ? undefined : session.username);
    // P15-A: 취소 해제된 주문은 다시 배송그룹 대상이 될 수 있으므로 그 배송일만 재계산.
    if (order.delivery_date) {
      await triggerDeliveryGroupRegeneration(order.tenant_id, kstDayDateStrOf(order.delivery_date), order.owner_username);
    }
    revalidatePath("/orders");
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/delivery");
    revalidatePath("/");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "취소 해제 중 오류가 발생했습니다.") };
  }
}
