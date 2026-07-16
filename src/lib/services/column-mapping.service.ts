import { MAPPABLE_FIELDS, type ColumnMapping, type ColumnMappingResult, type MappableField } from "@/types/excel";

/**
 * Smartstore (and other storefront) exports rename their columns over time
 * ("주문번호" vs "주문번호(ID)" vs "OrderNo"). Rather than hardcode one
 * header set, we recognize a list of known aliases per field and fall back
 * to a manual mapping UI for anything we can't confidently resolve.
 */
const FIELD_ALIASES: Record<MappableField, string[]> = {
  order_number: [
    "주문번호",
    "주문번호id",
    "상품주문번호",
    "주문id",
    "orderno",
    "orderid",
    "order",
    "ordernumber",
  ],
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
    "구매자명",
    "구매자",
    "recipient",
    "receivername",
    "customername",
    "buyername",
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
    "수취인주소",
    "수령인주소",
    "배송지주소",
    "배송주소",
    "주소",
    "address",
    "shippingaddress",
    "deliveryaddress",
  ],
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
  product_name: ["상품명", "품목명", "제품명", "productname", "product", "itemname"],
  option_name: ["옵션", "옵션명", "옵션정보", "구매옵션", "option", "optionname"],
  quantity: ["수량", "주문수량", "구매수량", "qty", "quantity"],
  unit_price: ["단가", "옵션가", "상품단가", "판매단가", "unitprice", "price"],
  amount: [
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
};

/** Strips whitespace, parenthetical notes, and punctuation; lowercases latin chars. */
function normalizeHeader(header: string): string {
  return header
    .replace(/[([{].*?[)\]}]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .trim();
}

export function autoMapColumns(headers: string[]): ColumnMappingResult {
  const normalizedHeaders = headers.map((h) => ({ raw: h, normalized: normalizeHeader(h) }));
  const mapping: ColumnMapping = {};
  const usedHeaders = new Set<string>();
  const unmapped: MappableField[] = [];

  for (const field of MAPPABLE_FIELDS) {
    const aliases = FIELD_ALIASES[field.key];
    let matchedHeader: string | undefined;

    // 1. exact normalized match
    for (const { raw, normalized } of normalizedHeaders) {
      if (usedHeaders.has(raw)) continue;
      if (aliases.includes(normalized)) {
        matchedHeader = raw;
        break;
      }
    }

    // 2. fallback: normalized header contains (or is contained by) an alias
    if (!matchedHeader) {
      for (const { raw, normalized } of normalizedHeaders) {
        if (usedHeaders.has(raw) || !normalized) continue;
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
