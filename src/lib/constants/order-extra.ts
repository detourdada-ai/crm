import { FIELD_ALIASES, normalizeHeader } from "@/lib/services/column-mapping.service";

/**
 * Every original excel column is preserved per line item in `order_items.extra`
 * (see import.service.ts) so nothing from the source file is ever lost. The
 * order detail screen renders whatever's left over after excluding:
 *  - columns already shown via a typed field elsewhere on the page
 *  - Smartstore's own internal housekeeping columns (return-extension
 *    reasons, internal seller codes, etc.) that aren't useful for a CRM
 */
export const ALREADY_DISPLAYED_KEYS = [
  "상품주문번호",
  "주문번호",
  "주문번호id",
  "결제일",
  "주문일시",
  "수취인명",
  "수취인연락처1",
  "수취인연락처2",
  "배송지",
  "우편번호",
  "주문상태",
  "택배사",
  "송장번호",
  "판매채널",
  "구매자명",
  "구매자id",
  "구매자ID",
  "상품번호",
  "판매자 상품코드",
  "상품명",
  "옵션정보",
  "수량",
  "상품가격",
  "최종 상품별 총 주문금액",
  "배송완료일",
  "배송메모",
];

export const HIDDEN_INTERNAL_KEYS = [
  "판매자 내부코드1",
  "판매자 내부코드2",
  "구매확정연장 상태",
  "구매확정연장 설정일",
  "구매확정연장 사유",
  "문제송장 여부",
  "문제송장 등록일",
  "문제송장 등록사유",
  "자동구매확정예정일",
  "구매확정 요청일",
  "구매확정 요청자",
  "배송비 묶음번호",
];

// UX11-STEP1 P0-3: ALREADY_DISPLAYED_KEYS는 스마트스토어 고정 헤더 문자열
// 블랙리스트라, 일반 엑셀이 같은 의미를 다른 표기로 쓰면("성명"/"고객명"이
// "수취인명"과 같은 의미) 걸러지지 않고 "표시 컬럼" 후보에 중복 노출됐다.
// column-mapping.service.ts의 FIELD_ALIASES(자동 매핑에 실제로 쓰는 별칭
// 사전)를 재사용해, 이미 표준 필드로 흡수된 의미의 헤더는 정규화 비교로
// 걸러낸다 — extra 자체의 값은 그대로 두고(원본 삭제 없음) "표시 컬럼"
// 후보에서만 제외한다.
const KNOWN_ALIAS_SET = new Set(Object.values(FIELD_ALIASES).flat().map((alias) => normalizeHeader(alias)));

export function extraDisplayEntries(extra: Record<string, unknown>): [string, unknown][] {
  const hide = new Set([...ALREADY_DISPLAYED_KEYS, ...HIDDEN_INTERNAL_KEYS]);
  return Object.entries(extra).filter(
    ([key, value]) => !hide.has(key) && !KNOWN_ALIAS_SET.has(normalizeHeader(key)) && value != null && value !== ""
  );
}
