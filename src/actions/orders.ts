"use server";

import { revalidatePath } from "next/cache";
import { ordersRepository, type OrderSortField } from "@/lib/repositories/orders.repository";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { resolveCustomerForImportRow } from "@/lib/services/customer.service";
import { formatPhoneNumber } from "@/lib/utils/phone";
import { cleanAddress } from "@/lib/utils/address";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import type { Order, OrderItem, DeliveryStatus } from "@/types/domain";

export async function listOrdersAction(page = 1, pageSize = 20) {
  const session = await requireSession();
  return ordersRepository.listRecent(page, pageSize, ownerScopeFor(session));
}

export interface OrderItemSummary {
  productSummary: string;
  totalQuantity: number;
}

export interface SearchOrdersParams {
  page?: number;
  pageSize?: number;
  deliveryStatus?: DeliveryStatus;
  bagReturned?: boolean;
  orderDateFrom?: string;
  orderDateTo?: string;
  deliveryDate?: string;
  sortBy?: OrderSortField;
  sortAscending?: boolean;
}

export interface SearchOrdersResult {
  orders: Order[];
  total: number;
  itemSummaries: Record<string, OrderItemSummary>;
  driverNames: Record<string, string>;
}

export async function searchOrdersAction(params: SearchOrdersParams): Promise<SearchOrdersResult> {
  const session = await requireSession();
  const { orders, total } = await ordersRepository.search({ ...params, ownerUsername: ownerScopeFor(session) });

  const items = await ordersRepository.findItemsByOrderIds(orders.map((o) => o.id));
  const byOrder = new Map<string, OrderItem[]>();
  for (const item of items) {
    const list = byOrder.get(item.order_id) ?? [];
    list.push(item);
    byOrder.set(item.order_id, list);
  }

  const itemSummaries: Record<string, OrderItemSummary> = {};
  for (const order of orders) {
    const orderItems = byOrder.get(order.id) ?? [];
    const totalQuantity = orderItems.reduce((sum, i) => sum + i.quantity, 0);
    const productSummary =
      orderItems.length === 0
        ? "-"
        : orderItems.length === 1
          ? orderItems[0].product_name
          : `${orderItems[0].product_name} 외 ${orderItems.length - 1}건`;
    itemSummaries[order.id] = { productSummary, totalQuantity };
  }

  const driverIds = Array.from(new Set(orders.map((o) => o.driver_id).filter((id): id is string => id !== null)));
  const drivers = await driversRepository.findByIds(driverIds);
  const driverNames = Object.fromEntries(drivers.map((d) => [d.id, d.name]));

  return { orders, total, itemSummaries, driverNames };
}

export interface OrderDetail {
  order: Order;
  items: OrderItem[];
  driverName: string | null;
}

export async function getOrderDetailAction(id: string): Promise<OrderDetail | null> {
  const session = await requireSession();
  const order = await ordersRepository.findById(id);
  if (!order) return null;
  if (session.role !== "admin" && order.owner_username !== session.username) return null;

  const [items, driver] = await Promise.all([
    ordersRepository.findItemsByOrderIds([id]),
    order.driver_id ? driversRepository.findById(order.driver_id) : Promise.resolve(null),
  ]);
  return { order, items, driverName: driver?.name ?? null };
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

  await ordersRepository.update(orderId, { bag_number: input.bagNumber, bag_returned: input.bagReturned });
  revalidatePath("/orders");
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

/** Marks the given order's bag returned, plus any additionally-selected prior orders ("전체 회수"). */
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

  await ordersRepository.update(orderId, { bag_number: bagNumber, bag_returned: true });
  await ordersRepository.markManyBagsReturned(includeOrderIds);
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  return { ok: true, error: null };
}

export interface CreateManualOrderState {
  ok: boolean;
  error: string | null;
}

/**
 * Creates an order by hand (phone order, walk-in, correction, etc). Reuses
 * the same customer resolution as the excel import pipeline, so the
 * customer record is created/matched exactly the same way and immediately
 * shows up in customer management — no separate sync step needed.
 */
