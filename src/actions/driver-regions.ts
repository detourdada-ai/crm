"use server";

import { revalidatePath } from "next/cache";
import { driverRegionsRepository } from "@/lib/repositories/driver-regions.repository";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { toActionError } from "@/lib/utils/action-error";
import { requireSession } from "@/lib/auth/current-session";
import { isUuid } from "@/lib/utils/id";
import { assertOwnsDriver } from "@/actions/drivers";

export interface DriverRegionActionState {
  ok: boolean;
  error: string | null;
}

/**
 * P0(기사관리 3건) 3번: 배송관리 화면에서 여러 주문을 동시에 선택했을 때,
 * 그 주문들의 배송지를 담당하는 기사 id 목록을 한 번에 조회한다.
 * listCandidateDriversAction(단일 주문용)을 그대로 다시 부르는 대신
 * driverRegionsRepository.findCandidateDriverIdsForRegions 배치 메서드를
 * 직접 호출해 주문 수만큼 쿼리가 늘어나지 않게 한다. 정렬/라벨링 힌트로만
 * 쓰여야 하며, 이 결과로 자동 배정을 하지 않는다.
 */
export async function listCandidateDriverIdsForOrdersAction(orderIds: string[]): Promise<string[]> {
  const session = await requireSession();
  const validIds = orderIds.filter(isUuid);
  if (validIds.length === 0) return [];

  const orders = await ordersRepository.findByIds(validIds);
  const regions = orders
    .filter((o) => session.role === "admin" || o.owner_username === session.username)
    .filter((o) => !!o.sido)
    .map((o) => ({ ownerUsername: o.owner_username, sido: o.sido, sigungu: o.sigungu, eupmyeondong: o.eupmyeondong }));

  return driverRegionsRepository.findCandidateDriverIdsForRegions(regions);
}

export async function addDriverRegionAction(
  driverId: string,
  _prevState: DriverRegionActionState,
  formData: FormData
): Promise<DriverRegionActionState> {
  try {
    const session = await requireSession();
    const driver = await assertOwnsDriver(driverId, session);

    const sido = String(formData.get("sido") || "").trim();
    if (!sido) return { ok: false, error: "시/도를 선택해주세요." };
    const sigungu = String(formData.get("sigungu") || "").trim() || null;
    const eupmyeondong = String(formData.get("eupmyeondong") || "").trim() || null;
    if (!sigungu && eupmyeondong) {
      return { ok: false, error: "읍/면/동을 지정하려면 시/군/구도 함께 입력해주세요." };
    }

    await driverRegionsRepository.create({
      driver_id: driverId,
      sido,
      sigungu,
      eupmyeondong,
      owner_username: driver.owner_username,
      tenant_id: driver.tenant_id,
    });
    revalidatePath("/settings");
    return { ok: true, error: null };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: unknown }).code === "23505") {
      return { ok: false, error: "이미 등록된 담당지역입니다." };
    }
    return { ok: false, error: toActionError(e, "담당지역 추가 중 오류가 발생했습니다.") };
  }
}

export async function deleteDriverRegionAction(regionId: string): Promise<DriverRegionActionState> {
  try {
    const session = await requireSession();
    await driverRegionsRepository.delete(regionId, session.role === "admin" ? undefined : session.username);
    revalidatePath("/settings");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "담당지역 삭제 중 오류가 발생했습니다.") };
  }
}

/** 기사 담당지역 등록 UI의 시/군/구·읍/면/동 자동완성 후보 — 이미 지오코딩된 이 계정의 고객 주소 기반. */
export async function listKnownRegionsAction(): Promise<
  Array<{ sido: string; sigungu: string | null; eupmyeondong: string | null }>
> {
  const session = await requireSession();
  const ownerUsername = session.role === "admin" ? undefined : session.username;
  return customersRepository.listDistinctRegions(ownerUsername);
}

export interface CandidateDriver {
  driverId: string;
  driverName: string;
  driverStatus: "active" | "inactive";
  regionLabel: string;
  priority: number;
}

/**
 * Phase 1: 이 주문의 배송지 행정구역을 담당할 수 있는 기사 후보 목록을
 * 우선순위(더 구체적인 지정 우선) 순으로 반환한다. 최종 배정은 자동으로
 * 확정하지 않는다 — 배송관리 화면에서 사람이 직접 배정한다.
 */
export async function listCandidateDriversAction(orderId: string): Promise<CandidateDriver[]> {
  const session = await requireSession();
  if (!isUuid(orderId)) return [];
  const order = await ordersRepository.findById(orderId);
  if (!order) return [];
  if (session.role !== "admin" && order.owner_username !== session.username) return [];
  if (!order.sido) return [];

  // admin도 이 주문을 소유한 테넌트로만 후보를 좁힌다 — 세션 스코프(admin=전체)를
  // 그대로 쓰면 다른 테넌트의 기사가 후보에 섞여 나오는 tenant 격리 누락이 된다.
  const candidates = await driverRegionsRepository.findCandidates({
    ownerUsername: order.owner_username,
    sido: order.sido,
    sigungu: order.sigungu,
    eupmyeondong: order.eupmyeondong,
  });
  if (candidates.length === 0) return [];

  const drivers = await driversRepository.findByIds(candidates.map((c) => c.driver_id));
  const driverById = new Map(drivers.map((d) => [d.id, d]));

  return candidates
    .map((c) => {
      const driver = driverById.get(c.driver_id);
      if (!driver) return null;
      const regionLabel = [c.sido, c.sigungu, c.eupmyeondong].filter(Boolean).join(" ");
      return {
        driverId: driver.id,
        driverName: driver.name,
        driverStatus: driver.status,
        regionLabel,
        priority: c.priority,
      };
    })
    .filter((c): c is CandidateDriver => c !== null);
}
