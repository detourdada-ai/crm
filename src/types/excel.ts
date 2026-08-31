/**
 * Types for the excel/csv import pipeline: raw parsing, column auto-mapping,
 * and the manual-mapping fallback the admin uses when a column can't be recognized.
 */

export type MappableField =
  | "order_number"
  | "order_date"
  | "recipient_name"
  | "phone"
  | "buyer_phone"
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
  | "bag_no"
  | "payment_status"
  | "payment_method";

/** S1-6: 컬럼 매핑 화면에서 "구분"으로 묶어 보여줄 대분류 — 사장님이 이 필드가 주문/고객/배송/상품 중 어디에 속하는지 한눈에 파악하도록. */
export type MappableFieldCategory = "주문" | "고객" | "배송" | "상품" | "결제";

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
  // STEP12-8A(CPO 작업지시, 2026-09): 스마트스토어 "수취인 연락처"는 안심번호
  // (임시 중계번호, 배송 종료 후 만료)일 때가 많다 — 기사가 실제로 통화할 수
  // 있는 번호는 대부분 구매자 본인 번호다. 구매자연락처가 매핑돼 있으면
  // import.service.ts가 그 값을 우선 사용하고, 없을 때만 수취인 연락처로
  // 폴백한다.
  { key: "phone", label: "수취인 연락처", required: false, category: "고객" },
  { key: "buyer_phone", label: "구매자 연락처", required: false, category: "고객" },
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
  // Phase 2 §5(2026-08 CPO 작업지시): 결제정보는 금전 리스크가 있어 인식 못한
  // 값을 절대 결제완료로 임의 변환하지 않는다 — import.service.ts에서 목록에
  // 없는 값은 payment_status=null("확인 필요")로 남기고 경고를 노출한다.
  // 컬럼 자체가 없으면(매핑 안 됨) 이 필드와 무관하게 기본값 결제완료로 처리.
  { key: "payment_status", label: "결제상태", required: false, category: "결제" },
  { key: "payment_method", label: "결제방법", required: false, category: "결제" },
];

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, unknown>[];
}

/**
 * STEP11-2 Phase4(CPO 작업지시, 2026-08): "오늘 주문만 접수"라는 특정 사장님의
 * 요구를 하드코딩하지 않고, "어떤 날짜 컬럼을 기준으로 어떤 날짜 범위의
 * 주문을 가져올 것인가"로 일반화한 Import 날짜 필터 정책. 조사 결과 발송일/
 * 수령일이 별도 MappableField로 독립 존재하지 않으므로(delivery_date가
 * "배송일(발송 희망일)"로 이미 그 의미를 겸한다), 새 필드를 만들지 않고
 * 기존 날짜 성격 MappableField 3개(order_date/delivery_date/shipped_at)
 * 중 실제로 매핑된 것만 기준 컬럼으로 선택할 수 있게 한다.
 */
export type ImportDateFilterField = "order_date" | "delivery_date" | "shipped_at";
export type ImportDateFilterMode = "all" | "today" | "specific_date";

