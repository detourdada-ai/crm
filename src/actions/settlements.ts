"use server";

import { revalidatePath } from "next/cache";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { orderShipmentsRepository } from "@/lib/repositories/order-shipments.repository";
import { settlementsRepository } from "@/lib/repositories/settlements.repository";
import { resolvePeriodRange, type PeriodRange, type SettlementPeriodType } from "@/lib/services/settlement.service";
import { toActionError } from "@/lib/utils/action-error";
import { requireSession, requireDriverSession } from "@/lib/auth/current-session";
import { kstDayStartIso, kstDayEndIso, kstDayDateStrOf } from "@/lib/utils/kst-date";
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

/**
 * CPO 지시(2026-08, 정산 집계 불일치 수정): 실제 배송 7건(기사1: 4건, 기사2: 3건)에
 * 대해 정산관리는 "정산대기 1건, 배송건수 1"만 보여주는 버그가 있었다 — 원인은
 * "이 (기사,기간) 조합이 한 번이라도 계산된 적 있으면 orders(레거시) 테이블
 * 기준으로 재계산한다"는 예전 로직(소급 변경 방지 목적)이었는데, orders의
 * delivery_status/completed_at은 배송건(order_shipments) 완료 시 함께
 * 갱신되지 않아 실제보다 훨씬 낮게 카운트됐다.
 *
 * 이제 "소급 변경 방지"는 행의 존재 여부가 아니라 실제 지급 여부
 * (status==='paid')로 판단한다 — 지급 완료된 정산만 그 시점 금액/건수로
 * 고정하고(markPaid 이후 다시 손대지 않음), 그 전까지는 항상
 * order_shipments 기준으로 라이브 재계산한다(§정산일/금액 관리와 짝).
 */
async function resolveSettlement(driver: Driver, start: string, end: string, periodStartIso: string, periodEndIso: string): Promise<Settlement> {
  const existing = await settlementsRepository.findByDriverAndPeriod(driver.id, start, end);
  if (existing?.status === "paid") return existing;

  const deliveryCount = await orderShipmentsRepository.countCompletedByDriverInPeriod(driver.id, periodStartIso, periodEndIso);
  const amount = deliveryCount * driver.rate_per_delivery;
  return settlementsRepository.upsertStats({
    driver_id: driver.id,
    period_start: start,
    period_end: end,
    delivery_count: deliveryCount,
    amount,
  });
}

async function computeSettlementRows(
  periodType: SettlementPeriodType,
  referenceDate: string,
  ownerUsername?: string,
  driverFilter?: string,
  customRange?: PeriodRange
): Promise<SettlementBoardResult> {
  const { start, end } = resolvePeriodRange(periodType, referenceDate, customRange);
  const periodStartIso = kstDayStartIso(start);
  const periodEndIso = kstDayEndIso(end);

  const allDrivers = await driversRepository.listAll(ownerUsername);
  const drivers = driverFilter ? allDrivers.filter((d) => d.id === driverFilter) : allDrivers;
  const rows: SettlementRow[] = [];
  for (const driver of drivers) {
    const settlement = await resolveSettlement(driver, start, end, periodStartIso, periodEndIso);
    rows.push({ driver, settlement });
  }

  return { periodStart: start, periodEnd: end, rows };
}

/**
 * 계정별 정산 보드. 일반 계정(user1~5)은 항상 자신의 기사만 보고,
 * admin은 ownerFilter로 특정 계정만 골라볼 수 있으며 생략하면 전체를 본다.
 * CPO 지시(2026-08): 기사 필터(driverFilter)와 "배송일 기준" 임의 구간
 * 조회(customRange, periodType='custom')를 추가했다.
 */
export async function getSettlementBoardAction(
  periodType: SettlementPeriodType,
  referenceDate: string,
  ownerFilter?: string,
  driverFilter?: string,
  customRange?: PeriodRange
): Promise<SettlementBoardResult> {
  const session = await requireSession();
  const ownerUsername = session.role === "admin" ? ownerFilter || undefined : session.username;
  return computeSettlementRows(periodType, referenceDate, ownerUsername, driverFilter, customRange);
}

export interface SettlementDriverOption {
  id: string;
  name: string;
}

/**
 * 정산 화면의 "기사 필터" select 옵션 전용 — STD-6과 동일한 "자기 자신 제외"
 * 원칙: 기사 필터 자체와 무관하게 항상 전체 기사 목록을 반환해야
 * driverFilter를 하나 고른 뒤에도 select 옵션이 1개로 붕괴되지 않는다
 * (getSettlementBoardAction의 rows를 재사용하면 이미 필터링된 결과라 안 된다).
 */
