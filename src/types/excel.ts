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
  | "amount";

export const MAPPABLE_FIELDS: { key: MappableField; label: string; required: boolean }[] = [
  { key: "order_number", label: "주문번호", required: true },
  { key: "order_date", label: "주문일시(결제일)", required: true },
  { key: "recipient_name", label: "수취인명", required: true },
  { key: "phone", label: "수취인 연락처", required: true },
  { key: "address", label: "배송지 주소", required: true },
  { key: "zipcode", label: "우편번호", required: false },
  { key: "delivery_memo", label: "배송메모", required: false },
  { key: "order_status", label: "주문상태", required: false },
  { key: "courier", label: "택배사", required: false },
  { key: "tracking_number", label: "송장번호", required: false },
  { key: "sales_channel", label: "판매채널", required: false },
  { key: "buyer_name", label: "구매자명", required: false },
  { key: "buyer_id", label: "구매자ID", required: false },
  { key: "shipped_at", label: "배송완료일", required: false },
  { key: "product_order_number", label: "상품주문번호", required: false },
  { key: "product_code", label: "상품번호/코드", required: false },
  { key: "product_name", label: "상품명", required: true },
  { key: "option_name", label: "옵션명", required: false },
  { key: "quantity", label: "수량", required: true },
  { key: "unit_price", label: "단가", required: false },
  { key: "amount", label: "금액", required: true },
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
