"use server";

import { revalidatePath } from "next/cache";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { settlementsRepository } from "@/lib/repositories/settlements.repository";
import { resolvePeriodRange, type SettlementPeriodType } from "@/lib/services/settlement.service";
import { requireSession, requireDriverSession } from "@/lib/auth/current-session";
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

async function computeSettlementRows(
  periodType: SettlementPeriodType,
  referenceDate: string,
  ownerUsername?: string
): Promise<SettlementBoardResult> {
  const { start, end } = resolvePeriodRange(periodType, referenceDate);
  const periodStartIso = new Date(`${start}T00:00:00`).toISOString();
  const periodEndIso = new Date(`${end}T23:59:59.999`).toISOString();

  const drivers = await driversRepository.listAll(ownerUsername);
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

/**
 * 계정별 정산 보드. 일반 계정(user1~5)은 항상 자신의 기사만 보고,
 * admin은 ownerFilter로 특정 계정만 골라볼 수 있으며 생략하면 전체를 본다.
 */
export async function getSettlementBoardAction(
  periodType: SettlementPeriodType,
  referenceDate: string,
  ownerFilter?: string
): Promise<SettlementBoardResult> {
  const session = await requireSession();
  const ownerUsername = session.role === "admin" ? ownerFilter || undefined : session.username;
  return computeSettlementRows(periodType, referenceDate, ownerUsername);
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
    const session = await requireSession();
    const settlement = await settlementsRepository.findById(settlementId);
    if (!settlement) return { ok: false, error: "정산 건을 찾을 수 없습니다." };

    const driver = await driversRepository.findById(settlement.driver_id);
    if (!driver) return { ok: false, error: "정산 대상 기사를 찾을 수 없습니다." };
    if (session.role !== "admin" && driver.owner_username !== session.username) {
      return { ok: false, error: "이 정산 건을 처리할 권한이 없습니다." };
    }

    await settlementsRepository.updateStatus(settlementId, status);
    revalidatePath("/settlements");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." };
  }
}

/** 기사 본인 계정 전용 — 자기 배송 건수/받을 금액만 읽기 전용으로 확인. */
export async function getMySettlementAction(
  periodType: SettlementPeriodType,
  referenceDate: string
): Promise<{ periodStart: string; periodEnd: string; driver: Driver; settlement: Settlement } | null> {
  const { driverId } = await requireDriverSession();
  const driver = await driversRepository.findById(driverId);
  if (!driver) return null;

  const { start, end } = resolvePeriodRange(periodType, referenceDate);
  const periodStartIso = new Date(`${start}T00:00:00`).toISOString();
  const periodEndIso = new Date(`${end}T23:59:59.999`).toISOString();
  const deliveryCount = await ordersRepository.countCompletedByDriverInPeriod(driverId, periodStartIso, periodEndIso);
  const amount = deliveryCount * driver.rate_per_delivery;
  const settlement = await settlementsRepository.upsertStats({
    driver_id: driverId,
    period_start: start,
    period_end: end,
    delivery_count: deliveryCount,
    amount,
  });

  return { periodStart: start, periodEnd: end, driver, settlement };
}
