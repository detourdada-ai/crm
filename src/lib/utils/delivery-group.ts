import type { DeliveryGroup } from "@/types/domain";

/**
 * P14-B: 배송그룹 A/B/C(group_no를 알파벳으로 바꾼 것뿐, 지역과 무관)는
 * 배송담당자가 의미를 알 수 없다는 CEO 피드백에 따라 대체됐다. 그룹은
 * 여전히 기존 100m Haversine+Union-Find 클러스터링 결과 그대로이고, 이
 * 함수는 그 결과에 이미 저장돼 있는 대표 행정구역(representative_sigungu/
 * representative_eupmyeondong, geocoding 시점에 채워짐)을 사람이 읽을 수
 * 있는 "배송지역" 라벨로만 바꾼다 — 새 계산/저장 없음.
 */
export function groupRegionLabel(
  group: Pick<DeliveryGroup, "representative_sido" | "representative_sigungu" | "representative_eupmyeondong">
): string {
  const parts = [group.representative_sigungu, group.representative_eupmyeondong].filter(
    (v): v is string => !!v
  );
  if (parts.length > 0) return parts.join(" ");
  return group.representative_sido ?? "지역 미상";
}

/**
 * P14-B: 주소 원문(카카오 도로명주소 표준 표기 "도로명 (법정동, 건물명) 동호수")에서
 * 괄호 안 건물명만 뽑는다. 이 패턴이 없으면(단독주택, 건물명 없는 주소 등)
 * null을 반환한다 — 문자열을 억지로 잘라 건물명을 추정하지 않는다(작업지시서
 * 원칙: "AI나 문자열 추론으로 임의의 건물명을 만들지 않는다").
 *
 * 이 값은 "단지명" 후보일 뿐 "아파트 여부" 판정과는 별개다 — 오피스텔/상가/
 * 복합빌딩도 건물명을 가질 수 있으므로, 아파트 분류는 반드시 isApartmentName()을
 * 함께 써야 한다.
 */
export function extractComplexName(addressSnapshot: string | null | undefined): string | null {
  if (!addressSnapshot) return null;
  const match = addressSnapshot.match(/\(([^,)]+),\s*([^)]+)\)/);
  return match ? match[2].trim() : null;
}

/**
 * P14-B 보완(CPO 반려 후 재작업): "건물명이 추출됐다"는 "아파트다"를 의미하지
 * 않는다 — 오피스텔/상가/복합빌딩(예: 실제 운영 데이터의 "트리피움오피스텔",
 * "고덕복합빌딩")도 괄호 안 건물명을 갖는다. 카카오 주소 검색 API 응답에는
 * "이 건물이 아파트인지" 나타내는 필드가 없고(행정동 depth 정보만 제공),
 * 그 유형을 판별하려면 별도의 카테고리 검색 API 연동이 필요한데 이번
 * Sprint 범위 밖이다(작업지시서 10번 "카카오/네이버 주소 API 신규 연동" 제외).
 * 그래서 이번 단계에서는 건물명 문자열 자체에 명시적으로 "아파트"/"APT"가
 * 포함된 경우만 아파트로 판정하고, 그 외(래미안/자이/힐스테이트처럼 브랜드명만
 * 있고 "아파트"라는 단어가 없는 실제 아파트 포함)는 전부 "기타"로 분류한다 —
 * 판별 불가능하면 억지로 아파트로 넣지 않는다는 원칙을 지키기 위해 과소분류를
 * 감수한다. 실측(2026-08-20 기준): 145개 추출 건물명 중 20개(32건)만 이
 * 키워드를 포함했고 나머지 63개(113건, 78%)는 "기타"로 분류된다 — 이 중
 * 상당수가 실제로는 아파트이지만, 지금은 "확실한 것만 아파트"가 안전한
 * 기본값이다. 향후 브랜드명 사전이나 카카오 카테고리 검색 연동으로 개선할
 * 수 있는 별도 과제로 남긴다.
 */
export function isApartmentName(complexName: string): boolean {
  return /아파트|APT/i.test(complexName);
}

/**
 * P4C Phase3 STEP3-E에서 지역필터 전용으로 만들었던 로직을 여기로 옮긴다
 * (STEP5-G) — delivery-region-filter.ts가 이미 이 파일의 extractComplexName/
 * isApartmentName을 가져다 쓰므로, 반대 방향 import를 두면 순환참조가
 * 생긴다. 전체 활성 주문을 한 번 훑어 "같은 건물명이 실제 지역(sigungu)
 * 정확히 하나에만 있는" 경우만 그 건물→지역 매핑으로 인정한다("기타"는
 * 대상이 아니고, 같은 건물명이 서로 다른 실제 지역 2곳 이상에 있으면
 * 동명 건물일 수 있으므로 합치지 않는다 — 오병합보다 미확인 우선).
 */
