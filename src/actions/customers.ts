"use server";

import { revalidatePath } from "next/cache";
import { customersRepository, type CustomerSortField } from "@/lib/repositories/customers.repository";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { changeLogRepository } from "@/lib/repositories/change-log.repository";
import { updateCustomerProfile, setCustomerFavorite, resolveCustomerForImportRow } from "@/lib/services/customer.service";
import { getCustomerTimeline, type TimelineEvent } from "@/lib/services/timeline.service";
import { getVipCriteria } from "@/lib/services/vip.service";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import type { Customer, CustomerChangeLog, CustomerStats, Order, CustomerStatus } from "@/types/domain";

export async function searchCustomersAction(
  query: string,
  page = 1,
  sortBy?: CustomerSortField,
  sortAscending?: boolean
) {
  const session = await requireSession();
  return customersRepository.search({
    query,
    page,
    pageSize: 20,
    ownerUsername: ownerScopeFor(session),
    sortBy,
    sortAscending,
  });
}

export interface CustomerDetail {
  customer: Customer;
  stats: CustomerStats;
  orders: Order[];
  changeLogs: CustomerChangeLog[];
  timeline: TimelineEvent[];
  isVip: boolean;
  mergedIntoCustomer: Customer | null;
}

export async function getCustomerDetailAction(id: string): Promise<CustomerDetail | null> {
  const session = await requireSession();
  const customer = await customersRepository.findById(id);
  if (!customer) return null;
  if (session.role !== "admin" && customer.owner_username !== session.username) return null;

  const [stats, orders, changeLogs, timeline, vipCriteria, mergedIntoCustomer] = await Promise.all([
    ordersRepository.aggregateStatsByCustomer(id),
    ordersRepository.findByCustomerId(id),
    changeLogRepository.listByCustomer(id),
    getCustomerTimeline(id),
    getVipCriteria(customer.owner_username),
    customer.merged_into_id ? customersRepository.findById(customer.merged_into_id) : Promise.resolve(null),
  ]);

  const isVip = stats.totalAmount >= vipCriteria.minTotalAmount && stats.totalOrders >= vipCriteria.minOrderCount;

  return { customer, stats, orders, changeLogs, timeline, isVip, mergedIntoCustomer };
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

export interface CreateCustomerActionState {
  ok: boolean;
  error: string | null;
  customerId?: string;
  isNew?: boolean;
}

/**
 * Phase 2 P1: 주문 없이 고객만 먼저 등록한다 ("+ 고객 등록"). 중복 판단은
 * 엑셀 임포트/수동 주문과 완전히 동일한 resolveCustomerForImportRow를
 * 그대로 재사용한다 — 새 중복 로직을 만들지 않는다. 이름+전화번호+주소가
 * 기존 고객과 정확히 일치하면 새로 만들지 않고 기존 고객을 반환한다.
 */
export async function createCustomerAction(
  _prevState: CreateCustomerActionState,
  formData: FormData
): Promise<CreateCustomerActionState> {
  const session = await requireSession();

  const name = String(formData.get("name") || "").trim();
  const rawPhone = String(formData.get("phone") || "").trim() || null;
  const rawAddress = String(formData.get("address") || "").trim() || null;
  const memo = String(formData.get("memo") || "").trim() || null;
  if (!name) return { ok: false, error: "고객 이름을 입력해주세요." };
  if (!rawPhone && !rawAddress) return { ok: false, error: "전화번호 또는 주소 중 하나는 입력해주세요." };

  try {
    const { customer, isNew } = await resolveCustomerForImportRow({
      name,
      rawPhone,
      rawAddress,
      ownerUsername: session.username,
    });
    if (isNew && memo) {
      await customersRepository.update(customer.id, { memo });
    }
    revalidatePath("/customers");
    return { ok: true, error: null, customerId: customer.id, isNew };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "고객 등록 중 오류가 발생했습니다." };
  }
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
  const bagNo = String(formData.get("bagNo") || "").trim() || null;

  try {
    await updateCustomerProfile(customerId, { name, phone, address, memo, tags, status, bagNo }, session.username);
    revalidatePath(`/customers/${customerId}`);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "저장 중 오류가 발생했습니다." };
  }
}