export async function createManualOrderAction(
  _prevState: CreateManualOrderState,
  formData: FormData
): Promise<CreateManualOrderState> {
  const session = await requireSession();

  const name = String(formData.get("name") || "").trim();
  const rawPhone = String(formData.get("phone") || "").trim() || null;
  const rawAddress = String(formData.get("address") || "").trim() || null;
  if (!name) return { ok: false, error: "고객 이름을 입력해주세요." };
  if (!rawPhone && !rawAddress) return { ok: false, error: "전화번호 또는 주소 중 하나는 입력해주세요." };

  const productName = String(formData.get("productName") || "").trim();
  if (!productName) return { ok: false, error: "상품명을 입력해주세요." };

  const deliveryMemo = String(formData.get("deliveryMemo") || "").trim() || null;
  const orderDateRaw = String(formData.get("orderDate") || "").trim();
  const deliveryDateRaw = String(formData.get("deliveryDate") || "").trim();
  const status = String(formData.get("status") || "").trim() || "접수완료";
  const quantity = Math.max(1, Number(formData.get("quantity")) || 1);
  const unitPrice = Math.max(0, Number(formData.get("unitPrice")) || 0);

  const orderDate = orderDateRaw ? new Date(orderDateRaw).toISOString() : new Date().toISOString();
  const deliveryDate = deliveryDateRaw ? new Date(deliveryDateRaw).toISOString() : null;
  const amount = quantity * unitPrice;

  try {
    const { customer } = await resolveCustomerForImportRow({
      name,
      rawPhone,
      rawAddress,
      ownerUsername: session.username,
    });

    // 스마트스토어 주문만 order_number가 필수 — 수동 주문은 없어도 된다 (null).
    const [order] = await ordersRepository.createMany([
      {
        customer_id: customer.id,
        order_number: null,
        order_date: orderDate,
        status,
        total_amount: amount,
        recipient_name: name,
        phone_snapshot: formatPhoneNumber(rawPhone),
        address_snapshot: cleanAddress(rawAddress),
        delivery_memo: deliveryMemo,
        delivery_date: deliveryDate,
        order_source: "manual",
        owner_username: session.username,
      },
    ]);

    await ordersRepository.createItems([
      {
        order_id: order.id,
        product_name: productName,
        quantity,
        unit_price: unitPrice,
        amount,
      },
    ]);

    revalidatePath("/orders");
    revalidatePath("/customers");
    revalidatePath("/");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "주문 등록 중 오류가 발생했습니다." };
  }
}

export interface UpdateManualOrderState {
  ok: boolean;
  error: string | null;
}

/** 수동 등록 주문(order_source='manual')만 수정 가능 — 임포트로 들어온 스마트스토어 원본 주문은 스냅샷이라 수정 대상이 아니다. */
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
  if (order.order_source !== "manual") {
    return { ok: false, error: "엑셀로 등록된 주문은 수정할 수 없습니다." };
  }

  const name = String(formData.get("name") || "").trim();
  const rawPhone = String(formData.get("phone") || "").trim() || null;
  const rawAddress = String(formData.get("address") || "").trim() || null;
  if (!name) return { ok: false, error: "고객 이름을 입력해주세요." };
  if (!rawPhone && !rawAddress) return { ok: false, error: "전화번호 또는 주소 중 하나는 입력해주세요." };

  const productName = String(formData.get("productName") || "").trim();
  if (!productName) return { ok: false, error: "상품명을 입력해주세요." };

  const deliveryMemo = String(formData.get("deliveryMemo") || "").trim() || null;
  const orderDateRaw = String(formData.get("orderDate") || "").trim();
  const deliveryDateRaw = String(formData.get("deliveryDate") || "").trim();
  const status = String(formData.get("status") || "").trim() || "접수완료";
  const quantity = Math.max(1, Number(formData.get("quantity")) || 1);
  const unitPrice = Math.max(0, Number(formData.get("unitPrice")) || 0);

  const orderDate = orderDateRaw ? new Date(orderDateRaw).toISOString() : order.order_date;
  const deliveryDate = deliveryDateRaw ? new Date(deliveryDateRaw).toISOString() : null;
  const amount = quantity * unitPrice;

  try {
    await ordersRepository.update(orderId, {
      recipient_name: name,
      phone_snapshot: formatPhoneNumber(rawPhone),
      address_snapshot: cleanAddress(rawAddress),
      delivery_memo: deliveryMemo,
      order_date: orderDate,
      delivery_date: deliveryDate,
      status,
      total_amount: amount,
    });

    const [existingItem] = await ordersRepository.findItemsByOrderIds([orderId]);
    if (existingItem) {
      await ordersRepository.updateItem(existingItem.id, { product_name: productName, quantity, unit_price: unitPrice, amount });
    } else {
      await ordersRepository.createItems([{ order_id: orderId, product_name: productName, quantity, unit_price: unitPrice, amount }]);
    }

    revalidatePath("/orders");
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "주문 수정 중 오류가 발생했습니다." };
  }
}

export interface DeleteManualOrderState {
  ok: boolean;
  error: string | null;
}

/** 수동 등록 주문만 삭제 가능. 엑셀 임포트 주문은 업로드 이력 삭제(재처리) 경로로만 제거된다. */
export async function deleteManualOrderAction(orderId: string): Promise<DeleteManualOrderState> {
  const session = await requireSession();
  const order = await ordersRepository.findById(orderId);
  if (!order) return { ok: false, error: "주문을 찾을 수 없습니다." };
  if (session.role !== "admin" && order.owner_username !== session.username) {
    return { ok: false, error: "이 주문을 삭제할 권한이 없습니다." };
  }
  if (order.order_source !== "manual") {
    return { ok: false, error: "엑셀로 등록된 주문은 삭제할 수 없습니다." };
  }

  try {
    await ordersRepository.deleteOne(orderId);
    revalidatePath("/orders");
    revalidatePath("/customers");
    revalidatePath("/");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "주문 삭제 중 오류가 발생했습니다." };
  }
}
