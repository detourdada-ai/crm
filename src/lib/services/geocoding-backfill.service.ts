import "server-only";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { geocodeBatch, type GeocodeFields } from "@/lib/services/geocoding.service";

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
/**
 * STEP12-18(WORKSTREAM 6): 이 backfill은 대상 건마다 카카오 API를 **순차로**
 * 한 번씩 호출하고 있었다 — 실패 건이 수백 개면 그 왕복이 전부 직렬로 쌓인다.
 * 새 병렬 처리 장치를 만들지 않고, Excel import가 이미 쓰고 있는
 * `geocodeBatch()`(동시성 상한이 걸린 기존 헬퍼)를 그대로 재사용한다.
 * 같은 주소가 여러 건에 걸쳐 있으면 Map 키로 자연히 dedup되어 호출 수 자체도
 * 줄어든다(주문/고객 backfill 모두 같은 주소가 반복되는 경우가 흔하다).
 * DB UPDATE는 행마다 좌표 값이 달라 한 문장으로 묶으려면 새 RPC가 필요하므로
 * 이번 범위에서는 건드리지 않는다(CPO 승인 대상).
 */
async function geocodeFailedAddresses(addresses: (string | null)[]): Promise<Map<string, GeocodeFields>> {
  const unique = new Map<string, string>();
  for (const a of addresses) {
    if (a) unique.set(a, a);
  }
  if (unique.size === 0) return new Map();
  return geocodeBatch(unique);
}

export async function backfillFailedOrderGeocodes(): Promise<GeocodeBackfillResult> {
  const targets = await ordersRepository.findFailedGeocode();
  const geoByAddress = await geocodeFailedAddresses(targets.map((t) => t.address_snapshot));
  let succeeded = 0;
  for (const t of targets) {
    const geo = t.address_snapshot ? geoByAddress.get(t.address_snapshot) : undefined;
    if (!geo || geo.geocode_status !== "success") continue;
    await ordersRepository.update(t.id, { ...geo, geocoded_at: new Date().toISOString() }, t.owner_username);
    succeeded++;
  }
  return { targeted: targets.length, succeeded, stillFailed: targets.length - succeeded };
}

export async function backfillFailedCustomerGeocodes(): Promise<GeocodeBackfillResult> {
  const targets = await customersRepository.findFailedGeocode();
  const geoByAddress = await geocodeFailedAddresses(targets.map((t) => t.road_address));
  let succeeded = 0;
  for (const t of targets) {
    const geo = t.road_address ? geoByAddress.get(t.road_address) : undefined;
    if (!geo || geo.geocode_status !== "success") continue;
    await customersRepository.update(t.id, { ...geo, geocoded_at: new Date().toISOString() }, t.owner_username);
    succeeded++;
  }
  return { targeted: targets.length, succeeded, stillFailed: targets.length - succeeded };
}
