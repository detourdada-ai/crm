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

export function extraDisplayEntries(extra: Record<string, unknown>): [string, unknown][] {
  const hide = new Set([...ALREADY_DISPLAYED_KEYS, ...HIDDEN_INTERNAL_KEYS]);
  return Object.entries(extra).filter(([key, value]) => !hide.has(key) && value != null && value !== "");
}
