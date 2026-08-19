"use server";

import { revalidatePath } from "next/cache";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { driverRegionsRepository } from "@/lib/repositories/driver-regions.repository";
import { accountsRepository } from "@/lib/repositories/accounts.repository";
import { createDriverWithAccount, updateDriver, DriverServiceError } from "@/lib/services/driver.service";
import { listAccounts } from "@/lib/auth/credentials";
import { toActionError } from "@/lib/utils/action-error";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import type { Driver, DriverRegion } from "@/types/domain";
import type { SessionPayload } from "@/lib/auth/session";

export interface DriverWithAccount extends Driver {
  username: string | null;
  /** Phase 1: 이 기사가 담당하는 지역 목록(계층형, 다중 가능). */
  regions: DriverRegion[];
}

/** admin은 전체 계정의 기사를 owner_username별로 모아 보고, 일반 계정은 자신이 등록한 기사만 본다. */
export async function listDriversAction(): Promise<DriverWithAccount[]> {
  const session = await requireSession();
  const scope = ownerScopeFor(session);
  const [drivers, accounts, regions] = await Promise.all([
    driversRepository.listAll(scope),
    listAccounts(),
    driverRegionsRepository.listByOwnerUsername(scope),
  ]);
  const usernameByDriverId = new Map(accounts.filter((a) => a.driverId).map((a) => [a.driverId, a.username]));
  const regionsByDriverId = new Map<string, DriverRegion[]>();
  for (const r of regions) {
    const list = regionsByDriverId.get(r.driver_id) ?? [];
    list.push(r);
    regionsByDriverId.set(r.driver_id, list);
  }
  return drivers.map((d) => ({
    ...d,
    username: usernameByDriverId.get(d.id) ?? null,
    regions: regionsByDriverId.get(d.id) ?? [],
  }));
}

export interface DriverActionState {
  ok: boolean;
  error: string | null;
}

export interface CreateDriverActionState extends DriverActionState {
  driverId?: string;
}

/** 이 기사를 다루는 세션이 소유자(admin 또는 본인 계정)인지 확인. */
export async function assertOwnsDriver(driverId: string, session: SessionPayload) {
  const driver = await driversRepository.findById(driverId);
  if (!driver) throw new DriverServiceError("기사를 찾을 수 없습니다.");
  if (session.role !== "admin" && driver.owner_username !== session.username) {
    throw new DriverServiceError("이 기사를 관리할 권한이 없습니다.");
  }
  return driver;
}

/**
 * P0(기사관리 3건) 2번: 등록 폼에서 onBlur 시 아이디 사용 가능 여부를
 * 미리 보여주기 위한 조회 전용 액션. createDriverWithAccount의 최종 제출
 * 시점 재검증(findByUsername) 로직은 그대로 두고, 같은 조회를 UX 힌트용으로
 * 한 번 더 호출할 뿐이다 — 중복 검증 로직 자체를 바꾸지 않는다.
 */
export async function checkDriverUsernameAvailableAction(username: string): Promise<{ available: boolean }> {
  const trimmed = username.trim();
  if (!trimmed) return { available: false };
  const existing = await accountsRepository.findByUsername(trimmed);
  return { available: !existing };
}

export async function createDriverAction(
  _prevState: DriverActionState,
  formData: FormData
): Promise<CreateDriverActionState> {
  try {
    const session = await requireSession();
    const name = String(formData.get("name") || "").trim();
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    if (!name) return { ok: false, error: "기사 이름을 입력해주세요." };
    if (!username) return { ok: false, error: "아이디를 입력해주세요." };
    if (password.length < 4) return { ok: false, error: "비밀번호는 4자 이상이어야 합니다." };

    const phone = String(formData.get("phone") || "").trim() || null;
    const address = String(formData.get("address") || "").trim() || null;
    const vehicleNumber = String(formData.get("vehicleNumber") || "").trim() || null;
    const ratePerDelivery = Math.max(0, Number(formData.get("ratePerDelivery")) || 0);

    // admin은 어느 계정 소속 기사인지 지정해야 하고, 일반 계정은 항상 자기 자신 소속으로 등록된다.
    let ownerUsername = session.username;
    if (session.role === "admin") {
      const selected = String(formData.get("ownerUsername") || "").trim();
      if (!selected) return { ok: false, error: "담당 계정을 선택해주세요." };
      ownerUsername = selected;
    }

    // P6 10번: 등록 팝업에서 담당지역을 함께 입력할 수 있도록 driverId를
    // 돌려준다 — 계정 생성까지 끝난 뒤에야 driver_regions가 참조할 실제
    // driver.id가 생기므로, 지역 저장은 이 id를 받은 클라이언트가 이어서
    // addDriverRegionAction을 호출하는 후속 단계로 처리한다.
    const driver = await createDriverWithAccount({ name, phone, address, vehicleNumber, ratePerDelivery, username, password, ownerUsername });
    revalidatePath("/settings");
    return { ok: true, error: null, driverId: driver.id };
  } catch (e) {
    return { ok: false, error: toActionError(e, "기사 등록 중 오류가 발생했습니다.") };
  }
}

