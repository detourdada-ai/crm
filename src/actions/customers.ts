"use server";

import { revalidatePath } from "next/cache";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { changeLogRepository } from "@/lib/repositories/change-log.repository";
import { updateCustomerProfile } from "@/lib/services/customer.service";
import type { Customer, CustomerChangeLog, CustomerStats, Order } from "@/types/domain";

export async function searchCustomersAction(query: string, page = 1) {
  return customersRepository.search({ query, page, pageSize: 20 });
}

export interface CustomerDetail {
  customer: Customer;
  stats: CustomerStats;
  orders: Order[];
  changeLogs: CustomerChangeLog[];
}

export async function getCustomerDetailAction(id: string): Promise<CustomerDetail | null> {
  const customer = await customersRepository.findById(id);
  if (!customer) return null;

  const [stats, orders, changeLogs] = await Promise.all([
    ordersRepository.aggregateStatsByCustomer(id),
    ordersRepository.findByCustomerId(id),
    changeLogRepository.listByCustomer(id),
  ]);

  return { customer, stats, orders, changeLogs };
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

  try {
    await updateCustomerProfile(customerId, { name, phone, address, memo, tags });
    revalidatePath(`/customers/${customerId}`);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "저장 중 오류가 발생했습니다." };
  }
}