export interface ImportDateFilterInput {
  /** 기본값 "all" — 기존 사용자/운영 방식에 영향을 주지 않는다(날짜 필터 미사용과 동일). */
  mode: ImportDateFilterMode;
  /** mode가 "all"이 아닐 때만 의미를 갖는다. */
  field: ImportDateFilterField;
  /** mode === "specific_date"일 때만 사용하는 KST 기준 날짜(YYYY-MM-DD). */
  date?: string;
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
 * §CPO 작업지시(누적 표준 엑셀 중복방지, 2026-08 / STEP2 재설계): Analyze 직후
 * 실행하는 중복 판정 결과 — DB에 아무 것도 쓰지 않는다(§13). "new"는 등록
 * 대상, "confirmed_duplicate"는 이미 등록된 주문이라 자동 제외, "candidate"는
 * 애매해서 사용자 확인이 필요, "error"는 부모 주문번호가 다른 계정에 이미
 * 존재해 새 부모 주문 자체를 만들 수 없는 경우, "partial"은 STEP2에서 새로
 * 생긴 상태 — 같은 부모 주문(order_number) 아래 상품주문(product_order_number)
 * 일부는 이미 등록, 일부는 신규인 "혼재 그룹"(CPO 작업지시서 Case D)이다.
 * "identity_conflict"는 주문관리·표준엑셀·배송관리 UX 개선(2026-08 CPO 작업지시)
 * Phase 1에서 추가된 상태 — product_order_number가 없는 파일(표준 엑셀 등)에서
 * 같은 order_number 그룹 안에 서로 다른 고객(이름/전화/주소)이 섞여 있는 경우다.
 * 등록하면 첫 번째 고객만 남고 나머지 고객정보가 사라지므로, 절대 자동
 * 병합하지 않고 등록 자체를 차단한다(§3-2/§4).
 * "repeat_confirm_needed"는 Phase 2(2026-08 CPO 작업지시)에서 추가된 상태 —
 * product_order_number가 없는 파일에서 같은 order_number를 쓰는 행이 2건
 * 이상이고 고객 정보(이름/전화/주소)는 전부 같은 경우다. identity_conflict와
 * 달리 고객이 같으므로 "하나의 주문(다상품)"일 수도 있지만, "같은 고객이
 * 서로 다른 시점에 주문하며 같은 번호를 실수로 반복 입력"했을 수도 있다 —
 * 시스템이 임의로 판단하지 않고 사용자가 상품/배송일을 보고 병합/분리를
 * 직접 선택해야 한다(기본값은 미등록 — 선택 전엔 등록되지 않음).
 */
export type DedupStatus = "new" | "confirmed_duplicate" | "candidate" | "error" | "partial" | "identity_conflict" | "repeat_confirm_needed";

export interface DedupOrderSnapshot {
  orderNumber: string | null;
  recipientName: string;
  phone: string | null;
  address: string | null;
  deliveryDate: string | null; // ISO
  productSummary: string; // "상품명(옵션) x수량" 형태의 표시용 요약
  deliveryStatus?: string; // 기존 주문에서만 채워짐(배차/배송중/완료 등 보호 대상 표시용)
}

/**
 * STEP2: 부모 주문(order_number) 그룹 내부의 상품주문(product_order_number)
 * 하나하나의 개별 판정 — "partial"(혼재) 그룹을 화면에 투명하게 보여주기
 * 위해 존재한다. product_order_number가 없는 파일(표준 엑셀 등)에서는 이
 * 배열 자체가 비어 있고, 그룹 전체가 기존처럼 하나의 status로만 판정된다.
 */
export interface DedupProductOrderItem {
  productOrderNumber: string;
  status: "new" | "confirmed_duplicate";
  productSummary: string;
  deliveryDate: string | null;
  /** §CPO 작업지시서 §6/QA-7 "정보 차이 표시": 이미 등록된 상품주문인데 배송일/주소가 이번 업로드 값과 다른 경우만 true. 표시만 하고 등록 여부/기존 데이터에는 영향 없음(절대 UPDATE 안 함). */
  infoDiffers?: boolean;
}

/**
 * 주문관리·표준엑셀·배송관리 UX 개선(2026-08 CPO 작업지시) §3-2/§4: "identity_conflict"
 * 그룹에서 실제로 서로 다른 고객이 몇 명이고 각각 어떤 정보인지 화면에
 * 그대로 보여주기 위한 항목 — CPO가 지정한 "좋은 예" 형식(이름·전화·주소·상품)을
 * 그대로 렌더링할 수 있게 한다.
 */
export interface DedupIdentityConflictEntry {
  recipientName: string;
  phone: string | null;
  address: string | null;
  productSummary: string;
}

/**
 * Phase 2(2026-08 CPO 작업지시) §2 "같은 주문번호 반복" 확인 UI: "repeat_confirm_needed"
 * 그룹에 속한 각 행(상품)을 그대로 보여줘 사장님이 "상품/배송일이 다르면
 * 별도 주문"이라는 CPO 지정 기준으로 직접 판단할 수 있게 한다.
 */
export interface DedupRepeatRowEntry {
  productSummary: string;
  deliveryDate: string | null; // ISO
}

export interface DedupGroupResult {
  /** import.service.ts의 groupKey와 동일한 값(주문번호, 또는 "__no_order_number_{index}") — Confirm 시 승인 목록과 연결하는 키. */
  groupKey: string;
  status: DedupStatus;
  reason: string;
  upload: DedupOrderSnapshot;
  /** confirmed_duplicate/candidate일 때만 존재 — 비교 대상 기존 주문. */
  existing?: DedupOrderSnapshot;
  /** status가 "partial"일 때만 존재 — 그룹 내 상품주문별 개별 판정. */
  productOrderItems?: DedupProductOrderItem[];
  /** status가 "identity_conflict"일 때만 존재 — 그룹 안에서 실제로 발견된 서로 다른 고객 목록(전부, 중복 제거). */
  conflictingIdentities?: DedupIdentityConflictEntry[];
  /** status가 "repeat_confirm_needed"일 때만 존재 — 이 order_number를 공유하는 행(상품)별 정보. */
  repeatRows?: DedupRepeatRowEntry[];
}

export interface DedupAnalysis {
  /** 부모 주문(또는 주문번호 없는 개별 행) 그룹 수 — 화면 카드 단위. */
  totalGroups: number;
  /** STEP2: 실제 엑셀 행(=상품주문) 총수 — totalGroups와 별개로, "421건 중 몇 건이 실제로 신규/기존인지"를 정확히 보고하기 위한 숫자. */
  totalProductOrders: number;
  /** 상품주문 단위로 신규 판정된 건수(product_order_number가 없는 그룹은 그룹 자체를 1건으로 센다). */
  newCount: number;
  /** 상품주문 단위로 이미 등록된 것으로 판정된 건수. */
  confirmedDuplicateCount: number;
  candidateCount: number;
  errorCount: number;
  /** §3-2/§4: 서로 다른 고객이 같은 주문번호를 써서 자동 등록이 차단된 상품주문(행) 수. */
  identityConflictCount: number;
  /** Phase 2 §2: 같은 고객이 같은 주문번호를 반복 사용해 병합/분리 확인이 필요한 상품주문(행) 수 — 사용자가 선택하기 전엔 등록되지 않는다. */
  repeatConfirmCount: number;
  /** Phase 2 §5(2026-08 CPO 작업지시): 결제상태 컬럼 값이 표준 4개와 달라 결제완료로 임의 변환하지 않고 "확인 필요"로 남긴 그룹 수 — 금전 리스크 경고용. */
  unrecognizedPaymentStatusCount: number;
  /** STEP11-2 Phase4: 날짜 필터 조건에 맞지 않아 애초에 신규/중복 판정 대상에서 제외된 상품주문(행) 수 — 중복도 실패도 아닌 별도 집계(§4 "날짜 제외 ≠ 중복"). */
  dateExcludedCount: number;
  groups: DedupGroupResult[];
}
