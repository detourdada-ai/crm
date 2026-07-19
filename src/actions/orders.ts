"use server";

import { revalidatePath } from "next/cache";
import { ordersRepository, type OrderSortField } from "@/lib/repositories/orders.repository";
import { resolveCustomerForImportRow } from "@/lib/services/customer.service";
import { formatPhoneNumber } from "@/lib/utils/phone";
import { cleanAddress } from "@/lib/utils/address";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import type { Order, OrderItem } from "@/types/domain";

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
  status?: string;
  bagReturned?: boolean;
  deliveryDateFrom?: string;
  deliveryDateTo?: string;
  sortBy?: OrderSortField;
  sortAscending?: boolean;
}

export interface SearchOrdersResult {
  orders: Order[];
  total: number;
  itemSummaries: Record<string, OrderItemSummary>;
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

  return { orders, total, itemSummaries };
}

export interface OrderDetail {
  order: Order;
  items: OrderItem[];
}

export async function getOrderDetailAction(id: string): Promise<OrderDetail | null> {
  const session = await requireSession();
  const order = await ordersRepository.findById(id);
  if (!order) return null;
  if (session.role !== "admin" && order.owner_username !== session.username) return null;

  const items = await ordersRepository.findItemsByOrderIds([id]);
  return { order, items };
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

export interface BulkMarkReturnedResult {
  ok: boolean;
  updated: number;
  error: string | null;
}

/** "이전 미회수 건 일괄 회수 처리": marks every not-yet-returned bag as returned for deliveries strictly before today. */
export async function bulkMarkBagsReturnedAction(): Promise<BulkMarkReturnedResult> {
  const session = await requireSession();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const updated = await ordersRepository.markBagsReturnedBefore(startOfToday.toISOString(), ownerScopeFor(session));
  revalidatePath("/orders");
  return { ok: true, updated, error: null };
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

    const orderNumber = `MANUAL-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const [order] = await ordersRepository.createMany([
      {
        customer_id: customer.id,
        order_number: orderNumber,
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
