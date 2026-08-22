import type { DeliveryGroup } from "@/types/domain";

export const UNGROUPED_SENTINEL = "__ungrouped__";

/**
 * S2-C 인터뷰 8/21: 배송관리 "지역별" 필터의 유일한 판정 로직. 목록(DeliveryBoard)과
 * 지도(DeliveryMapView)가 각자 필터를 따로 구현하면 "목록엔 12건인데 지도엔
 * 13건" 같은 불일치가 생길 수 있어, 이 함수 하나만 양쪽에서 공유한다 —
 * activeGroupId는 특정 배송그룹 id, UNGROUPED_SENTINEL, 또는 null(전체)이다.
 */
export function filterOrdersByGroup<T extends { delivery_group_id: string | null }>(
  orders: T[],
  activeGroupId: string | null
): T[] {
  if (!activeGroupId) return orders;
  if (activeGroupId === UNGROUPED_SENTINEL) return orders.filter((o) => !o.delivery_group_id);
  return orders.filter((o) => o.delivery_group_id === activeGroupId);
}

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

export interface GroupBuildingLabel {
  /** 카드/select 안에 쓰는 짧은 부분 — 건물명 확정 시 "○○아파트", 아니면 "N구역" fallback. */
  suffix: string;
  /** 지역 헤딩("망월동")과 합친 전체 라벨 — "망월동 · ○○아파트". */
  full: string;
}

/**
 * S2-A: 배송그룹 카드/필터에 쓰는 최종 표시 라벨 — "망월동 · ○○아파트" 또는
 * (건물명이 확실하지 않으면) "망월동 · 1구역". 그룹 자체는 건물명을 저장하지
 * 않으므로(100m 반경 클러스터일 뿐), 그 그룹에 실제로 속한 배송건들의
 * address_snapshot에서 extractComplexName/isApartmentName으로 이미 뽑아낸
 * 이름 중 가장 많이 겹치는 것을 그 그룹의 대표 건물명으로 쓴다 — 새로운
 * 추정 로직이 아니라 기존 P14-B 판정을 그룹 구성원 전체에 적용해 다수결로
 * 대표값 하나를 고르는 것뿐이다. 겹치는 아파트명이 하나도 없으면(기타 건물,
 * 판별 불가 등) 억지로 만들지 않고 "지역 · N구역" fallback을 그대로 쓴다.
 */
export function buildGroupBuildingLabels(
  groups: Pick<DeliveryGroup, "id" | "group_no" | "representative_sido" | "representative_sigungu" | "representative_eupmyeondong">[],
  memberAddressesByGroupId: Map<string, (string | null)[]>
): Map<string, GroupBuildingLabel> {
  const byRegion = new Map<string, typeof groups>();
  for (const g of groups) {
    const key = regionKeyOf(g);
    const list = byRegion.get(key) ?? [];
    list.push(g);
    byRegion.set(key, list);
  }

  const labelById = new Map<string, GroupBuildingLabel>();
  for (const list of byRegion.values()) {
    const sorted = [...list].sort((a, b) => a.group_no - b.group_no);
    const region = groupRegionLabel(sorted[0]);
    sorted.forEach((g, idx) => {
      const addresses = memberAddressesByGroupId.get(g.id) ?? [];
      const nameCounts = new Map<string, number>();
      for (const addr of addresses) {
        const name = extractComplexName(addr);
        if (name && isApartmentName(name)) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
      }
      const topName = [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const suffix = topName ?? `${idx + 1}구역`;
      labelById.set(g.id, { suffix, full: `${region} · ${suffix}` });
    });
  }
  return labelById;
}

/** group.representative_sido/sigungu/eupmyeondong 조합을 지역 키로 삼는다 — buildGroupBuildingLabels 전용 헬퍼. */
function regionKeyOf(g: Pick<DeliveryGroup, "representative_sido" | "representative_sigungu" | "representative_eupmyeondong">): string {
  return `${g.representative_sido ?? ""}||${g.representative_sigungu ?? ""}||${g.representative_eupmyeondong ?? ""}`;
}
