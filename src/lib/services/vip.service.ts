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

// 계정별로 VIP 기준을 따로 관리한다(user1~5 각자 자기 고객 규모에 맞는 기준을
// 직접 설정). ownerUsername이 없으면(admin의 전체 합산 뷰) 아무도 쓰지 않는
// 전역 키로 폴백해 사실상 항상 DEFAULT_VIP_CRITERIA를 사용하게 된다 —
// admin은 더 이상 이 값을 직접 설정하지 않는다.
const GLOBAL_SETTINGS_KEY = "vip_criteria";

function settingsKeyFor(ownerUsername?: string): string {
  return ownerUsername ? `vip_criteria:${ownerUsername}` : GLOBAL_SETTINGS_KEY;
}

export async function getVipCriteria(ownerUsername?: string): Promise<VipCriteria> {
  const value = await settingsRepository.get<VipCriteria>(settingsKeyFor(ownerUsername));
  if (!value || typeof value.minTotalAmount !== "number" || typeof value.minOrderCount !== "number") {
    return DEFAULT_VIP_CRITERIA;
  }
  return value;
}

export async function setVipCriteria(criteria: VipCriteria, ownerUsername?: string): Promise<void> {
  await settingsRepository.set(settingsKeyFor(ownerUsername), criteria);
}

export interface VipCustomer {
  customer: Customer;
  stats: CustomerOrderStatsRow;
}

export async function listVipCustomers(ownerUsername?: string): Promise<VipCustomer[]> {
  const criteria = await getVipCriteria(ownerUsername);
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
  const criteria = await getVipCriteria(ownerUsername);
  return customerStatsRepository.countVip(criteria.minTotalAmount, criteria.minOrderCount, ownerUsername);
}
