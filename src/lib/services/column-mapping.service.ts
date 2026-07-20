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
const FIELD_ALIASES: Record<MappableField, string[]> = {
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
  order_status: ["주문상태", "orderstatus", "status"],
  courier: ["택배사", "courier", "carrier"],
  tracking_number: ["송장번호", "운송장번호", "trackingnumber", "invoicenumber"],
  sales_channel: ["판매채널", "channel", "saleschannel"],
  buyer_name: ["구매자명", "구매자", "buyername", "buyer"],
  buyer_id: ["구매자id", "구매자아이디", "buyerid"],
  shipped_at: ["배송완료일", "배송일", "shippedat", "deliverydate"],
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
