"use server";

import { revalidatePath } from "next/cache";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { changeLogRepository } from "@/lib/repositories/change-log.repository";
import { updateCustomerProfile, setCustomerFavorite } from "@/lib/services/customer.service";
import { getCustomerTimeline, type TimelineEvent } from "@/lib/services/timeline.service";
import { getVipCriteria } from "@/lib/services/vip.service";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import type { Customer, CustomerChangeLog, CustomerStats, Order, CustomerStatus } from "@/types/domain";

export async function searchCustomersAction(query: string, page = 1) {
  const session = await requireSession();
  return customersRepository.search({ query, page, pageSize: 20, ownerUsername: ownerScopeFor(session) });
}

export interface CustomerDetail {
  customer: Customer;
  stats: CustomerStats;
  orders: Order[];
  changeLogs: CustomerChangeLog[];
  timeline: TimelineEvent[];
  isVip: boolean;
}

export async function getCustomerDetailAction(id: string): Promise<CustomerDetail | null> {
  const session = await requireSession();
  const customer = await customersRepository.findById(id);
  if (!customer) return null;
  if (session.role !== "admin" && customer.owner_username !== session.username) return null;

  const [stats, orders, changeLogs, timeline, vipCriteria] = await Promise.all([
    ordersRepository.aggregateStatsByCustomer(id),
    ordersRepository.findByCustomerId(id),
    changeLogRepository.listByCustomer(id),
    getCustomerTimeline(id),
    getVipCriteria(),
  ]);

  const isVip = stats.totalAmount >= vipCriteria.minTotalAmount && stats.totalOrders >= vipCriteria.minOrderCount;

  return { customer, stats, orders, changeLogs, timeline, isVip };
}

export async function toggleCustomerFavoriteAction(id: string): Promise<{ isFavorite: boolean }> {
  const session = await requireSession();
  const existing = await customersRepository.findById(id);
  if (!existing) throw new Error("고객을 찾을 수 없습니다.");
  if (session.role !== "admin" && existing.owner_username !== session.username) {
    throw new Error("이 고객을 수정할 권한이 없습니다.");
  }

  const updated = await setCustomerFavorite(id, !existing.is_favorite);
  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  return { isFavorite: updated.is_favorite };
}

export interface UpdateCustomerActionState {
  ok: boolean;
  error: string | null;
}

export async function updateCustomerAction(
  customerId: string,
  _prevState: UpdateCustomerActionState,
  formData: FormData
): Promise<UpdateCustomerActionState> {
  const session = await requireSession();
  const existing = await customersRepository.findById(customerId);
  if (!existing) return { ok: false, error: "고객을 찾을 수 없습니다." };
  if (session.role !== "admin" && existing.owner_username !== session.username) {
    return { ok: false, error: "이 고객을 수정할 권한이 없습니다." };
  }

  const name = String(formData.get("name") || "").trim();
  if (!name) return { ok: false, error: "이름을 입력해주세요." };

  const phone = String(formData.get("phone") || "").trim() || null;
  const address = String(formData.get("address") || "").trim() || null;
  const memo = String(formData.get("memo") || "").trim() || null;
  const tagsRaw = String(formData.get("tags") || "").trim();
  const tags = tagsRaw
    ? tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const status = (String(formData.get("status") || "active") as CustomerStatus);

  try {
    await updateCustomerProfile(customerId, { name, phone, address, memo, tags, status }, session.username);
    revalidatePath(`/customers/${customerId}`);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "저장 중 오류가 발생했습니다." };
  }
}
