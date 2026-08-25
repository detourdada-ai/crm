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
  | "delivery_date"
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
  // STD-10 최종검증에서 발견: 일반 엑셀(전화/문자 주문 등)은 "주문일시" 컬럼
  // 자체가 없는 경우가 흔한데, 이게 필수로 막혀 있으면 ColumnMappingForm의
  // 확정 버튼이 비활성화되어 업로드 자체가 불가능했다. import.service.ts의
  // parseOrderDate(undefined)는 이미 안전하게 오늘 날짜로 폴백하므로(백엔드
  // 검증됨) UI 필수 표시만 과도했다.
  { key: "order_date", label: "주문일시(결제일)", required: false, category: "주문" },
  // CPO 정책(2026-08, STEP1 재정리): 이 3개 필드는 UI에서만 required였고
  // 실제 backend(import.service.ts)는 절대 이걸로 행을 막지 않는다 —
  // recipient_name이 비면 구매자명→구매자ID→"이름 미확인"으로 폴백한다.
  // 연락처/주소는 "둘 다" 없을 때만(missing_contact_info) 그 행이 실패하고,
  // 하나라도 있으면 통과한다 — 그래서 개별 필드로는 required를 걸 수 없다
  // (실제 union 제약은 ColumnMappingForm이 아니라 import.service.ts의 행별
  // 검증에서만 표현 가능하고, 이미 그렇게 동작한다). 표준 템플릿 가이드가
  // 실제 검증과 어긋나지 않도록 UI 표시만 실제 동작에 맞춰 완화한다.
  { key: "recipient_name", label: "수취인명", required: false, category: "고객" },
  { key: "phone", label: "수취인 연락처", required: false, category: "고객" },
  { key: "address", label: "배송지 주소", required: false, category: "배송" },
  { key: "zipcode", label: "우편번호", required: false, category: "배송" },
  { key: "delivery_memo", label: "배송메모", required: false, category: "배송" },
  // CPO 정책(2026-08): 일반 엑셀에는 배송일 컬럼이 아예 없는 경우가 흔해
  // "배송일 미지정" 상태로 조용히 오늘 화면에서 빠지는 게 베타 전 반드시
  // 고쳐야 할 문제로 지적됨 — 표준 템플릿에 배송일을 기본 컬럼으로 포함하고,
  // 이 필드를 매핑해 직접 값을 채울 수 있게 한다(옵션정보 안에 날짜가 박힌
  // 스마트스토어 케이스와는 별개 경로 — import.service.ts에서 옵션 파싱이
  // 실패했을 때만 이 값으로 폴백한다).
  { key: "delivery_date", label: "배송일(발송 희망일)", required: false, category: "배송" },
  { key: "order_status", label: "주문상태", required: false, category: "주문" },
  { key: "courier", label: "택배사", required: false, category: "배송" },
  { key: "tracking_number", label: "송장번호", required: false, category: "배송" },
  { key: "sales_channel", label: "판매채널", required: false, category: "주문" },
  { key: "buyer_name", label: "구매자명", required: false, category: "고객" },
  { key: "buyer_id", label: "구매자ID", required: false, category: "고객" },
  { key: "shipped_at", label: "배송완료일", required: false, category: "배송" },
  { key: "product_order_number", label: "상품주문번호", required: false, category: "상품" },
  { key: "product_code", label: "상품번호/코드", required: false, category: "상품" },
  // product_name/quantity도 마찬가지 — 비어 있으면 각각 "상품"/1로
  // 폴백한다(import.service.ts). UI 필수 표시가 backend보다 과도했다.
  { key: "product_name", label: "상품명", required: false, category: "상품" },
  { key: "option_name", label: "옵션명", required: false, category: "상품" },
  { key: "quantity", label: "수량", required: false, category: "상품" },
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

/**
 * §CPO 작업지시(누적 표준 엑셀 중복방지, 2026-08): Analyze 직후 실행하는 중복
 * 판정 결과 — DB에 아무 것도 쓰지 않는다(§13). "new"는 등록 대상, "confirmed_duplicate"는
 * 이미 등록된 주문이라 자동 제외, "candidate"는 애매해서 사용자 확인이 필요,
 * "error"는 이미 다른 계정이 쓰고 있는 주문번호 등 등록 자체가 불가능한 행.
 */
export type DedupStatus = "new" | "confirmed_duplicate" | "candidate" | "error";

export interface DedupOrderSnapshot {
  orderNumber: string | null;
  recipientName: string;
  phone: string | null;
  address: string | null;
  deliveryDate: string | null; // ISO
  productSummary: string; // "상품명(옵션) x수량" 형태의 표시용 요약
  deliveryStatus?: string; // 기존 주문에서만 채워짐(배차/배송중/완료 등 보호 대상 표시용)
}

export interface DedupGroupResult {
  /** import.service.ts의 groupKey와 동일한 값(주문번호, 또는 "__no_order_number_{index}") — Confirm 시 승인 목록과 연결하는 키. */
  groupKey: string;
  status: DedupStatus;
  reason: string;
  upload: DedupOrderSnapshot;
  /** confirmed_duplicate/candidate일 때만 존재 — 비교 대상 기존 주문. */
  existing?: DedupOrderSnapshot;
}

export interface DedupAnalysis {
  totalGroups: number;
  newCount: number;
  confirmedDuplicateCount: number;
  candidateCount: number;
  errorCount: number;
  groups: DedupGroupResult[];
}
