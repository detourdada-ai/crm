/**
 * Core domain types shared across services, repositories, and UI.
 * These mirror the Supabase schema defined in supabase/schema.sql.
 */

export type UUID = string;
export type ISODateString = string;

// Sprint 8 (SaaS foundation): tenant_id runs in parallel with owner_username
// on the tables below. owner_username stays the ACTIVE read/filter boundary
// for now — tenant_id is populated on new writes, preparing a future cutover
// (see supabase/migrations/0014_saas_foundation.sql for the full rationale).
export type TenantStatus = "active" | "suspended";
export type PlanCode = "STARTER" | "BASIC" | "PRO" | "BUSINESS";
export type MembershipRole = "OWNER" | "ADMIN" | "STAFF" | "DRIVER";
export type MembershipStatus = "active" | "inactive";

// Sprint 11: "what they're subscribed to" (plan) vs "can they use the
// service right now" (access) — kept separate so a Beta trial doesn't need
// a fake plan row. EffectiveAccessStatus is the computed, request-time
// answer to "let them in or not" (see src/lib/auth/access-control.ts).
export type AccessType = "NONE" | "BETA" | "SUBSCRIPTION";
export type AccessKeyType = "BETA" | "SUBSCRIPTION";
// Sprint 12: 'used' — claimed by whichever Seller redeems it via /subscription.
export type AccessKeyStatus = "active" | "revoked" | "used";
export type EffectiveAccessStatus = "ACTIVE_BETA" | "ACTIVE_SUBSCRIPTION" | "NONE" | "EXPIRED" | "SUSPENDED";

export interface Plan {
  id: UUID;
  code: PlanCode;
  name: string;
  created_at: ISODateString;
}

