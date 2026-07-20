import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Order, OrderItem, OrderSource, DeliveryStatus } from "@/types/domain";

export interface OrderInsert {
  customer_id: string;
  order_number?: string | null;
  order_date: string;
  status?: string;
  total_amount: number;
  recipient_name: string;
  phone_snapshot?: string | null;
  address_snapshot?: string | null;
  zipcode?: string | null;
  delivery_memo?: string | null;
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
  driver_id?: string | null;
  completed_at?: string | null;
  import_id?: string | null;
  owner_username: string;
}

export interface OrderUpdate {
  bag_number?: string | null;
  bag_returned?: boolean;
  delivery_date?: string | null;
  delivery_status?: DeliveryStatus;
  driver_id?: string | null;
  completed_at?: string | null;
}

export type OrderSortField =
  | "order_number"
  | "order_date"
  | "delivery_date"
  | "recipient_name"
  | "phone_snapshot"
  | "total_amount"
  | "delivery_status"
  | "driver_id";

export interface OrderSearchParams {
  page?: number;
  pageSize?: number;
  ownerUsername?: string;
  deliveryStatus?: DeliveryStatus;
  bagReturned?: boolean;
  orderDateFrom?: string;
  orderDateTo?: string;
  deliveryDate?: string;
  sortBy?: OrderSortField;
  sortAscending?: boolean;
}

export interface OrderItemInsert {
  order_id: string;
  product_order_number?: string | null;
  product_code?: string | null;
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

  async findByOrderNumber(orderNumber: string): Promise<Order | null> {
    const { data, error } = await getSupabaseAdmin()
      .from("orders")
      .select("*")
      .eq("order_number", orderNumber)
      .maybeSingle();
    if (error) throw error;
    return data as Order | null;
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
    orderDateFrom,
    orderDateTo,
    deliveryDate,
    sortBy = "delivery_date",
    sortAscending = false,
  }: OrderSearchParams) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let q = getSupabaseAdmin().from("orders").select("*", { count: "exact" });
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    if (deliveryStatus) q = q.eq("delivery_status", deliveryStatus);
    if (bagReturned !== undefined) q = q.eq("bag_returned", bagReturned);
    if (orderDateFrom) q = q.gte("order_date", orderDateFrom);
    if (orderDateTo) q = q.lte("order_date", orderDateTo);
    if (deliveryDate) {
      const start = new Date(deliveryDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(deliveryDate);
      end.setHours(23, 59, 59, 999);
      q = q.gte("delivery_date", start.toISOString()).lte("delivery_date", end.toISOString());
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

  /** All orders whose delivery_date falls on the given calendar day — the 배송관리 board is scoped to one day at a time. */
  async findByDeliveryDate(dateIso: string, ownerUsername?: string): Promise<Order[]> {
    const start = new Date(dateIso);
    start.setHours(0, 0, 0, 0);
    const end = new Date(dateIso);
    end.setHours(23, 59, 59, 999);

    let q = getSupabaseAdmin()
      .from("orders")
      .select("*")
      .gte("delivery_date", start.toISOString())
      .lte("delivery_date", end.toISOString());
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("created_at", { ascending: true });
    if (error) throw error;
    return (data as Order[]) ?? [];
  },

  /** Assigns a driver to the given orders and moves them into 배송중. */
  async assignDriver(orderIds: string[], driverId: string): Promise<void> {
    if (orderIds.length === 0) return;
    const { error } = await getSupabaseAdmin()
      .from("orders")
      .update({ driver_id: driverId, delivery_status: "배송중" })
      .in("id", orderIds);
    if (error) throw error;
  },

  /** A driver's own orders — either their currently in-progress deliveries or (with includeCompleted) their full history, for the driver-only delivery view. */
  async findByDriverId(driverId: string, deliveryStatus?: DeliveryStatus): Promise<Order[]> {
    let q = getSupabaseAdmin().from("orders").select("*").eq("driver_id", driverId);
    if (deliveryStatus) q = q.eq("delivery_status", deliveryStatus);
    const { data, error } = await q.order("delivery_date", { ascending: true });
    if (error) throw error;
    return (data as Order[]) ?? [];
  },

  async markDelivered(orderId: string): Promise<Order> {
    const { data, error } = await getSupabaseAdmin()
      .from("orders")
      .update({ delivery_status: "완료", completed_at: new Date().toISOString() })
      .eq("id", orderId)
      .select("*")
      .single();
    if (error) throw error;
    return data as Order;
  },

  async deleteMany(orderIds: string[]): Promise<void> {
    if (orderIds.length === 0) return;
    const { error } = await getSupabaseAdmin().from("orders").delete().in("id", orderIds);
    if (error) throw error;
  },

  async update(id: string, input: OrderUpdate): Promise<Order> {
    const { data, error } = await getSupabaseAdmin().from("orders").update(input).eq("id", id).select("*").single();
    if (error) throw error;
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

  async markManyBagsReturned(orderIds: string[]): Promise<void> {
    if (orderIds.length === 0) return;
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

  async count(ownerUsername?: string): Promise<number> {
    let q = getSupabaseAdmin().from("orders").select("*", { count: "exact", head: true });
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  },

  /** Just customer_id for orders since a date — used for the new-vs-repeat breakdown (lighter than fetching full rows). */
  async findCustomerIdsSince(sinceIso: string, ownerUsername?: string): Promise<string[]> {
    let q = getSupabaseAdmin().from("orders").select("customer_id").gte("order_date", sinceIso);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => r.customer_id as string);
  },

  async aggregateStatsByCustomer(customerId: string) {
    const { data, error } = await getSupabaseAdmin()
      .from("orders")
      .select("total_amount, order_date")
      .eq("customer_id", customerId)
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
