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
  | "delivery_memo"
  | "product_name"
  | "option_name"
  | "quantity"
  | "unit_price"
  | "amount";

export const MAPPABLE_FIELDS: { key: MappableField; label: string; required: boolean }[] = [
  { key: "order_number", label: "주문번호", required: true },
  { key: "order_date", label: "주문일시", required: true },
  { key: "recipient_name", label: "수령인/주문자명", required: true },
  { key: "phone", label: "전화번호", required: true },
  { key: "address", label: "주소", required: true },
  { key: "delivery_memo", label: "배송메모", required: false },
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
