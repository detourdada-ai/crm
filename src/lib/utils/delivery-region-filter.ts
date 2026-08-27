import { extractComplexName, isApartmentName, buildRealRegionByBuilding } from "@/lib/utils/delivery-group";

/**
 * 배송목록 필터 UX 개편(CPO, 2026-08): 기존 "지역 필터"(배송그룹 단일선택,
 * delivery-group.ts의 filterOrdersByGroup)를 대체한다 — 배송그룹은 하루
 * 단위로 자동 클러스터링된 세부 단위(예: "망월동 · 1구역")라 필터로 쓰기엔
 * 너무 잘게 쪼개져 있었다. 대신 각 주문에 이미 지오코딩되어 있는 sigungu
 * (행정구역, 예: "강남구")를 여러 개 동시에 선택할 수 있는 필터로 쓴다 —
 * 배송그룹 자체의 정의·클러스터링 로직(row의 배송그룹 배지 표시, 배정필요
 * 목록 정렬)은 전혀 건드리지 않는다.
 */
export function filterOrdersBySigungu<T extends { sigungu: string | null }>(orders: T[], activeRegions: string[]): T[] {
  if (activeRegions.length === 0) return orders;
  const set = new Set(activeRegions);
  return orders.filter((o) => o.sigungu !== null && set.has(o.sigungu));
}

/** 건물명을 뽑을 수 없거나 아파트로 판정되지 않는 모든 주소가 속하는 catch-all 버킷. */
export const OTHER_BUILDING_LABEL = "기타";

/**
 * CPO 지적(2026-08): 지오코딩이 안 됐거나 실패한 주문(sigungu=null)은 지역
 * 필터 목록 어디에도 안 뜨면서, "전체"가 아닌 특정 지역을 하나라도 고르는
 * 순간 조용히 목록에서 사라졌다 — 실제로 존재하는 배송건인데 필터에서
 * 제외되는 건이 생기면 안 된다는 지적. 그래서 null sigungu도 이 라벨로
 * 정규화해 지역 목록에 "지역 미확인"으로 그대로 노출하고, 선택하면 해당
 * 주문들만 볼 수 있게 한다.
 */
export const UNKNOWN_REGION_LABEL = "지역 미확인";

function regionLabelOf(sigungu: string | null): string {
  return sigungu ?? UNKNOWN_REGION_LABEL;
}

export interface RegionBuildingCount {
  sigungu: string;
  building: string; // 아파트명 또는 OTHER_BUILDING_LABEL
  count: number;
}

/** (지역, 건물) 조합을 URL/상태에 담기 위한 합성 키 — 지역명/건물명에 "||"가 오지 않는다는 전제(한글 행정구역/아파트명 특성상 안전). */
export function regionBuildingKey(sigungu: string, building: string): string {
  return `${sigungu}||${building}`;
}

/**
 * P4C STEP3-E(2026-08 CPO 작업지시): 지오코딩 실패(sigungu=null)로 같은
 * 건물이 "지역 미확인"에 중복 노출되는 문제 — 1차 대응은 지오코딩 자체를
 * 도로명주소 기준으로 정정하는 것(geocoding.service.ts)이지만, 그래도
 * 실패가 남는 경우를 위한 안전망이다. 전체 주문 집합을 한 번 훑어 "같은
 * 건물명이 실제 지역 버킷 정확히 하나에만 있는" 경우만 찾아 그 건물명을
 * 그 지역으로 귀속시킨다. "기타"(건물명 자체가 없음)는 대상이 아니고,
 * 같은 건물명이 서로 다른 실제 지역 2곳 이상에 이미 있으면(동명 건물일
 * 수 있으므로) 어느 쪽인지 판단할 수 없어 절대 합치지 않는다(오병합보다
 * 미확인 우선). buildRegionBuildingCounts(집계)와 filterOrdersByRegionOrBuilding
 * (선택 필터링)이 같은 병합 판단을 공유해야 "지역 미확인 건이 합산된
 * 지역 항목을 체크했는데 정작 그 주문은 안 보이는" 불일치가 생기지 않는다.
 * STEP5-G: 배송그룹 카드 라벨(delivery-group.ts의 buildGroupBuildingLabels)도
 * 이제 이 판단 기준(buildRealRegionByBuilding, delivery-group.ts로 이동)을
 * 그대로 공유한다 — 같은 건물이 지역필터에서는 "하남시", 그룹카드에서는
 * "지역 미상"으로 따로 노는 불일치를 막는다.
 */

