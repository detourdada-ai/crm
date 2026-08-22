"use server";

import { revalidatePath } from "next/cache";
import { driverShiftsRepository } from "@/lib/repositories/driver-shifts.repository";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { toActionError } from "@/lib/utils/action-error";
import { ownerScopeFor, requireDriverSession, requireSession } from "@/lib/auth/current-session";
import { kstTodayIso } from "@/lib/utils/kst-date";
import { assertOwnsDriver } from "@/actions/drivers";
import type { Driver, DriverShift } from "@/types/domain";

export interface DriverShiftActionState {
  ok: boolean;
  error: string | null;
}

/**
 * S2-C: 기사 앱 진입 시 오늘 운행 상태(운행시작/종료 여부, 최근 위치)를
 * 조회한다. 배송 상태와 무관 — 이 레코드가 없어도(=아직 운행시작을 누르지
 * 않았어도) 배송건은 이미 정상적으로 배송중이며 완료 처리도 가능하다.
 */
export async function getMyShiftAction(): Promise<DriverShift | null> {
  const { driverId } = await requireDriverSession();
  return driverShiftsRepository.findByDriverAndDate(driverId, kstTodayIso());
}

/** 운행시작 — "오늘 배송 업무를 실제로 시작했다"는 운영 기록일 뿐, 배송 상태는 바꾸지 않는다. */
export async function startShiftAction(): Promise<DriverShiftActionState> {
  try {
    const { driverId } = await requireDriverSession();
    await driverShiftsRepository.startShift(driverId, kstTodayIso());
    revalidatePath("/driver");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "운행시작 처리 중 오류가 발생했습니다.") };
  }
}

/** 운행종료 — 모든 배송을 마친 뒤 기사가 직접 확인하고 누른다. */
export async function endShiftAction(): Promise<DriverShiftActionState> {
  try {
    const { driverId } = await requireDriverSession();
    await driverShiftsRepository.endShift(driverId, kstTodayIso());
    revalidatePath("/driver");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "운행종료 처리 중 오류가 발생했습니다.") };
  }
}

/**
 * S2-C: 운행 중 참고용 위치 갱신 — 사장님의 CS 대응("기사님 지금 어디예요?")을
 * 돕기 위한 최근 위치 하나만 남긴다. 배송 상태를 절대 바꾸지 않는다. 과도한
 * 추적을 피하기 위해 클라이언트에서 운행시작 시 1회 + 짧은 주기로만 호출한다
 * (백그라운드 추적 없음 — 앱이 열려있을 때만).
 */
export async function updateMyLocationAction(latitude: number, longitude: number): Promise<DriverShiftActionState> {
  try {
    const { driverId } = await requireDriverSession();
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { ok: false, error: "위치 정보가 올바르지 않습니다." };
    }
    await driverShiftsRepository.updateLocation(driverId, kstTodayIso(), latitude, longitude);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "위치 갱신 중 오류가 발생했습니다.") };
  }
}

/** 기사관리 설정 화면: 이 기사의 가장 최근 위치를 참고용으로 조회(Seller 세션 — 본인 소유 기사만). */
export async function getDriverLatestLocationAction(driverId: string): Promise<DriverShift | null> {
  const session = await requireSession();
  await assertOwnsDriver(driverId, session);
  return driverShiftsRepository.findLatestLocation(driverId);
}

export interface DriverLocation {
  driver: Driver;
  shift: DriverShift | null;
}

/**
 * Sprint4: 사장님 "전체 기사 위치" 지도 — 오늘 활동 중인(운행중이거나 오늘
 * 위치를 남긴) 기사 전원의 최근 위치를 한 번에 조회한다. 배송 상태와 무관한
 * 참고용 정보다(위 getDriverLatestLocationAction과 동일 원칙, 다건 버전).
 */
export async function listDriverLocationsAction(): Promise<DriverLocation[]> {
  const session = await requireSession();
  const scope = ownerScopeFor(session);
  const drivers = await driversRepository.listActive(scope);
  const shifts = await driverShiftsRepository.findTodayByDriverIds(
    drivers.map((d) => d.id),
    kstTodayIso()
  );
  const shiftByDriverId = new Map(shifts.map((s) => [s.driver_id, s]));
  return drivers.map((driver) => ({ driver, shift: shiftByDriverId.get(driver.id) ?? null }));
}