export function buildRealRegionByBuilding<T extends { sigungu: string | null; address_snapshot: string | null }>(
  orders: T[]
): Map<string, string> {
  const regionsByBuilding = new Map<string, Set<string>>();
  for (const o of orders) {
    const sigungu = o.sigungu;
    if (!sigungu) continue;
    const complexName = extractComplexName(o.address_snapshot);
    if (!complexName || !isApartmentName(complexName)) continue;
    const regions = regionsByBuilding.get(complexName) ?? new Set<string>();
    regions.add(sigungu);
    regionsByBuilding.set(complexName, regions);
  }
  const result = new Map<string, string>();
  for (const [building, regions] of regionsByBuilding) {
    if (regions.size === 1) result.set(building, [...regions][0]);
  }
  return result;
}

export interface GroupBuildingLabel {
  /** 카드/select 안에 쓰는 짧은 부분 표시명 — 우선순위(§8)에 따라 건물명 / "건물명 외 N곳" / 지역명 / "N구역" 중 하나. */
  suffix: string;
  /** 지역 헤딩과 합친 전체 라벨(건물명이 확정된 경우만 "지역 · 건물명" 형태, 지역명 단독일 땐 suffix와 동일). */
  full: string;
  /** STEP5-B: 건물이 2곳 이상 섞인 그룹은 카드에 "지역 · 건물명 외 N곳" 대신 지역명만 쓰고 ⚠ 경고를 별도로 보여준다. */
  region: string;
}

export interface GroupBuildingCount {
  /** 건물명, 또는 addressSnapshot에서 건물명을 추출하지 못한 배송건을 모은 "기타". */
  name: string;
  count: number;
}

/**
 * P4C STEP3-F(2026-08 CPO 작업지시): 같은 건물의 표기 차이("고덕그라시움아파트"
 * / "고덕그라시움" / "고덕 그라시움 아파트" / "고덕그라시움 APT")를 하나로
 * 묶기 위한 비교 전용 키 — 공백을 전부 없애고 "아파트"/"APT"/"apt" 접미사를
 * 지운 뒤 소문자로 비교한다. **표시에는 절대 쓰지 않는다**(그룹 카드에는
 * 원본 표기 중 하나를 그대로 보여준다 — buildGroupBuildingCounts 참고).
 * 유사도 추정이 아니라 정확히 같은 정규화 키만 묶으므로 "미사역 파라곤"과
 * "미사강변 호반 써밋"처럼 실제 다른 건물은 절대 합쳐지지 않는다.
 */
function buildingNormalizationKey(name: string): string {
  return name.replace(/\s+/g, "").replace(/아파트|apt/gi, "").toLowerCase();
}

/** STEP2-D(§10): 그룹 카드 안의 배송건수 소계 — total은 이 그룹 안에서
 *  지금 화면에 보이는 전체 건수, 나머지 셋은 그 안의 상태별 분해다. */
export interface GroupStatusSubtotal {
  total: number;
  needsDriver: number;
  inProgress: number;
  done: number;
}

/**
 * P4C STEP2-C(2026-08 CPO 작업지시 §9/§11): 그룹 하나에 속한 배송건들의
 * 실제 건물명별 소계 — "이 그룹 안에 뭐가 들어있는지"를 그룹을 열지 않고도
 * 볼 수 있게 한다. 100m 반경 클러스터링이 서로 다른 단지를 하나로 묶은
 * 경우(실측: 미사역 파라곤 + 미사강변 호반 써밋이 한 그룹에 섞인 사례)를
 * 숨기지 않고 그대로 드러내는 것이 목적이다 — extractComplexName은 여기서도
 * "아파트" 키워드 필터 없이(isApartmentName은 다른 용도) 괄호 안 건물명을
 * 있는 그대로 센다.
 */
