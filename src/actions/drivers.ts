"use server";

import { revalidatePath } from "next/cache";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { createDriverWithAccount, updateDriver, DriverServiceError } from "@/lib/services/driver.service";
import { listAccounts } from "@/lib/auth/credentials";
import { requireSession } from "@/lib/auth/current-session";
import type { Driver } from "@/types/domain";

async function requireAdmin() {
  const session = await requireSession();
  if (session.role !== "admin") throw new DriverServiceError("관리자만 접근할 수 있습니다.");
  return session;
}

export interface DriverWithAccount extends Driver {
  username: string | null;
}

export async function listDriversAction(): Promise<DriverWithAccount[]> {
  await requireAdmin();
  const [drivers, accounts] = await Promise.all([driversRepository.listAll(), listAccounts()]);
  const usernameByDriverId = new Map(accounts.filter((a) => a.driverId).map((a) => [a.driverId, a.username]));
  return drivers.map((d) => ({ ...d, username: usernameByDriverId.get(d.id) ?? null }));
}

export interface DriverActionState {
  ok: boolean;
  error: string | null;
}

export async function createDriverAction(
  _prevState: DriverActionState,
  formData: FormData
): Promise<DriverActionState> {
  try {
    await requireAdmin();
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

    await createDriverWithAccount({ name, phone, address, vehicleNumber, ratePerDelivery, username, password });
    revalidatePath("/settings");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "기사 등록 중 오류가 발생했습니다." };
  }
}

export async function updateDriverStatusAction(driverId: string, status: "active" | "inactive"): Promise<DriverActionState> {
  try {
    await requireAdmin();
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
    await requireAdmin();
    await updateDriver(driverId, { rate_per_delivery: Math.max(0, ratePerDelivery) });
    revalidatePath("/settings");
    revalidatePath("/settlements");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." };
  }
}
