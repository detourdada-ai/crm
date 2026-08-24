/**
 * Types for the excel/csv import pipeline: raw parsing, column auto-mapping,
 * and the manual-mapping fallback the admin uses when a column can't be recognized.
 */

export type MappableField =
  | "order_number"
  | "order_date"
  | "recipient_name"
  | "phone"
  | "address"
  | "zipcode"
  | "delivery_memo"
  | "order_status"
  | "courier"
  | "tracking_number"
  | "sales_channel"
  | "buyer_name"
  | "buyer_id"
  | "shipped_at"
  | "product_order_number"
  | "product_code"
  | "product_name"
  | "option_name"
  | "quantity"
  | "unit_price"
  | "amount"
  | "bag_no";

/** S1-6: 컬럼 매핑 화면에서 "구분"으로 묶어 보여줄 대분류 — 사장님이 이 필드가 주문/고객/배송/상품 중 어디에 속하는지 한눈에 파악하도록. */
export type MappableFieldCategory = "주문" | "고객" | "배송" | "상품";

export const MAPPABLE_FIELDS: { key: MappableField; label: string; required: boolean; category: MappableFieldCategory }[] = [
  // 베타 오픈 준비 — 주문 데이터 표준화: 스마트스토어 등 채널 주문에만 있는
  // 값이라 일반 엑셀(전화/문자 주문 등)에는 없는 경우가 많다. 비어 있으면
  // import.service.ts가 그 행을 독립된 주문 1건으로 처리한다.
  { key: "order_number", label: "주문번호", required: false, category: "주문" },
  { key: "order_date", label: "주문일시(결제일)", required: true, category: "주문" },
  { key: "recipient_name", label: "수취인명", required: true, category: "고객" },
  { key: "phone", label: "수취인 연락처", required: true, category: "고객" },
  { key: "address", label: "배송지 주소", required: true, category: "배송" },
  { key: "zipcode", label: "우편번호", required: false, category: "배송" },
  { key: "delivery_memo", label: "배송메모", required: false, category: "배송" },
  { key: "order_status", label: "주문상태", required: false, category: "주문" },
  { key: "courier", label: "택배사", required: false, category: "배송" },
  { key: "tracking_number", label: "송장번호", required: false, category: "배송" },
  { key: "sales_channel", label: "판매채널", required: false, category: "주문" },
  { key: "buyer_name", label: "구매자명", required: false, category: "고객" },
  { key: "buyer_id", label: "구매자ID", required: false, category: "고객" },
  { key: "shipped_at", label: "배송완료일", required: false, category: "배송" },
  { key: "product_order_number", label: "상품주문번호", required: false, category: "상품" },
  { key: "product_code", label: "상품번호/코드", required: false, category: "상품" },
  { key: "product_name", label: "상품명", required: true, category: "상품" },
  { key: "option_name", label: "옵션명", required: false, category: "상품" },
  { key: "quantity", label: "수량", required: true, category: "상품" },
  { key: "unit_price", label: "단가", required: false, category: "상품" },
  // 금액이 없으면 0으로 처리된다(import.service.ts parseNumber 기본값) — 판매금액을
  // 관리하지 않는 사업장(반찬/도시락 등)의 일반 엑셀에는 없는 경우가 많다.
  { key: "amount", label: "금액", required: false, category: "상품" },
  { key: "bag_no", label: "가방번호", required: false, category: "배송" },
];

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, unknown>[];
}

export interface ColumnMapping {
  // Maps our internal field key -> the source column header found in the uploaded file
  [key: string]: string | undefined;
}

export interface ColumnMappingResult {
  mapping: ColumnMapping;
  unmapped: MappableField[]; // required fields the auto-mapper could not resolve
  unrecognizedHeaders: string[]; // source headers that didn't match any known field
}