export function buildGroupBuildingCounts(memberAddresses: (string | null)[]): GroupBuildingCount[] {
  const rawCounts = new Map<string, number>();
  for (const addr of memberAddresses) {
    const name = extractComplexName(addr) ?? "기타";
    rawCounts.set(name, (rawCounts.get(name) ?? 0) + 1);
  }

  // STEP3-F: 정규화 키가 같은 원본 표기들을 하나로 묶는다 — 이 그룹(이미
  // 100m 좌표로 확정된 배송건 집합) 내부에서만 적용하는 표시명 통합이다.
  // 대표 표시명은 "아파트/APT가 포함된, 더 완전한 표기"를 우선하고(정보량이
  // 많음), 그것도 동률이면 더 많이 등장한 원문을 쓴다.
  const clusters = new Map<string, { display: string; count: number; displayHasSuffix: boolean; displayRawCount: number }>();
  for (const [name, count] of rawCounts) {
    const key = name === "기타" ? "기타" : buildingNormalizationKey(name);
    const hasSuffix = name !== "기타" && /아파트|apt/i.test(name);
    const existing = clusters.get(key);
    if (!existing) {
      clusters.set(key, { display: name, count, displayHasSuffix: hasSuffix, displayRawCount: count });
      continue;
    }
    existing.count += count;
    const shouldReplaceDisplay =
      (hasSuffix && !existing.displayHasSuffix) || (hasSuffix === existing.displayHasSuffix && count > existing.displayRawCount);
    if (shouldReplaceDisplay) {
      existing.display = name;
      existing.displayHasSuffix = hasSuffix;
      existing.displayRawCount = count;
    }
  }

  return [...clusters.values()]
    .map(({ display, count }) => ({ name: display, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * P4C STEP2-C(2026-08 CPO 작업지시 §8): 배송그룹 표시명 우선순위.
 * 1순위: 그룹 안에서 가장 많이 겹치는 실제 건물명(예: "미사역 파라곤").
 *        예전엔 "아파트"/"APT" 키워드가 있어야만 건물명으로 인정했지만,
 *        실측 결과 55개 그룹 중 42개(76%)가 이 키워드 필터 때문에 "N구역"
 *        기술 라벨로 폴백해 CPO가 지적한 문제의 핵심 원인이었다 — 라벨
 *        용도로는 키워드 유무와 무관하게 괄호 안 건물명이면 충분하다
 *        (아파트/오피스�트 구분이 실제로 필요한 곳은 isApartmentName을
 *        여전히 쓰는 다른 호출부뿐, 이 함수는 그걸 쓰지 않는다).
 * 2순위: 건물명이 여러 개면 "대표명 외 N곳"(실제로 서로 다른 건물이 한
 *        그룹에 섞였다는 사실을 그대로 보여준다 — §9).
 * 3순위: 건물명을 하나도 추출 못하면(단독주택 등) 지역명 단독 사용.
 * 최후 fallback: 지역명조차 없으면(이론상만 존재) "N구역".
 */
export function buildGroupBuildingLabels(
  groups: Pick<DeliveryGroup, "id" | "group_no" | "representative_sido" | "representative_sigungu" | "representative_eupmyeondong">[],
  memberAddressesByGroupId: Map<string, (string | null)[]>,
  /** STEP5-G: 지역 미확인→실제 지역 병합 판단을 지역필터와 공유하기 위한 전체 활성 주문(그룹 소속 무관). */
  allActiveOrdersForRegionMerge: { sigungu: string | null; address_snapshot: string | null }[] = []
): Map<string, GroupBuildingLabel> {
  const byRegion = new Map<string, typeof groups>();
  for (const g of groups) {
    const key = regionKeyOf(g);
    const list = byRegion.get(key) ?? [];
    list.push(g);
    byRegion.set(key, list);
  }
  const realRegionByBuilding = buildRealRegionByBuilding(allActiveOrdersForRegionMerge);

  const labelById = new Map<string, GroupBuildingLabel>();
  for (const list of byRegion.values()) {
    const sorted = [...list].sort((a, b) => a.group_no - b.group_no);
    sorted.forEach((g, idx) => {
      let region = groupRegionLabel(g);
      const addresses = memberAddressesByGroupId.get(g.id) ?? [];
      const buildingCounts = buildGroupBuildingCounts(addresses).filter((c) => c.name !== "기타");

      // STEP5-G: 대표 행정구역이 전혀 없어("지역 미상") 이 그룹의 대표
      // 건물명이 지역필터에서는 이미 실제 지역 하나로 확정돼 있는데 그룹
      // 카드만 "지역 미상"으로 따로 노는 상황을 막는다 — 지역필터와 동일한
      // 병합 판단(buildRealRegionByBuilding)을 그대로 재사용.
      if (region === "지역 미상" && buildingCounts.length > 0) {
        const merged = realRegionByBuilding.get(buildingCounts[0].name);
        if (merged) region = merged;
      }

      if (buildingCounts.length === 0) {
        // 3순위: 건물명 특정 불가 — 지역명을 그대로 기본 표시명으로 쓴다(§8, "N구역"을 기본값으로 하지 않는다).
        const fallback = region !== "지역 미상" ? region : `${idx + 1}구역`;
        labelById.set(g.id, { suffix: fallback, full: fallback, region: fallback });
        return;
      }
      const topName = buildingCounts[0].name;
      const suffix = buildingCounts.length > 1 ? `${topName} 외 ${buildingCounts.length - 1}곳` : topName;
      labelById.set(g.id, { suffix, full: `${region} · ${suffix}`, region });
    });
  }
  return labelById;
}

/** group.representative_sido/sigungu/eupmyeondong 조합을 지역 키로 삼는다 — buildGroupBuildingLabels 전용 헬퍼. */
function regionKeyOf(g: Pick<DeliveryGroup, "representative_sido" | "representative_sigungu" | "representative_eupmyeondong">): string {
  return `${g.representative_sido ?? ""}||${g.representative_sigungu ?? ""}||${g.representative_eupmyeondong ?? ""}`;
}
