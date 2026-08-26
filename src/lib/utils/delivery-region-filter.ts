import { extractComplexName, isApartmentName } from "@/lib/utils/delivery-group";

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
  const counts = new Map<string, number>();
  for (const o of orders) {
    const sigungu = regionLabelOf(o.sigungu);
    const complexName = extractComplexName(o.address_snapshot);
    const building = complexName && isApartmentName(complexName) ? complexName : OTHER_BUILDING_LABEL;
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
 */
export function filterOrdersByRegionOrBuilding<T extends { sigungu: string | null; address_snapshot: string | null }>(
  orders: T[],
  activeRegions: string[],
  activeBuildingKeys: string[]
): T[] {
  if (activeRegions.length === 0 && activeBuildingKeys.length === 0) return orders;
  const regionSet = new Set(activeRegions);
  const buildingSet = new Set(activeBuildingKeys);
  return orders.filter((o) => {
    const sigungu = regionLabelOf(o.sigungu);
    if (regionSet.has(sigungu)) return true;
    if (buildingSet.size === 0) return false;
    const complexName = extractComplexName(o.address_snapshot);
    const building = complexName && isApartmentName(complexName) ? complexName : OTHER_BUILDING_LABEL;
    return buildingSet.has(regionBuildingKey(sigungu, building));
  });
}