export interface Tenant {
  id: UUID;
  name: string;
  slug: string;
  status: TenantStatus;
  plan_id: UUID | null;
  access_type: AccessType;
  access_expires_at: ISODateString | null;
  beta_welcome_email_sent_at: ISODateString | null;
  beta_ended_email_sent_at: ISODateString | null;
  // Phase 10: industry는 추천값 산정용 프로필일 뿐 — 기능 사용 여부는 별도
  // feature 컬럼(bag_management 등)이 결정하며 industry로 자동 강제되지 않는다.
  industry: string | null;
  bag_management: boolean;
  // ACC: 사장님 "내 프로필" — tenants.name(업체명)과는 별개인 개인 이름/연락처.
  // 본인이 직접 수정하며 Admin CS 계정관리(username)와는 무관하다.
  contact_name: string | null;
  contact_phone: string | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface Membership {
  id: UUID;
  username: string;
  tenant_id: UUID;
  role: MembershipRole;
  status: MembershipStatus;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export type DuplicateMatchType =
  | "exact_duplicate" // CASE0: name+phone+address_normalized all identical (retroactive scan)
  | "phone_changed" // CASE1: same name+address, different phone
  | "address_changed" // CASE2: same phone, different address
  | "shipping_changed" // CASE3: same name+phone, different address
  | "family" // CASE4: same address, similar name, different phone
  | "phone_changed_likely"; // CASE5: different phone, same address, similar name

export type DuplicateConfidence = "HIGH" | "MEDIUM";

export type DuplicateStatus = "pending" | "merged" | "rejected" | "held";

export type CustomerStatus = "active" | "dormant" | "watchlist" | "blocked" | "merged";

// Phase 1: 지오코딩 결과 상태. "failed"여도 원본 주소 저장/주문 생성은 항상 성공한다 — 이 값은 관리자가 미처리 건을 확인하기 위한 플래그일 뿐이다.
export type GeocodeStatus = "pending" | "success" | "failed";

export interface Customer {
  id: UUID;
  customer_code: string; // e.g. C000001, immutable, the true identity key
  name: string;
  phone: string | null; // normalized 010-1234-1234
  address: string | null; // F6~F10: composed display value = road_address + detail_address
  address_normalized: string | null;
  postal_code: string | null;
  road_address: string | null;
  detail_address: string | null;
  // Phase 1: 좌표/행정구역 — 지역 코드는 카카오 로컬 API 법정동코드(b_code)에서 파생.
  latitude: number | null;
  longitude: number | null;
  sido: string | null;
  sigungu: string | null;
  eupmyeondong: string | null;
  sido_code: string | null;
  sigungu_code: string | null;
  eupmyeondong_code: string | null;
  geocode_status: GeocodeStatus;
  geocoded_at: ISODateString | null;
  memo: string | null;
  tags: string[];
  owner_username: string; // account that owns/manages this customer; "admin" sees all
  tenant_id: UUID; // Sprint 8: parallel structure, not yet the active read boundary
  is_favorite: boolean;
  status: CustomerStatus;
  merged_into_id: UUID | null; // set when status = "merged"; points at the surviving customer
  bag_no: string | null; // usual delivery bag number for this customer (default for new orders)
  created_by_import_id: UUID | null; // set only if a specific import first created this customer
  created_at: ISODateString;
  updated_at: ISODateString;
}

// Freeform: Smartstore's own status text (배송중/구매확정/취소 등) is stored
// verbatim rather than translated into a fixed enum — see schema.sql.
export type OrderStatus = string;

// F6~F10: 사업자가 실제로 주문을 받은 채널. 엑셀 자동 업로드 파이프라인
// 여부는 order_source가 아니라 Order.import_id로 구분한다.
export type OrderSource = "전화" | "문자" | "SNS" | "엑셀" | "기타";

// Internal delivery workflow status, distinct from the freeform Smartstore
// `status` passthrough text. Driven by driver assignment/completion/cancellation.
// Phase 2: "취소" added — a soft-cancel state, never a physical delete.
export type DeliveryStatus = "배송대기" | "배송중" | "완료" | "취소";

/** P5: 배송(기사 경유) / 직접수령(고객이 매장에서 직접 받음) — driver_id와 독립된 축. */
export type FulfillmentMethod = "delivery" | "direct_pickup";

export interface Order {
  id: UUID;
  customer_id: UUID;
  order_number: string | null; // 원본(엑셀/스마트스토어) 주문번호 — null for manual orders without one
  internal_order_number: string; // Phase 5: 시스템 내부 고유 주문번호(YYYYMMDD+4자리, 테넌트별), 모든 주문에 항상 존재
  order_date: ISODateString;
  status: OrderStatus;
  total_amount: number;
  // Snapshot fields: captured at order time, never mutated when customer changes
  recipient_name: string;
  phone_snapshot: string | null;
  address_snapshot: string | null; // composed display value = road_address_snapshot + detail_address_snapshot
  road_address_snapshot: string | null;
  detail_address_snapshot: string | null;
  zipcode: string | null; // = postal_code
  // Phase 1: 이 주문 생성 시점 배송지의 좌표/행정구역 — customers의 값과
  // 독립적이며, 고객 프로필이 바뀌어도 절대 갱신되지 않는다(snapshot).
  latitude: number | null;
  longitude: number | null;
  sido: string | null;
  sigungu: string | null;
  eupmyeondong: string | null;
  sido_code: string | null;
  sigungu_code: string | null;
  eupmyeondong_code: string | null;
  geocode_status: GeocodeStatus;
  geocoded_at: ISODateString | null;
  delivery_memo: string | null;
  order_memo: string | null;
  internal_memo: string | null;
  courier: string | null;
  tracking_number: string | null;
  sales_channel: string | null;
  buyer_name: string | null;
  buyer_id: string | null;
  shipped_at: ISODateString | null;
  delivery_date: ISODateString | null; // parsed from 옵션정보 at import time, or set manually
  delivery_area: string | null; // parsed from 옵션정보 alongside delivery_date
  bag_number: string | null;
  bag_returned: boolean;
  order_source: OrderSource;
  delivery_status: DeliveryStatus;
  /** P5: "직접수령" — driver_id를 가짜로 채우지 않고 별도 컬럼으로 관리한다. */
  fulfillment_method: FulfillmentMethod;
  driver_id: UUID | null;
  delivery_group_id: UUID | null;
  completed_at: ISODateString | null;
  cancelled_at: ISODateString | null;
  import_id: UUID | null;
  owner_username: string;
  tenant_id: UUID;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export type DriverStatus = "active" | "inactive";

export interface Driver {
  id: UUID;
  name: string;
  phone: string | null;
  address: string | null;
  vehicle_number: string | null;
  status: DriverStatus;
  rate_per_delivery: number;
  owner_username: string;
  tenant_id: UUID;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * S2-C: 기사 운행시작/운행종료 + 참고용 최근 위치. 배송 상태(order_shipments.
 * delivery_status)를 절대 결정하지 않는다 — 기사 배정 시점에 이미 배송중으로
 * 바뀌어 있고, 이 레코드는 그 위에 얹는 별도의 운영 기록일 뿐이다. 위치는
 * 이력이 아니라 "가장 최근 값" 하나만 덮어쓴다.
 */
export interface DriverShift {
  id: UUID;
  driver_id: UUID;
  shift_date: string; // "YYYY-MM-DD" (KST 달력일)
  started_at: ISODateString | null;
  ended_at: ISODateString | null;
  last_latitude: number | null;
  last_longitude: number | null;
  last_location_at: ISODateString | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

// Phase 1: 기사 담당지역 — sigungu/eupmyeondong이 null이면 그 상위 단계
// 전체를 담당한다는 뜻이다(예: sigungu=null → 시/도 전체).
export interface DriverRegion {
  id: UUID;
  driver_id: UUID;
  sido: string;
  sigungu: string | null;
  eupmyeondong: string | null;
  owner_username: string;
  tenant_id: UUID;
  created_at: ISODateString;
}

// Phase 4: 배송 그룹 — "특정 배송일에 좌표상 50m 이내로 연결된 주문들의
// 묶음"의 스냅샷. status는 저장하지 않고 driver_id 유무 + 구성원 주문들의
// delivery_status로 매번 계산한다(actions/delivery-groups.ts 참고).
export interface DeliveryGroup {
  id: UUID;
  tenant_id: UUID;
  owner_username: string;
  delivery_date: string; // YYYY-MM-DD (KST calendar day)
  group_no: number;
  center_latitude: number;
  center_longitude: number;
  order_count: number;
  representative_sido: string | null;
  representative_sigungu: string | null;
  representative_eupmyeondong: string | null;
  driver_id: UUID | null;
  radius_meters: number;
  created_at: ISODateString;
  updated_at: ISODateString;
}

// S1-1: 주문(결제 묶음, orders)과 배송건(실제 배송 운영 단위)을 분리한다.
// 같은 주문번호 안에서도 상품주문(order_items)별 발송일이 다르면 서로 다른
// 배송건이 된다 — 자세한 배경은 supabase/migrations/0038_order_shipments.sql
// 참고. orders의 동명 컬럼들(driver_id 등)은 과도기 동안 병행 유지된다.
export interface OrderShipment {
  id: UUID;
  order_id: UUID;
  tenant_id: UUID;
  owner_username: string;
  delivery_date: ISODateString | null;
  driver_id: UUID | null;
  delivery_status: DeliveryStatus;
  fulfillment_method: FulfillmentMethod;
  bag_number: string | null;
  bag_returned: boolean;
  completed_at: ISODateString | null;
  cancelled_at: ISODateString | null;
  delivery_group_id: UUID | null;
  /** S2-B: 기사별·배송일별 방문 순서(1부터). 아직 지정되지 않았으면 null. */
  route_order: number | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

// Phase 3-B: 상품 카탈로그 — tenant별 완전 격리. name/unit_price는 "현재"
// 값이며, 이미 생성된 order_items의 product_name/unit_price(주문 당시
// 스냅샷)에는 영향을 주지 않는다.
export interface Product {
  id: UUID;
  name: string;
  unit_price: number;
  is_active: boolean;
  owner_username: string;
  tenant_id: UUID;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export type SettlementStatus = "unpaid" | "paid";

export interface Settlement {
  id: UUID;
  driver_id: UUID;
  period_start: string; // date, e.g. "2026-07-01"
  period_end: string;
  delivery_count: number;
  amount: number;
  status: SettlementStatus;
  paid_at: ISODateString | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface OrderItem {
  id: UUID;
  order_id: UUID;
  /** STEP2(누적 스마트스토어 중복판정 재설계, 2026-08): order_shipments와 같은 이유로 비정규화 — product_order_number를 tenant 범위로 UNIQUE 강제하기 위한 partial index(tenant_id, product_order_number)에 필요하다. */
  tenant_id: UUID;
  /** S1-1: 이 상품주문이 속한 배송건. 어느 발송일 그룹에 묶였는지 — 같은 order_id라도 shipment_id가 다르면 발송일이 다르다는 뜻이다. */
  shipment_id: UUID | null;
  product_order_number: string | null;
  product_code: string | null;
  // Phase 3-B: 상품 카탈로그에서 선택해 생성된 경우에만 채워지는 참조(nullable)
  // — product_name/unit_price는 이 필드와 무관하게 항상 주문 당시 스냅샷이다.
  product_id: UUID | null;
  product_name: string;
  option_name: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  // Full original excel row (header -> value), preserved so nothing from
  // the source file is lost even where we don't model a column explicitly.
  extra: Record<string, unknown>;
  created_at: ISODateString;
}

export type ImportStatus = "processing" | "completed" | "failed";

/**
 * P5: 261 → 157 같은 숫자 차이를 "임의로 정상 처리"라고 뭉개지 않도록 원본
 * 행/주문그룹/신규생성/이미존재/실패를 각각 구분해 반환한다. totalRawRows는
 * 엑셀 원본 행(상품 라인 단위) 수, totalOrderGroups는 그 행들을 주문번호로
 * 묶은 그룹 수(주문번호별 여러 상품 라인이 하나로 합쳐짐) — 이 둘의 차이는
 * 유실이 아니라 "한 주문에 여러 상품"인 경우가 대부분이다.
 * P8 3번: newOrders/repeatOrders는 "고객 레코드가 새로 생겼는지"가 아니라
 * "이 주문이 그 고객의 진짜 첫 주문인지"로 정의한다(customer_order_stats
 * 기준) — 기존 고객이어도 이전 주문이 0건이면 신규 주문으로 잡힌다.
 */
export interface ImportSummary {
  totalRawRows: number;
  totalOrderGroups: number;
  newOrdersCreated: number;
  alreadyImportedOrders: number;
  /** S1-4: 상품주문(엑셀 원본 행) 기준 — 주문 건수가 아니다. */
  newOrders: number;
  /** S1-4: 상품주문(엑셀 원본 행) 기준 — 주문 건수가 아니다. */
  repeatOrders: number;
  /** S1-4: 이번 업로드에서 실제로 새로 생성된 고객 수(기존 고객 매칭 재사용은 제외). */
  newCustomers: number;
  duplicateCandidates: number;
  failedRows: number;
  /** P10-1.5: 생성된 주문 중 배송지 좌표가 확보된/실패한 건수 (기사후보 추천·배송그룹 클러스터링의 입력 데이터). */
  geocodeSuccess: number;
  geocodeFailed: number;
  /** CPO 정책(2026-08): 주문번호 컬럼이 없어(또는 비어 있어) 행 단위로 개별 주문 처리된 상품주문 행 수. */
  rowsWithoutOrderNumber: number;
  /** CPO 정책(2026-08): 배송일을 어디서도 찾지 못해(옵션정보/배송일 컬럼 둘 다 없음) "배송일 미지정"으로 생성된 주문 수 — 업로드 결과 화면의 일괄 지정 대상. */
  missingDeliveryDateOrders: number;
  /** §CPO 작업지시(누적 표준 엑셀 중복방지, 2026-08): 중복 후보로 분류됐지만 사용자가 승인하지 않아 등록되지 않은 상품주문(행) 수 — §24 자동 제외 투명성. */
  candidateSkippedRows: number;
  /** 위와 동일한 개념의 주문(그룹) 수. */
  candidateSkippedOrders: number;
}

export interface ImportRecord {
  id: UUID;
  file_name: string;
  status: ImportStatus;
  total_rows: number;
  success_rows: number;
  failed_rows: number;
  new_customers: number;
  existing_customers: number;
  duplicate_candidates: number;
  /** P5: success_rows 중 "이번 실행에서 이미 등록되어 건너뛴" 행 수(하위 집합). */
  already_imported_rows: number;
  column_mapping: Record<string, string> | null;
  error_log: ImportRowError[] | null;
  owner_username: string;
  tenant_id: UUID;
  created_at: ISODateString;
}

export type ImportErrorCode = "missing_order_number" | "missing_contact_info" | "processing_error" | "order_number_conflict";

export interface ImportRowError {
  row: number;
  code: ImportErrorCode;
  reason: string;
  raw: Record<string, unknown>;
}

export interface DuplicateCandidate {
  id: UUID;
  existing_customer_id: UUID;
  new_customer_id: UUID;
  import_id: UUID | null;
  match_type: DuplicateMatchType;
  confidence: DuplicateConfidence;
  reason: string;
  status: DuplicateStatus;
  owner_username: string;
  tenant_id: UUID;
  created_at: ISODateString;
  resolved_at: ISODateString | null;
}

export type MergeAction = "merge" | "reject" | "hold";

export interface MergeHistoryRecord {
  id: UUID;
  duplicate_candidate_id: UUID | null;
  kept_customer_id: UUID;
  removed_customer_id: UUID;
  orders_moved: number;
  performed_by: string;
  created_at: ISODateString;
}

export type ChangeLogEntity = "customer_phone" | "customer_address" | "customer_merge" | "customer_info";

export interface CustomerChangeLog {
  id: UUID;
  customer_id: UUID;
  entity: ChangeLogEntity;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  performed_by: string;
  created_at: ISODateString;
}

export interface CustomerStats {
  totalOrders: number;
  totalAmount: number;
  averageAmount: number;
  firstOrderAt: ISODateString | null;
  lastOrderAt: ISODateString | null;
}

export interface CustomerWithStats extends Customer {
  stats: CustomerStats;
}

// Beta 고객 모집 전환: 플랫폼 레벨(테넌트 무관) 공개 폼 2종.
// Phase 9: 지원 진행 상태 + 인터뷰 결과 기록 + 문제 분류(모집 지원 검증 워크플로우).
export type RecruitApplicationStatus = "신규" | "연락예정" | "인터뷰완료" | "Beta후보" | "Beta참여" | "보류";

// Section 8: 문제 반복성 파악용 고정 10개 카테고리 (기능 분류가 아니라 패턴 발견 목적).
export const PROBLEM_CATEGORIES = [
  "주문접수",
  "고객관리",
  "주문정리",
  "담당자배정",
  "배송관리",
  "배송상태",
  "완료관리",
  "고객문의",
  "정산",
  "기타",
] as const;
export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

export interface BetaRecruitApplication {
  id: UUID;
  company_name: string | null;
  business_type: string;
  avg_daily_orders: string | null;
  order_channels: string[];
  delivery_method: string | null;
  staff_count: string | null;
  driver_count: string | null;
  current_order_management: string | null;
  current_delivery_management: string | null;
  uses_excel: boolean;
  uses_kakao_sms: boolean;
  biggest_pain_point: string | null;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  created_at: ISODateString;
  status: RecruitApplicationStatus;
  interview_notes: string | null;
  // Section 7: 구조화된 인터뷰 결과 기록.
  problem: string | null;
  current_solution: string | null;
  frequency: string | null;
  severity: string | null;
  current_workaround: string | null;
  product_fit: string | null;
  problem_categories: ProblemCategory[];
}

export type InquiryStatus = "접수" | "확인중" | "답변완료";
// Phase 9 Section 16: 문의 유형 분류 — "기능요청"은 바로 개발하지 않고 인터뷰 데이터와
// 교차 참조하기 위한 분류일 뿐, 별도 처리 로직을 갖지 않는다.
export type InquiryCategory = "버그" | "사용법" | "불편사항" | "기능요청" | "기타";

export interface Inquiry {
  id: UUID;
  name: string;
  contact: string;
  title: string;
  message: string;
  status: InquiryStatus;
  admin_reply: string | null;
  replied_at: ISODateString | null;
  created_at: ISODateString;
  updated_at: ISODateString;
  category: InquiryCategory;
}
