import { extractComplexName, isApartmentName, buildRealRegionByBuilding } from "@/lib/utils/delivery-group";

/**
 * 배송목록 필터 UX 개편(CPO, 2026-08): 기존 "지역 필터"(배송그룹 단일선택,
 * delivery-group.ts의 filterOrdersByGroup)를 대체한다 — 배송그룹은 하루
 * 단위로 자동 클러스터링된 세부 단위(예: "망월동 · 1구역")라 필터로 쓰기엔
 * 너무 잘게 쪼개져 있었다. 대신 각 주문에 이미 지오코딩되어 있는 sigungu
 * (행정구역, 예: "강남구")를 여러 개 동시에 선택할 수 있는 필터로 쓴다 —
 * 배송그룹 자체의 정의·클러스터링 로직(row의 배송그룹 배지 표시, 배정필요
 * 목록 정렬)은 전혀 건드리지 않는다.
 *
 * STEP11-2 Phase3(CPO 작업지시, 2026-08): 시군구 단일 계층은 지역 하나에
 * 배송이 몰리면(실측: 하남시 229건) 여전히 너무 큰 단위였다 — 실데이터
 * 조사 결과 sigungu가 있는 주문은 eupmyeondong도 100% 채워져 있어(추가
 * 지오코딩/텍스트분석 비용 없이) 시군구→읍면동→건물명 3단 계층으로
 * 확장한다. 기본 선택 단위는 읍면동(가장 빠르게 고를 수 있는 단위), 건물명은
 * 읍면동을 펼쳤을 때만 보이는 보조 필터다. "기타"는 이제 시군구 전체가
 * 아니라 그 동 안에서만 존재하는 작은 잔여 버킷이 된다 — 정상 주소이고
 * eupmyeondong이 있으면 반드시 그 동 아래로 들어간다는 원칙(CPO).
 */
export function filterOrdersBySigungu<T extends { sigungu: string | null }>(orders: T[], activeRegions: string[]): T[] {
  if (activeRegions.length === 0) return orders;
  const set = new Set(activeRegions);
  return orders.filter((o) => o.sigungu !== null && set.has(o.sigungu));
}

/** 건물명을 뽑을 수 없거나 아파트로 판정되지 않는 모든 주소가 속하는 catch-all 버킷(동 단위로 스코프됨). */
export const OTHER_BUILDING_LABEL = "기타 주소";

/**
 * CPO 지적(2026-08): 지오코딩이 안 됐거나 실패한 주문(sigungu=null)은 지역
 * 필터 목록 어디에도 안 뜨면서, "전체"가 아닌 특정 지역을 하나라도 고르는
 * 순간 조용히 목록에서 사라졌다 — 실제로 존재하는 배송건인데 필터에서
 * 제외되는 건이 생기면 안 된다는 지적. 그래서 null sigungu도 이 라벨로
 * 정규화해 지역 목록에 "지역 미확인"으로 그대로 노출하고, 선택하면 해당
 * 주문들만 볼 수 있게 한다. sigungu가 아예 없으므로 읍면동/건물 하위
 * 계층은 갖지 않는다(시군구와 동급의 단독 항목으로 남는다).
 */
export const UNKNOWN_REGION_LABEL = "지역 미확인";

/**
 * STEP11-2 Phase3: sigungu는 있는데 eupmyeondong만 없는 경우(실측 데이터
 * 기준 0%지만, 다른 테넌트/향후 주소 형식 변화에 대한 안전망) — 이 시군구
 * 아래 "동 정보 없음" 잔여 항목으로 묶는다. UNKNOWN_REGION_LABEL과 달리
 * 시군구 자체는 확정돼 있으므로 그 시군구 하위에 남는다.
 */
export const OTHER_DONG_LABEL = "동 정보 없음";

export interface RegionCount {
  sigungu: string;
  count: number;
}

export interface DongCount {
  sigungu: string;
  eupmyeondong: string;
  count: number;
}

export interface RegionBuildingCount {
  sigungu: string;
  eupmyeondong: string;
  building: string; // 아파트명 또는 OTHER_BUILDING_LABEL
  count: number;
}

/** (시군구, 읍면동) 조합을 URL/상태에 담기 위한 합성 키. */
export function dongKey(sigungu: string, eupmyeondong: string): string {
  return `${sigungu}||${eupmyeondong}`;
}

/** (시군구, 읍면동, 건물) 조합을 URL/상태에 담기 위한 합성 키 — 지역/동/건물명에 "||"가 오지 않는다는 전제(한글 행정구역/아파트명 특성상 안전). */
export function regionBuildingKey(sigungu: string, eupmyeondong: string, building: string): string {
  return `${sigungu}||${eupmyeondong}||${building}`;
}

/**
 * P4C STEP3-E(2026-08 CPO 작업지시): 지오코딩 실패(sigungu=null)로 같은
 * 건물이 "지역 미확인"에 중복 노출되는 문제 — 1차 대응은 지오코딩 자체를
 * 도로명주소 기준으로 정정하는 것(geocoding.service.ts)이지만, 그래도
 * 실패가 남는 경우를 위한 안전망이다. 전체 주문 집합을 한 번 훑어 "같은
 * 건물명이 실제 지역 버킷 정확히 하나에만 있는" 경우만 찾아 그 건물명을
 * 그 지역으로 귀속시킨다(buildRealRegionByBuilding, delivery-group.ts로
 * 이동 — 배송그룹 카드 라벨과 이 판단 기준을 공유한다). 이 병합은 시군구
 * 단위까지만 확정하고 읍면동은 결정하지 않는다 — sigungu=null인 주문은
 * 원래 eupmyeondong도 함께 비어있어 어느 동인지 알 수 없으므로, 병합되면
 * OTHER_DONG_LABEL("동 정보 없음") 아래에 놓인다.
 */
