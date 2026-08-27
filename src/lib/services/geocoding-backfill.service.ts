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
export async function backfillFailedOrderGeocodes(): Promise<GeocodeBackfillResult> {
  const targets = await ordersRepository.findFailedGeocode();
  let succeeded = 0;
  for (const t of targets) {
    if (!t.address_snapshot) continue;
    const geo = await geocodeAddress(t.address_snapshot);
    if (geo.geocode_status !== "success") continue;
    await ordersRepository.update(t.id, { ...geo, geocoded_at: new Date().toISOString() });
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
    await customersRepository.update(t.id, { ...geo, geocoded_at: new Date().toISOString() });
    succeeded++;
  }
  return { targeted: targets.length, succeeded, stillFailed: targets.length - succeeded };
}
