import "server-only";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { customerStatsRepository, type CustomerOrderStatsRow } from "@/lib/repositories/customer-stats.repository";
import { settingsRepository } from "@/lib/repositories/settings.repository";
import type { Customer } from "@/types/domain";

export interface VipCriteria {
  minTotalAmount: number;
  minOrderCount: number;
}

export const DEFAULT_VIP_CRITERIA: VipCriteria = {
  minTotalAmount: 500000,
  minOrderCount: 10,
};

const SETTINGS_KEY = "vip_criteria";

export async function getVipCriteria(): Promise<VipCriteria> {
  const value = await settingsRepository.get<VipCriteria>(SETTINGS_KEY);
  if (!value || typeof value.minTotalAmount !== "number" || typeof value.minOrderCount !== "number") {
    return DEFAULT_VIP_CRITERIA;
  }
  return value;
}

export async function setVipCriteria(criteria: VipCriteria): Promise<void> {
  await settingsRepository.set(SETTINGS_KEY, criteria);
}

export interface VipCustomer {
  customer: Customer;
  stats: CustomerOrderStatsRow;
}

export async function listVipCustomers(ownerUsername?: string): Promise<VipCustomer[]> {
  const criteria = await getVipCriteria();
  const statsRows = await customerStatsRepository.findVip(criteria.minTotalAmount, criteria.minOrderCount, ownerUsername);
  if (statsRows.length === 0) return [];

  const customers = await customersRepository.findByIds(statsRows.map((r) => r.customer_id));
  const byId = new Map(customers.map((c) => [c.id, c]));

  return statsRows
    .map((stats) => {
      const customer = byId.get(stats.customer_id);
      return customer ? { customer, stats } : null;
    })
    .filter((v): v is VipCustomer => v !== null);
}

export async function countVipCustomers(ownerUsername?: string): Promise<number> {
  const criteria = await getVipCriteria();
  return customerStatsRepository.countVip(criteria.minTotalAmount, criteria.minOrderCount, ownerUsername);
}
