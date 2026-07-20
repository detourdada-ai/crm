"use server";

import { revalidatePath } from "next/cache";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { settlementsRepository } from "@/lib/repositories/settlements.repository";
import { resolvePeriodRange, type SettlementPeriodType } from "@/lib/services/settlement.service";
import { requireSession } from "@/lib/auth/current-session";
import type { Driver, Settlement } from "@/types/domain";

export interface SettlementRow {
  driver: Driver;
  settlement: Settlement;
}

export interface SettlementBoardResult {
  periodStart: string;
  periodEnd: string;
  rows: SettlementRow[];
}

async function requireAdmin() {
  const session = await requireSession();
  if (session.role !== "admin") throw new Error("관리자만 접근할 수 있습니다.");
  return session;
}

/** Computes (and persists) each active driver's delivery count/amount for the given period, preserving any already-recorded paid/unpaid status. */
export async function getSettlementBoardAction(
  periodType: SettlementPeriodType,
  referenceDate: string
): Promise<SettlementBoardResult> {
  await requireAdmin();
  const { start, end } = resolvePeriodRange(periodType, referenceDate);
  const periodStartIso = new Date(`${start}T00:00:00`).toISOString();
  const periodEndIso = new Date(`${end}T23:59:59.999`).toISOString();

  const drivers = await driversRepository.listAll();
  const rows: SettlementRow[] = [];
  for (const driver of drivers) {
    const deliveryCount = await ordersRepository.countCompletedByDriverInPeriod(driver.id, periodStartIso, periodEndIso);
    const amount = deliveryCount * driver.rate_per_delivery;
    const settlement = await settlementsRepository.upsertStats({
      driver_id: driver.id,
      period_start: start,
      period_end: end,
      delivery_count: deliveryCount,
      amount,
    });
    rows.push({ driver, settlement });
  }

  return { periodStart: start, periodEnd: end, rows };
}

export interface SettlementActionState {
  ok: boolean;
  error: string | null;
}

export async function markSettlementStatusAction(
  settlementId: string,
  status: "paid" | "unpaid"
): Promise<SettlementActionState> {
  try {
    await requireAdmin();
    await settlementsRepository.updateStatus(settlementId, status);
    revalidatePath("/settlements");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." };
  }
}