/**
 * P5: 기사 정보(이름/연락처/주소/차량번호) 수정 — 로그인 아이디는 최초 생성 후
 * 변경 불가(폼에 필드 자체를 두지 않음, updateDriver는 그 필드를 받지도 않음).
 */
export async function updateDriverInfoAction(
  driverId: string,
  _prevState: DriverActionState,
  formData: FormData
): Promise<DriverActionState> {
  try {
    const session = await requireSession();
    await assertOwnsDriver(driverId, session);

    const name = String(formData.get("name") || "").trim();
    if (!name) return { ok: false, error: "기사 이름을 입력해주세요." };
    const phone = String(formData.get("phone") || "").trim() || null;
    const address = String(formData.get("address") || "").trim() || null;
    const vehicleNumber = String(formData.get("vehicleNumber") || "").trim() || null;

    await updateDriver(
      driverId,
      { name, phone, address, vehicle_number: vehicleNumber },
      session.role === "admin" ? undefined : session.username
    );
    revalidatePath("/settings");
    revalidatePath("/delivery");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "기사 정보 수정 중 오류가 발생했습니다.") };
  }
}

export async function updateDriverStatusAction(driverId: string, status: "active" | "inactive"): Promise<DriverActionState> {
  try {
    const session = await requireSession();
    await assertOwnsDriver(driverId, session);
    await updateDriver(driverId, { status }, session.role === "admin" ? undefined : session.username);
    revalidatePath("/settings");
    revalidatePath("/delivery");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "처리 중 오류가 발생했습니다.") };
  }
}

export async function updateDriverRateAction(driverId: string, ratePerDelivery: number): Promise<DriverActionState> {
  try {
    const session = await requireSession();
    await assertOwnsDriver(driverId, session);
    await updateDriver(
      driverId,
      { rate_per_delivery: Math.max(0, ratePerDelivery) },
      session.role === "admin" ? undefined : session.username
    );
    revalidatePath("/settings");
    revalidatePath("/settlements");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "처리 중 오류가 발생했습니다.") };
  }
}

/**
 * admin만 가능. 배정된 배송 이력이 있는 기사는 삭제 대신 비활성화를 사용해야
 * 하므로 거부한다.
 *
 * P11-2: 기사 삭제는 createDriverWithAccount가 만든 두 row(drivers,
 * app_accounts — 로그인 계정) 중 drivers만 지우고 app_accounts는 그대로
 * 남겨(app_accounts.driver_id는 FK가 자동으로 null 처리) 로그인 계정이
 * 고아로 남고 그 아이디를 영구히 재사용할 수 없는 문제가 있었다(P10-7-15
 * ISSUE-3). drivers를 먼저 지운 뒤 계정을 지운다 — 계정 삭제가 실패해도
 * 이전과 동일한(고아 계정) 상태로만 남을 뿐 새로운 손상은 없다.
 */
export async function deleteDriverAction(driverId: string): Promise<DriverActionState> {
  try {
    const session = await requireSession();
    if (session.role !== "admin") return { ok: false, error: "관리자만 삭제할 수 있습니다." };

    const assignedCount = await driversRepository.countAssignedOrders(driverId);
    if (assignedCount > 0) {
      return { ok: false, error: `배정된 배송 이력이 ${assignedCount}건 있어 삭제할 수 없습니다. 비활성화를 사용해주세요.` };
    }

    const account = await accountsRepository.findByDriverId(driverId);
    await driversRepository.delete(driverId, undefined);
    if (account) await accountsRepository.delete(account.username);
    revalidatePath("/settings");
    revalidatePath("/delivery");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "삭제 중 오류가 발생했습니다.") };
  }
}
