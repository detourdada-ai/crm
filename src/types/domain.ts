/**
 * Core domain types shared across services, repositories, and UI.
 * These mirror the Supabase schema defined in supabase/schema.sql.
 */

export type UUID = string;
export type ISODateString = string;

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
  address: string | null;
  address_normalized: string | null;
  memo: string | null;
  tags: string[];
  owner_username: string; // account that owns/manages this customer; "admin" sees all
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

export type OrderSource = "import" | "manual";

// Internal delivery workflow status, distinct from the freeform Smartstore
// `status` passthrough text. Driven by driver assignment/completion.
export type DeliveryStatus = "배송대기" | "배송중" | "완료";

export interface Order {
  id: UUID;
  customer_id: UUID;
  order_number: string | null; // null for manual orders without a smartstore order number
  order_date: ISODateString;
  status: OrderStatus;
  total_amount: number;
  // Snapshot fields: captured at order time, never mutated when customer changes
  recipient_name: string;
  phone_snapshot: string | null;
  address_snapshot: string | null;
  zipcode: string | null;
  delivery_memo: string | null;
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
  import_id: UUID | null;
  owner_username: string;
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
