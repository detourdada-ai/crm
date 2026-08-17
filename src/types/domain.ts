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
  driver_id: UUID | null;
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
  product_order_number: string | null;
  product_code: string | null;
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

export interface ImportSummary {
  totalOrders: number;
  newCustomers: number;
  existingCustomers: number;
  duplicateCandidates: number;
  failedRows: number;
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
  column_mapping: Record<string, string> | null;
  error_log: ImportRowError[] | null;
  owner_username: string;
  tenant_id: UUID;
  created_at: ISODateString;
}

export interface ImportRowError {
  row: number;
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
