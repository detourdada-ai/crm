import "server-only";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { geocodeAddress } from "@/lib/services/geocoding.service";

export interface GeocodeBackfillResult {
  targeted: number;
  succeeded: number;
  stillFailed: number;
}

/**
 * P4C STEP3-C(2026-08 CPO 작업지시): geocoding.service.ts가 이제 도로명주소만
 * 추려 카카오에 검색하므로(상세주소 표기 차이로 실패하던 문제 수정), 그
 * 수정 이전에 이미 geocode_status='failed'로 남은 기존 주문/고객을 같은
 * 방식으로 재시도한다. 다른 행의 좌표를 추정해서 복사하지 않는다 —
 * 카카오에 실제로 다시 물어봐서 받은 응답으로만 갱신한다. 실패가 계속되는
 * 행은 그대로 failed로 남는다(억지로 성공 처리하지 않는다).
 */
/**
 * STEP11-2 Phase 2(CPO 작업지시, 2026-08): Admin이 전체 tenant의 실패 건을
 * 한 번에 재처리하는 것 자체는 운영자 권한 범위 안이지만, 개별 행을 갱신할
 * 때는 반드시 그 행이 실제로 속한 tenant(owner_username)를 명시해서
 * repository의 소유권 스코핑(F15 이중검증 패턴)을 그대로 통과시켜야 한다 —
 * "관리자니까 전부"가 아니라 "각 행은 각자의 tenant 범위 안에서" 처리한다.
 * findFailedGeocode()가 이미 owner_username을 함께 내려주므로 추가 조회
 *없이 바로 tenant 범위를 명시할 수 있다.
 */
export async function backfillFailedOrderGeocodes(): Promise<GeocodeBackfillResult> {
  const targets = await ordersRepository.findFailedGeocode();
  let succeeded = 0;
  for (const t of targets) {
    if (!t.address_snapshot) continue;
    const geo = await geocodeAddress(t.address_snapshot);
    if (geo.geocode_status !== "success") continue;
    await ordersRepository.update(t.id, { ...geo, geocoded_at: new Date().toISOString() }, t.owner_username);
    succeeded++;
  }
  return { targeted: targets.length, succeeded, stillFailed: targets.length - succeeded };
}

export async function backfillFailedCustomerGeocodes(): Promise<GeocodeBackfillResult> {
  const targets = await customersRepository.findFailedGeocode();
  let succeeded = 0;
  for (const t of targets) {
    if (!t.road_address) continue;
    const geo = await geocodeAddress(t.road_address);
    if (geo.geocode_status !== "success") continue;
    await customersRepository.update(t.id, { ...geo, geocoded_at: new Date().toISOString() }, t.owner_username);
    succeeded++;
  }
  return { targeted: targets.length, succeeded, stillFailed: targets.length - succeeded };
}
