"use server";

import { revalidatePath } from "next/cache";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { createDriverWithAccount, updateDriver, DriverServiceError } from "@/lib/services/driver.service";
import { listAccounts } from "@/lib/auth/credentials";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import type { Driver } from "@/types/domain";
import type { SessionPayload } from "@/lib/auth/session";

export interface DriverWithAccount extends Driver {
  username: string | null;
}

/** admin은 전체 계정의 기사를 owner_username별로 모아 보고, 일반 계정은 자신이 등록한 기사만 본다. */
export async function listDriversAction(): Promise<DriverWithAccount[]> {
  const session = await requireSession();
  const [drivers, accounts] = await Promise.all([driversRepository.listAll(ownerScopeFor(session)), listAccounts()]);
  const usernameByDriverId = new Map(accounts.filter((a) => a.driverId).map((a) => [a.driverId, a.username]));
  return drivers.map((d) => ({ ...d, username: usernameByDriverId.get(d.id) ?? null }));
}

export interface DriverActionState {
  ok: boolean;
  error: string | null;
}

/** 이 기사를 다루는 세션이 소유자(admin 또는 본인 계정)인지 확인. */
async function assertOwnsDriver(driverId: string, session: SessionPayload) {
  const driver = await driversRepository.findById(driverId);
  if (!driver) throw new DriverServiceError("기사를 찾을 수 없습니다.");
  if (session.role !== "admin" && driver.owner_username !== session.username) {
    throw new DriverServiceError("이 기사를 관리할 권한이 없습니다.");
  }
  return driver;
}

export async function createDriverAction(
  _prevState: DriverActionState,
  formData: FormData
): Promise<DriverActionState> {
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

    await createDriverWithAccount({ name, phone, address, vehicleNumber, ratePerDelivery, username, password, ownerUsername });
    revalidatePath("/settings");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "기사 등록 중 오류가 발생했습니다." };
  }
}

export async function updateDriverStatusAction(driverId: string, status: "active" | "inactive"): Promise<DriverActionState> {
  try {
    const session = await requireSession();
    await assertOwnsDriver(driverId, session);
    await updateDriver(driverId, { status });
    revalidatePath("/settings");
    revalidatePath("/delivery");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." };
  }
}

export async function updateDriverRateAction(driverId: string, ratePerDelivery: number): Promise<DriverActionState> {
  try {
    const session = await requireSession();
    await assertOwnsDriver(driverId, session);
    await updateDriver(driverId, { rate_per_delivery: Math.max(0, ratePerDelivery) });
    revalidatePath("/settings");
    revalidatePath("/settlements");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." };
  }
}

/** admin만 가능. 배정된 배송 이력이 있는 기사는 삭제 대신 비활성화를 사용해야 하므로 거부한다. */
export async function deleteDriverAction(driverId: string): Promise<DriverActionState> {
  try {
    const session = await requireSession();
    if (session.role !== "admin") return { ok: false, error: "관리자만 삭제할 수 있습니다." };

    const assignedCount = await driversRepository.countAssignedOrders(driverId);
    if (assignedCount > 0) {
      return { ok: false, error: `배정된 배송 이력이 ${assignedCount}건 있어 삭제할 수 없습니다. 비활성화를 사용해주세요.` };
    }

    await driversRepository.delete(driverId);
    revalidatePath("/settings");
    revalidatePath("/delivery");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다." };
  }
}