export async function listSettlementDriverOptionsAction(ownerFilter?: string): Promise<SettlementDriverOption[]> {
  const session = await requireSession();
  const ownerUsername = session.role === "admin" ? ownerFilter || undefined : session.username;
  const drivers = await driversRepository.listAll(ownerUsername);
  return drivers.map((d) => ({ id: d.id, name: d.name }));
}

export interface SettlementDailyHistoryEntry {
  date: string; // KST calendar day, "YYYY-MM-DD"
  deliveryCount: number;
  amount: number;
}

/**
 * 정산 일별 이력(CPO 지시, 2026-08) — 선택한 기간 내 이 기사가 완료한
 * 배송건을 날짜별로 묶어 보여준다. 지급완료 여부와 무관하게 항상
 * order_shipments를 라이브로 다시 세는 참고용 조회다(장부 자체는
 * settlement.amount/delivery_count가 기준).
 */
export async function getSettlementDailyHistoryAction(
  driverId: string,
  periodStart: string,
  periodEnd: string
): Promise<SettlementDailyHistoryEntry[]> {
  const session = await requireSession();
  const driver = await driversRepository.findById(driverId);
  if (!driver) throw new Error("기사를 찾을 수 없습니다.");
  if (session.role !== "admin" && driver.owner_username !== session.username) {
    throw new Error("이 기사의 정산 이력을 조회할 권한이 없습니다.");
  }

  const periodStartIso = kstDayStartIso(periodStart);
  const periodEndIso = kstDayEndIso(periodEnd);
  const completedAts = await orderShipmentsRepository.listCompletedAtByDriverInPeriod(driverId, periodStartIso, periodEndIso);

  const countByDate = new Map<string, number>();
  for (const iso of completedAts) {
    const date = kstDayDateStrOf(iso);
    countByDate.set(date, (countByDate.get(date) ?? 0) + 1);
  }

  return Array.from(countByDate.entries())
    .map(([date, deliveryCount]) => ({ date, deliveryCount, amount: deliveryCount * driver.rate_per_delivery }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface SettlementActionState {
  ok: boolean;
  error: string | null;
}

/**
 * 실제 지급 처리(CPO 지시, 2026-08) — 관리자가 정산일과 금액을 직접
 * 입력해 확정한다. 확정 후에는 배송 데이터가 바뀌어도 이 값이 조용히
 * 재계산되지 않는다(resolveSettlement의 status==='paid' 분기).
 */
export async function markSettlementPaidAction(settlementId: string, paidAt: string, amount: number): Promise<SettlementActionState> {
  try {
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "금액을 올바르게 입력해주세요." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) return { ok: false, error: "정산일을 올바르게 입력해주세요." };

    const session = await requireSession();
    const settlement = await settlementsRepository.findById(settlementId);
    if (!settlement) return { ok: false, error: "정산 건을 찾을 수 없습니다." };

    const driver = await driversRepository.findById(settlement.driver_id);
    if (!driver) return { ok: false, error: "정산 대상 기사를 찾을 수 없습니다." };
    if (session.role !== "admin" && driver.owner_username !== session.username) {
      return { ok: false, error: "이 정산 건을 처리할 권한이 없습니다." };
    }

    await settlementsRepository.markPaid(
      settlementId,
      { paidAt: kstDayStartIso(paidAt), amount },
      session.role === "admin" ? undefined : session.username
    );
    revalidatePath("/settlements");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "처리 중 오류가 발생했습니다.") };
  }
}

/** 지급완료 취소 — 되돌리면 다음 조회부터 다시 배송건 기준으로 라이브 재계산된다. */
export async function unmarkSettlementPaidAction(settlementId: string): Promise<SettlementActionState> {
  try {
    const session = await requireSession();
    const settlement = await settlementsRepository.findById(settlementId);
    if (!settlement) return { ok: false, error: "정산 건을 찾을 수 없습니다." };

    const driver = await driversRepository.findById(settlement.driver_id);
    if (!driver) return { ok: false, error: "정산 대상 기사를 찾을 수 없습니다." };
    if (session.role !== "admin" && driver.owner_username !== session.username) {
      return { ok: false, error: "이 정산 건을 처리할 권한이 없습니다." };
    }

    await settlementsRepository.updateStatus(settlementId, "unpaid", session.role === "admin" ? undefined : session.username);
    revalidatePath("/settlements");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "처리 중 오류가 발생했습니다.") };
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
  const periodStartIso = kstDayStartIso(start);
  const periodEndIso = kstDayEndIso(end);
  const settlement = await resolveSettlement(driver, start, end, periodStartIso, periodEndIso);

  return { periodStart: start, periodEnd: end, driver, settlement };
}