/** 주문 하나의 (지역, 건물) — 지역 미확인이면서 다른 곳에서 이미 지역이 확인된 같은 건물이면 그 지역으로 귀속시킨다. */
function effectiveRegionBuildingOf<T extends { sigungu: string | null; address_snapshot: string | null }>(
  o: T,
  realRegionByBuilding: Map<string, string>
): { sigungu: string; building: string } {
  const complexName = extractComplexName(o.address_snapshot);
  const building = complexName && isApartmentName(complexName) ? complexName : OTHER_BUILDING_LABEL;
  if (!o.sigungu && building !== OTHER_BUILDING_LABEL) {
    const mergedRegion = realRegionByBuilding.get(building);
    if (mergedRegion) return { sigungu: mergedRegion, building };
  }
  return { sigungu: regionLabelOf(o.sigungu), building };
}

/**
 * CPO 요청(2026-08, 지역 필터 2단계): "지역명 + 건물(아파트1/아파트2/기타)"
 * 형태로 지역 필터 안에 건물 단위 하위 그룹을 보여준다. delivery-group.ts의
 * extractComplexName/isApartmentName을 그대로 재사용한다 — 새로운 문자열
 * 추론 규칙을 만들지 않고, 배송그룹 카드에 이미 쓰는 것과 동일한 판정
 * 기준(주소 괄호 안 건물명 + "아파트"/"APT" 키워드)을 필터에도 적용한다.
 * delivery_groups(100m 반경 클러스터, 하루 단위)와는 완전히 독립적인
 * 집계다 — 지역 필터는 그날그날 그룹 재계산과 무관하게 항상 전체 활성
 * 배송건 기준으로 계산된다. sigungu가 null인 주문도 빠짐없이
 * UNKNOWN_REGION_LABEL 아래로 집계한다(주소 텍스트 자체는 지오코딩 여부와
 * 무관하게 존재하므로 건물명 추출은 그대로 시도한다).
 */
export function buildRegionBuildingCounts<T extends { sigungu: string | null; address_snapshot: string | null }>(
  orders: T[]
): RegionBuildingCount[] {
  const realRegionByBuilding = buildRealRegionByBuilding(orders);
  const counts = new Map<string, number>();
  for (const o of orders) {
    const { sigungu, building } = effectiveRegionBuildingOf(o, realRegionByBuilding);
    const key = regionBuildingKey(sigungu, building);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([key, count]) => {
    const [sigungu, building] = key.split("||");
    return { sigungu, building, count };
  });
}

/**
 * 지역(전체) 선택과 건물(특정 지역의 하위 그룹) 선택을 함께 적용한다 —
 * "지역 하나를 통째로 보고 싶다"와 "그 지역 중 특정 건물만 보고 싶다"를
 * 동시에 지원하기 위해 OR로 합친다: activeRegions에 속하거나, 그 주문의
 * (지역,건물) 조합이 activeBuildingKeys에 있으면 통과. sigungu가 null인
 * 주문은 UNKNOWN_REGION_LABEL로 취급되어, 그 라벨이 activeRegions/
 * activeBuildingKeys에 명시적으로 포함된 경우에만(=사용자가 "지역 미확인"을
 * 직접 선택한 경우에만) 노출된다 — 그 외에는 기존과 동일하게 제외된다.
 * buildRegionBuildingCounts와 동일한 지역 미확인→실제 지역 귀속 판단을
 * 공유해, 집계 화면에 합산되어 보이는 건은 그 지역 체크박스로도 그대로
 * 걸러진다.
 */
export function filterOrdersByRegionOrBuilding<T extends { sigungu: string | null; address_snapshot: string | null }>(
  orders: T[],
  activeRegions: string[],
  activeBuildingKeys: string[]
): T[] {
  if (activeRegions.length === 0 && activeBuildingKeys.length === 0) return orders;
  const regionSet = new Set(activeRegions);
  const buildingSet = new Set(activeBuildingKeys);
  const realRegionByBuilding = buildRealRegionByBuilding(orders);
  return orders.filter((o) => {
    const { sigungu, building } = effectiveRegionBuildingOf(o, realRegionByBuilding);
    if (regionSet.has(sigungu)) return true;
    if (buildingSet.size === 0) return false;
    return buildingSet.has(regionBuildingKey(sigungu, building));
  });
}
