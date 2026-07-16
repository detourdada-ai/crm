/**
 * Core domain types shared across services, repositories, and UI.
 * These mirror the Supabase schema defined in supabase/schema.sql.
 */

export type UUID = string;
export type ISODateString = string;

export type DuplicateMatchType =
  | "phone_changed" // CASE1: same name+address, different phone
  | "address_changed" // CASE2: same phone, different address
  | "shipping_changed" // CASE3: same name+phone, different address
  | "family" // CASE4: same address, similar name, different phone
  | "phone_changed_likely"; // CASE5: different phone, same address, similar name

export type DuplicateConfidence = "HIGH" | "MEDIUM";

export type DuplicateStatus = "pending" | "merged" | "rejected" | "held";

export interface Customer {
  id: UUID;
  customer_code: string; // e.g. C000001, immutable, the true identity key
  name: string;
  phone: string | null; // normalized 010-1234-1234
  address: string | null;
  address_normalized: string | null;
  memo: string | null;
  tags: string[];
  created_at: ISODateString;
  updated_at: ISODateString;
}

export type OrderStatus = "pending" | "confirmed" | "shipped" | "completed" | "cancelled";

export interface Order {
  id: UUID;
  customer_id: UUID;
  order_number: string; // from smartstore excel, unique per import source
  order_date: ISODateString;
  status: OrderStatus;
  total_amount: number;
  // Snapshot fields: captured at order time, never mutated when customer changes
  recipient_name: string;
  phone_snapshot: string | null;
  address_snapshot: string | null;
  delivery_memo: string | null;
  import_id: UUID | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface OrderItem {
  id: UUID;
  order_id: UUID;
  product_name: string;
  option_name: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
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
