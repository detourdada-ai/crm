/**
 * Phase 10 (업종 기반 Tenant Feature): 업종은 기능을 "추천"할 뿐 강제하지
 * 않는다 — 실제 사용 여부는 사업장이 직접 ON/OFF한다(tenants.bag_management).
 * 랜딩 모집 폼(recruit-form.tsx)의 BUSINESS_TYPES와 동일한 목록을 재사용해
 * 서비스 전체에서 업종 표현을 통일한다.
 */
export const INDUSTRY_OPTIONS = ["반찬", "도시락", "꽃·화환", "케이크·답례품", "식품", "기타"] as const;
export type Industry = (typeof INDUSTRY_OPTIONS)[number];

export function isIndustry(value: string): value is Industry {
  return (INDUSTRY_OPTIONS as readonly string[]).includes(value);
}

/** 업종 선택 시 가방 관리 기능의 추천 기본값 — 실제 활성화는 사업장이 명시적으로 선택한다. */
export const INDUSTRY_BAG_MANAGEMENT_RECOMMENDATION: Record<Industry, boolean> = {
  반찬: true,
  도시락: true,
  "꽃·화환": false,
  "케이크·답례품": false,
  식품: false,
  기타: false,
};
