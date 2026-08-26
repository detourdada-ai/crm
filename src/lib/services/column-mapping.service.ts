import { MAPPABLE_FIELDS, type ColumnMapping, type ColumnMappingResult, type MappableField } from "@/types/excel";

/**
 * Smartstore (and other storefront) exports rename their columns over time
 * ("주문번호" vs "주문번호(ID)" vs "OrderNo"). Rather than hardcode one
 * header set, we recognize a list of known aliases per field and fall back
 * to a manual mapping UI for anything we can't confidently resolve.
 *
 * IMPORTANT: "주문번호" (parent order, shared by every product line in the
 * same order) and "상품주문번호" (a single product line's own id) are
 * DIFFERENT columns in the real "배송현황관리" export — don't alias one to
 * the other or multi-item orders won't group correctly. Same story for
 * "수취인명" (delivery recipient) vs "구매자명" (buyer) — a gift order can
 * have two different people here.
 */
export const FIELD_ALIASES: Record<MappableField, string[]> = {
  order_number: ["주문번호", "주문번호id", "주문id", "orderno", "orderid", "ordernumber"],
  order_date: ["주문일시", "주문일자", "주문날짜", "주문일", "결제일시", "결제일", "orderdate", "date"],
  recipient_name: [
    "수취인명",
    "수취인",
    "수령인",
    "수령인명",
    "받는사람",
    "받는분",
    "주문자명",
    "주문자",
    // 베타 오픈 준비 — 주문 데이터 표준화: 스마트스토어 외 일반 엑셀에서
    // 흔히 쓰이는 이름 컬럼들("성명"/"이름"/"고객명").
    "성명",
    "이름",
    "고객명",
    "recipient",
    "receivername",
    "customername",
  ],
  phone: [
    "수취인전화번호",
    "수취인휴대폰번호",
    "수취인연락처",
    "수령인전화번호",
    "수령인연락처",
    "휴대폰번호",
    "전화번호",
    "연락처",
    "핸드폰번호",
    "phone",
    "phonenumber",
    "mobile",
    "tel",
  ],
  address: [
    "배송지",
    "수취인주소",
    "수령인주소",
    "배송지주소",
    "배송주소",
    "주소",
    "address",
    "shippingaddress",
    "deliveryaddress",
  ],
  zipcode: ["우편번호", "zipcode", "postcode", "postalcode"],
  delivery_memo: [
    "배송메모",
    "배송메세지",
    "배송시요청사항",
    "배송요청사항",
    "요청사항",
    "배송메모사항",
    "memo",
    "deliverymemo",
    "note",
  ],
  // CPO 정책(2026-08): "배송일"은 발송 예정일(future intent)을 뜻하고,
  // shipped_at("배송완료일")은 이미 끝난 배송의 완료 시각을 뜻한다 — 의미가
  // 달라서 "배송일"/"deliverydate" 별칭은 여기로만 귀속시킨다(shipped_at
  // 쪽에서는 제거, 아래 참고).
  delivery_date: ["배송일", "배송예정일", "발송예정일", "희망배송일", "배송희망일", "발송일", "deliverydate", "deliveryscheduled"],
  order_status: ["주문상태", "orderstatus", "status"],
  courier: ["택배사", "courier", "carrier"],
  tracking_number: ["송장번호", "운송장번호", "trackingnumber", "invoicenumber"],
  sales_channel: ["판매채널", "channel", "saleschannel"],
  buyer_name: ["구매자명", "구매자", "buyername", "buyer"],
  buyer_id: ["구매자id", "구매자아이디", "buyerid"],
  // "배송일"/"deliverydate"는 delivery_date 필드가 가져갔다(위 참고) —
  // shipped_at은 "배송완료일" 계열 표현만 남긴다.
  shipped_at: ["배송완료일", "shippedat"],
  product_order_number: ["상품주문번호", "productorderno", "productorderid"],
  product_code: ["상품번호", "판매자상품코드", "productcode", "productno", "sku"],
  product_name: ["상품명", "품목명", "제품명", "productname", "itemname"],
  option_name: ["옵션", "옵션명", "옵션정보", "구매옵션", "option", "optionname"],
  quantity: ["수량", "주문수량", "구매수량", "qty", "quantity"],
  unit_price: ["상품가격", "단가", "옵션가", "상품단가", "판매단가", "unitprice", "price"],
  amount: [
    "최종상품별총주문금액",
    "정산금액",
    "결제금액",
    "총금액",
    "상품금액",
    "합계금액",
    "총주문금액",
    "총결제금액",
    "amount",
    "totalamount",
    "totalprice",
  ],
  bag_no: ["가방번호", "가방no", "bagno", "bagnumber"],
  payment_status: ["결제상태", "결제여부", "paymentstatus"],
  payment_method: ["결제방법", "결제수단", "paymentmethod"],
};