function effectiveRegionOf<T extends { sigungu: string | null; eupmyeondong: string | null; address_snapshot: string | null }>(
  o: T,
  realRegionByBuilding: Map<string, string>
): { sigungu: string; eupmyeondong: string; building: string } {
  const complexName = extractComplexName(o.address_snapshot);
  const building = complexName && isApartmentName(complexName) ? complexName : OTHER_BUILDING_LABEL;
  let sigungu = o.sigungu;
  if (!sigungu && building !== OTHER_BUILDING_LABEL) {
    const merged = realRegionByBuilding.get(building);
    if (merged) sigungu = merged;
  }
  if (!sigungu) return { sigungu: UNKNOWN_REGION_LABEL, eupmyeondong: "", building };
  return { sigungu, eupmyeondong: o.eupmyeondong ?? OTHER_DONG_LABEL, building };
}

/**
 * STEP11-2 Phase3: 시군구/읍면동/건물명 세 계층의 집계를 한 번의 순회로
 * 함께 계산한다 — 세 결과가 서로 다른 병합 판단을 쓰면(예: 지역필터는
 * "하남시"라 하는데 건물 집계는 "지역 미확인"이라 하는 식) 화면과 체크박스
 * 상태가 어긋나므로, effectiveRegionOf 하나만 기준으로 공유한다.
 */
export function buildRegionHierarchyCounts<T extends { sigungu: string | null; eupmyeondong: string | null; address_snapshot: string | null }>(
  orders: T[]
): { regionCounts: RegionCount[]; dongCounts: DongCount[]; buildingCounts: RegionBuildingCount[] } {
  const realRegionByBuilding = buildRealRegionByBuilding(orders);
  const regionMap = new Map<string, number>();
  const dongMap = new Map<string, number>();
  const buildingMap = new Map<string, number>();

  for (const o of orders) {
    const { sigungu, eupmyeondong, building } = effectiveRegionOf(o, realRegionByBuilding);
    regionMap.set(sigungu, (regionMap.get(sigungu) ?? 0) + 1);
    if (sigungu === UNKNOWN_REGION_LABEL) continue; // 지역 미확인은 하위 계층을 갖지 않는다.
    const dk = dongKey(sigungu, eupmyeondong);
    dongMap.set(dk, (dongMap.get(dk) ?? 0) + 1);
    const bk = regionBuildingKey(sigungu, eupmyeondong, building);
    buildingMap.set(bk, (buildingMap.get(bk) ?? 0) + 1);
  }

  const regionCounts = [...regionMap.entries()].map(([sigungu, count]) => ({ sigungu, count }));
  const dongCounts = [...dongMap.entries()].map(([key, count]) => {
    const [sigungu, eupmyeondong] = key.split("||");
    return { sigungu, eupmyeondong, count };
  });
  const buildingCounts = [...buildingMap.entries()].map(([key, count]) => {
    const [sigungu, eupmyeondong, building] = key.split("||");
    return { sigungu, eupmyeondong, building, count };
  });
  return { regionCounts, dongCounts, buildingCounts };
}

/**
 * 지역(시군구 전체) / 동(읍면동 전체) / 건물(특정 건물) 세 계층의 선택을
 * 함께 적용한다 — 서로 다른 계층에서 고른 조건은 OR로 합친다: 셋 중
 * 하나라도 해당 주문과 일치하면 통과. sigungu가 null인 주문은
 * UNKNOWN_REGION_LABEL로 취급되어, 그 라벨이 activeRegions에 명시적으로
 * 포함된 경우에만(=사용자가 "지역 미확인"을 직접 선택한 경우에만) 노출된다.
 * buildRegionHierarchyCounts와 동일한 지역/동 판단(effectiveRegionOf)을
 * 공유해, 집계 화면에 합산되어 보이는 건은 체크박스로도 그대로 걸러진다.
 */
export function filterOrdersByRegionHierarchy<
  T extends { sigungu: string | null; eupmyeondong: string | null; address_snapshot: string | null },
>(orders: T[], activeRegions: string[], activeDongKeys: string[], activeBuildingKeys: string[]): T[] {
  if (activeRegions.length === 0 && activeDongKeys.length === 0 && activeBuildingKeys.length === 0) return orders;
  const regionSet = new Set(activeRegions);
  const dongSet = new Set(activeDongKeys);
  const buildingSet = new Set(activeBuildingKeys);
  const realRegionByBuilding = buildRealRegionByBuilding(orders);
  return orders.filter((o) => {
    const { sigungu, eupmyeondong, building } = effectiveRegionOf(o, realRegionByBuilding);
    if (regionSet.has(sigungu)) return true;
    if (sigungu === UNKNOWN_REGION_LABEL) return false;
    if (dongSet.size > 0 && dongSet.has(dongKey(sigungu, eupmyeondong))) return true;
    if (buildingSet.size > 0 && buildingSet.has(regionBuildingKey(sigungu, eupmyeondong, building))) return true;
    return false;
  });
}