/** Strips whitespace, parenthetical notes, and punctuation; lowercases latin chars. */
export function normalizeHeader(header: string): string {
  return header
    .replace(/[([{].*?[)\]}]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .trim();
}

const MAX_PLAUSIBLE_HEADER_LENGTH = 30;
// 스마트스토어 "1행 삭제 후 업로드하세요" 같은 안내문이 흔히 시작 기호로 쓴다.
const GUIDE_TEXT_MARKERS = /[◈※▶▷▪•]/;

/**
 * §12 CPO 작업지시(STEP2 상품주문번호 재설계, 2026-08): 스마트스토어 원본
 * 엑셀의 안내문(예: "◈ 다운로드 받은 파일로 '엑셀 일괄발송' 처리하는
 * 방법...상품주문번호, 배송방법, 택배사...")이 1행에 그대로 남아있으면, 그
 * 문장 안에 별칭 단어("상품주문번호"/"택배사")가 우연히 포함돼 아래 부분일치
 * fallback이 안내문 셀 자체를 그 필드의 실제 헤더로 잘못 인식했다(2026-08-25
 * 실제 사고: 첫 업로드 0/422 성공). 실제 컬럼 헤더로 채택하기 전에 "헤더처럼
 * 생겼는지"를 먼저 걸러낸다 — 안내문/설명 문장은 헤더보다 훨씬 길고, 문장
 * 부호와 여러 단어를 포함한다.
 */
export function looksLikePlausibleHeader(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_PLAUSIBLE_HEADER_LENGTH) return false;
  if (/[\r\n]/.test(trimmed)) return false;
  if (GUIDE_TEXT_MARKERS.test(trimmed)) return false;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > 4) return false;
  const sentencePunctuationCount = (trimmed.match(/[.,?!]/g) ?? []).length;
  if (sentencePunctuationCount > 1) return false;
  return true;
}

/**
 * STD-4: `savedMapping`은 이 계정이 지난번 업로드에서 실제로 확정한 매핑
 * (import-mapping-settings.service.ts에 저장됨)이다. 같은 헤더 문자열이
 * 이번 파일에도 그대로 있으면 별칭 추측보다 우선 적용한다 — 별칭 목록에
 * 없는 회사 고유 헤더("사장님이름" 같은)라도 한 번 수동으로 매핑해두면
 * 다음부터는 자동으로 맞는다는 게 핵심 가치이기 때문이다.
 */
export function autoMapColumns(headers: string[], savedMapping?: ColumnMapping): ColumnMappingResult {
  const normalizedHeaders = headers.map((h) => ({ raw: h, normalized: normalizeHeader(h) }));
  const mapping: ColumnMapping = {};
  const usedHeaders = new Set<string>();
  const unmapped: MappableField[] = [];

  if (savedMapping) {
    for (const field of MAPPABLE_FIELDS) {
      const savedHeader = savedMapping[field.key];
      if (!savedHeader || usedHeaders.has(savedHeader)) continue;
      if (headers.includes(savedHeader) && looksLikePlausibleHeader(savedHeader)) {
        mapping[field.key] = savedHeader;
        usedHeaders.add(savedHeader);
      }
    }
  }

  for (const field of MAPPABLE_FIELDS) {
    if (mapping[field.key]) continue;
    const aliases = FIELD_ALIASES[field.key];
    let matchedHeader: string | undefined;

    // 1. exact normalized match
    for (const { raw, normalized } of normalizedHeaders) {
      if (usedHeaders.has(raw) || !looksLikePlausibleHeader(raw)) continue;
      if (aliases.includes(normalized)) {
        matchedHeader = raw;
        break;
      }
    }

    // 2. fallback: normalized header contains (or is contained by) an alias
    if (!matchedHeader) {
      for (const { raw, normalized } of normalizedHeaders) {
        if (usedHeaders.has(raw) || !normalized || !looksLikePlausibleHeader(raw)) continue;
        const isPartialMatch = aliases.some(
          (alias) => normalized.includes(alias) || alias.includes(normalized)
        );
        if (isPartialMatch) {
          matchedHeader = raw;
          break;
        }
      }
    }

    if (matchedHeader) {
      mapping[field.key] = matchedHeader;
      usedHeaders.add(matchedHeader);
    } else if (field.required) {
      unmapped.push(field.key);
    }
  }

  const unrecognizedHeaders = headers.filter((h) => !usedHeaders.has(h));

  return { mapping, unmapped, unrecognizedHeaders };
}
