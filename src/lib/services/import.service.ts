import "server-only";
import { randomUUID } from "node:crypto";
import { ordersRepository, type OrderInsert, type OrderItemInsert } from "@/lib/repositories/orders.repository";
import { importsRepository } from "@/lib/repositories/imports.repository";
import { duplicatesRepository, type DuplicateCandidateInsert } from "@/lib/repositories/duplicates.repository";
import { customersRepository, type CustomerInsert } from "@/lib/repositories/customers.repository";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { isSimilarButNotIdenticalName } from "@/lib/utils/similarity";
import { formatPhoneNumber } from "@/lib/utils/phone";
import { cleanAddress, normalizeAddressForCompare } from "@/lib/utils/address";
import { parseDeliveryDateFromOption, parseDeliveryAreaFromOption } from "@/lib/utils/delivery-date";
import { allocateOrderNumbers } from "@/lib/services/order-number.service";
import type { ParsedSheet, ColumnMapping } from "@/types/excel";
import type { Customer, ImportRowError, ImportSummary } from "@/types/domain";

export interface RunImportInput {
  fileName: string;
  parsed: ParsedSheet;
  mapping: ColumnMapping;
  ownerUsername: string;
}

export interface RunImportResult {
  importId: string;
  summary: ImportSummary;
  errors: ImportRowError[];
}

function getMapped(row: Record<string, unknown>, mapping: ColumnMapping, field: string): unknown {
  const header = mapping[field];
  if (!header) return null;
  return row[header];
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function parseNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseOrderDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function parseOptionalDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

interface DetectedCandidate {
  existingCustomerId: string;
  matchType: string;
  confidence: "HIGH" | "MEDIUM";
  reason: string;
}

/**
 * In-memory index over an owner's customer pool, used to replicate
 * customer.service.ts's resolveCustomerForImportRow + duplicate-
 * detection.service.ts's detectDuplicateCandidates matching rules WITHOUT a
 * DB round trip per row (see Sprint 14-I perf investigation: the previous
 * per-row implementation did ~9 sequential round trips/row, ~900ms/row,
 * making 500+ row files take minutes). The matching PREDICATES are copied
 * verbatim from those two functions — only how the candidate data is
 * fetched changes (once for the whole file, not once per row). New
 * customers are indexed immediately as they're "created" in memory so a
 * later row in the SAME file can still match an earlier row's new customer,
 * exactly like the old sequential DB-backed version could.
 */
class CustomerPoolIndex {
  private byPhone = new Map<string, Customer[]>();
  private byNameAddress = new Map<string, Customer[]>();
  private byAddress = new Map<string, Customer[]>();

  constructor(initial: Customer[]) {
    for (const c of initial) this.add(c);
  }

  add(c: Customer): void {
    if (c.phone) {
      const list = this.byPhone.get(c.phone) ?? [];
      list.push(c);
      this.byPhone.set(c.phone, list);
    }
    if (c.address_normalized) {
      const nameAddrKey = `${c.name}::${c.address_normalized}`;
      const list1 = this.byNameAddress.get(nameAddrKey) ?? [];
      list1.push(c);
      this.byNameAddress.set(nameAddrKey, list1);

      const list2 = this.byAddress.get(c.address_normalized) ?? [];
      list2.push(c);
      this.byAddress.set(c.address_normalized, list2);
    }
  }

  /** Mirrors resolveCustomerForImportRow's exact-match rule: same phone + same name + same normalized address. */
  findExactMatch(name: string, phone: string | null, addressNormalized: string | null): Customer | null {
    if (!phone) return null;
    const samePhone = this.byPhone.get(phone) ?? [];
    return samePhone.find((c) => c.name === name && c.address_normalized === addressNormalized) ?? null;
  }

  /** Mirrors detectDuplicateCandidates's CASE1-5 rules verbatim, just reading from the in-memory index instead of issuing 2-3 queries. */
  detectCandidates(newCustomerId: string, name: string, phone: string | null, addressNormalized: string | null): DetectedCandidate[] {
    const matched = new Map<string, DetectedCandidate>();
    const addOnce = (existingId: string, candidate: DetectedCandidate) => {
      if (existingId === newCustomerId) return;
      if (!matched.has(existingId)) matched.set(existingId, candidate);
    };

    if (phone) {
      const samePhone = this.byPhone.get(phone) ?? [];
      for (const existing of samePhone) {
        if (existing.id === newCustomerId) continue;
        if (existing.name === name && existing.address_normalized !== addressNormalized) {
          addOnce(existing.id, {
            existingCustomerId: existing.id,
            matchType: "shipping_changed",
            confidence: "HIGH",
            reason: `이름/전화번호 동일, 주소 다름 → 배송지 변경 가능성 (기존 주소: ${existing.address ?? "-"})`,
          });
        }
      }
      for (const existing of samePhone) {
        if (existing.id === newCustomerId) continue;
        if (existing.address_normalized !== addressNormalized) {
          addOnce(existing.id, {
            existingCustomerId: existing.id,
            matchType: "address_changed",
            confidence: "HIGH",
            reason: `전화번호 동일, 주소 다름 → 주소 변경 가능성 (기존 주소: ${existing.address ?? "-"})`,
          });
        }
      }
    }

    if (addressNormalized) {
      const sameNameAddress = this.byNameAddress.get(`${name}::${addressNormalized}`) ?? [];
      for (const existing of sameNameAddress) {
        if (existing.id === newCustomerId) continue;
        if (existing.phone !== phone) {
          addOnce(existing.id, {
            existingCustomerId: existing.id,
            matchType: "phone_changed",
            confidence: "HIGH",
            reason: `이름/주소 동일, 전화번호 다름 → 휴대폰 번호 변경 가능성 (기존 번호: ${existing.phone ?? "-"})`,
          });
        }
      }

      const sameAddress = this.byAddress.get(addressNormalized) ?? [];
      for (const existing of sameAddress) {
        if (existing.id === newCustomerId) continue;
        if (existing.phone !== phone && isSimilarButNotIdenticalName(existing.name, name)) {
          const looksLikeSamePerson = existing.name.length === name.length;
          addOnce(existing.id, {
            existingCustomerId: existing.id,
            matchType: looksLikeSamePerson ? "phone_changed_likely" : "family",
            confidence: "MEDIUM",
            reason: `주소 동일, 이름 유사(${existing.name} ↔ ${name}), 전화번호 다름 → ${
              looksLikeSamePerson ? "휴대폰 번호 변경 가능성" : "가족 구성원 가능성"
            }`,
          });
        }
      }
    }

    return Array.from(matched.values());
  }
}

/**
 * Executes the full excel/csv import pipeline: groups rows into orders
 * (a smartstore export has one row per product line, so multiple rows can
 * share an order_number), resolves/creates the customer for each order,
 * writes orders + order_items, and runs duplicate-candidate detection for
 * every newly created customer.
 *
 * Re-running the same file is safe: orders.order_number is unique, so any
 * order already imported in a previous run is skipped (counted as success,
 * not re-created). This is how "재처리" (reprocess) works from the Import
 * History screen — re-upload the file and only the previously failed rows
 * get processed.
 *
 * Sprint 14-I: rewritten from "~9 DB round trips per row, sequential" to
 * "~8-10 round trips for the whole file, regardless of row count" — see
 * CustomerPoolIndex above. Matching/dedup RULES are byte-for-byte identical
 * to before; only how the data backing them is fetched changed.
 */
export async function runImport({ fileName, parsed, mapping, ownerUsername }: RunImportInput): Promise<RunImportResult> {
  const tenant = await tenantsRepository.findByUsername(ownerUsername);
  if (!tenant) throw new Error(`No tenant membership found for account "${ownerUsername}".`);

  const importRecord = await importsRepository.create({
    file_name: fileName,
    status: "processing",
    total_rows: parsed.rows.length,
    owner_username: ownerUsername,
    tenant_id: tenant.id,
  });

  const errors: ImportRowError[] = [];
  let newCustomers = 0;
  let existingCustomers = 0;
  let successRows = 0;

  const groups = new Map<string, Record<string, unknown>[]>();
  parsed.rows.forEach((row, index) => {
    const orderNumber = cellToString(getMapped(row, mapping, "order_number"));
    if (!orderNumber) {
      errors.push({ row: index + 2, reason: "주문번호가 비어 있습니다.", raw: row });
      return;
    }
    const list = groups.get(orderNumber) ?? [];
    list.push(row);
    groups.set(orderNumber, list);
  });

  // ---------- Phase 1: batch-fetch everything the per-row logic used to query individually ----------
  const [existingOrderNumbers, ownerCustomers] = await Promise.all([
    ordersRepository.findExistingOrderNumbers(Array.from(groups.keys())),
    customersRepository.findAllByOwner(ownerUsername),
  ]);
  const pool = new CustomerPoolIndex(ownerCustomers);

  // ---------- Phase 2: pure in-memory pass over every group — zero DB calls in this loop ----------
  const newCustomerInserts: CustomerInsert[] = [];
  const newOrderInserts: OrderInsert[] = [];
  const newItemInserts: OrderItemInsert[] = [];
  const newDuplicateInserts: DuplicateCandidateInsert[] = [];
  const bagNoUpdates: { id: string; bagNo: string }[] = [];

  for (const [orderNumber, rows] of groups) {
    try {
      if (existingOrderNumbers.has(orderNumber)) {
        successRows += rows.length;
        continue;
      }

      const first = rows[0];
      const rawPhone = cellToString(getMapped(first, mapping, "phone")) || null;
      const rawAddress = cellToString(getMapped(first, mapping, "address")) || null;
      const deliveryMemo = cellToString(getMapped(first, mapping, "delivery_memo")) || null;
      const orderDate = parseOrderDate(getMapped(first, mapping, "order_date"));
      const orderStatus = cellToString(getMapped(first, mapping, "order_status"));
      const zipcode = cellToString(getMapped(first, mapping, "zipcode")) || null;
      const courier = cellToString(getMapped(first, mapping, "courier")) || null;
      const trackingNumber = cellToString(getMapped(first, mapping, "tracking_number")) || null;
      const salesChannel = cellToString(getMapped(first, mapping, "sales_channel")) || null;
      const buyerName = cellToString(getMapped(first, mapping, "buyer_name")) || null;
      const buyerId = cellToString(getMapped(first, mapping, "buyer_id")) || null;
      const shippedAt = parseOptionalDate(getMapped(first, mapping, "shipped_at"));
      const bagNo = cellToString(getMapped(first, mapping, "bag_no")) || null;

      // Some Smartstore export permission levels mask both 수취인명 and
      // 구매자명 for privacy, leaving only phone/address/buyer_id. Fall back
      // through what's actually available rather than failing the row —
      // phone+address is enough to identify a customer; the admin can fill
      // in a real name later from the customer detail screen.
      const rawRecipientName = cellToString(getMapped(first, mapping, "recipient_name"));
      const name = rawRecipientName || buyerName || (buyerId ? `구매자(${buyerId})` : "") || "이름 미확인";

      if (!rawPhone && !rawAddress) {
        errors.push({ row: 0, reason: `[${orderNumber}] 전화번호와 주소가 모두 비어 있어 고객을 식별할 수 없습니다.`, raw: first });
        continue;
      }

      const phone = formatPhoneNumber(rawPhone);
      const address = cleanAddress(rawAddress);
      const addressNormalized = normalizeAddressForCompare(rawAddress);

      let customerId: string;
      let isNew: boolean;
      const exactMatch = pool.findExactMatch(name, phone, addressNormalized);
      if (exactMatch) {
        customerId = exactMatch.id;
        isNew = false;
        existingCustomers += 1;
        if (bagNo && !exactMatch.bag_no) {
          bagNoUpdates.push({ id: exactMatch.id, bagNo });
          exactMatch.bag_no = bagNo; // reflect immediately so later rows in this file see it as already set
        }
      } else {
        customerId = randomUUID();
        isNew = true;
        newCustomers += 1;
        const newCustomer: Customer = {
          id: customerId,
          customer_code: "",
          name,
          phone,
          address,
          address_normalized: addressNormalized,
          postal_code: null,
          road_address: null,
          detail_address: null,
          latitude: null,
          longitude: null,
          sido: null,
          sigungu: null,
          eupmyeondong: null,
          sido_code: null,
          sigungu_code: null,
          eupmyeondong_code: null,
          geocode_status: "pending",
          geocoded_at: null,
          memo: null,
          tags: [],
          owner_username: ownerUsername,
          tenant_id: tenant.id,
          is_favorite: false,
          status: "active",
          merged_into_id: null,
          bag_no: bagNo,
          created_by_import_id: importRecord.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        newCustomerInserts.push({
          id: customerId,
          name,
          phone,
          address,
          address_normalized: addressNormalized,
          owner_username: ownerUsername,
          tenant_id: tenant.id,
          created_by_import_id: importRecord.id,
          bag_no: bagNo,
        });
        pool.add(newCustomer);
      }

      const items = rows.map((row) => ({
        product_order_number: cellToString(getMapped(row, mapping, "product_order_number")) || null,
        product_code: cellToString(getMapped(row, mapping, "product_code")) || null,
        product_name: cellToString(getMapped(row, mapping, "product_name")) || "상품",
        option_name: cellToString(getMapped(row, mapping, "option_name")) || null,
        quantity: parseNumber(getMapped(row, mapping, "quantity")) || 1,
        unit_price: parseNumber(getMapped(row, mapping, "unit_price")),
        amount: parseNumber(getMapped(row, mapping, "amount")),
        // Preserve every original column for this row, not just the mapped subset.
        extra: row,
      }));
      const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

      // 옵션정보 often embeds the delivery-area + delivery-date choice
      // (e.g. "하남/강동(일부): ... / 날짜 선택: 07월16일") — pull both out
      // of whichever item's option text has them first.
      const orderDateObj = new Date(orderDate);
      const deliveryDate = items
        .map((item) => parseDeliveryDateFromOption(item.option_name, orderDateObj))
        .find((d) => d !== null) ?? null;
      const deliveryArea = items
        .map((item) => parseDeliveryAreaFromOption(item.option_name))
        .find((a) => a !== null) ?? null;

      const orderId = randomUUID();
      newOrderInserts.push({
        id: orderId,
        customer_id: customerId,
        order_number: orderNumber,
        internal_order_number: "", // Phase 5: batch-allocated after this loop, see below — never one RPC call per row
        order_date: orderDate,
        status: orderStatus,
        total_amount: totalAmount,
        recipient_name: name,
        phone_snapshot: formatPhoneNumber(rawPhone),
        address_snapshot: cleanAddress(rawAddress),
        zipcode,
        delivery_memo: deliveryMemo,
        courier,
        tracking_number: trackingNumber,
        sales_channel: salesChannel,
        buyer_name: buyerName,
        buyer_id: buyerId,
        shipped_at: shippedAt,
        delivery_date: deliveryDate,
        delivery_area: deliveryArea,
        order_source: "엑셀",
        import_id: importRecord.id,
        owner_username: ownerUsername,
        tenant_id: tenant.id,
      });
      for (const item of items) {
        newItemInserts.push({ ...item, order_id: orderId });
      }

      if (isNew) {
        const candidates = pool.detectCandidates(customerId, name, phone, addressNormalized);
        for (const c of candidates) {
          newDuplicateInserts.push({
            existing_customer_id: c.existingCustomerId,
            new_customer_id: customerId,
            import_id: importRecord.id,
            match_type: c.matchType,
            confidence: c.confidence,
            reason: c.reason,
            owner_username: ownerUsername,
            tenant_id: tenant.id,
          });
        }
      }

      successRows += rows.length;
    } catch (e) {
      errors.push({
        row: 0,
        reason: `[${orderNumber}] 처리 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`,
        raw: rows[0],
      });
    }
  }

  // Phase 5: 내부 주문번호를 이 시점에 한 번에 배정한다 — 위 루프(zero DB calls)를
  // 지키기 위해 루프 안에서는 채번하지 않고, 여기서 KST 캘린더일 단위로 묶어
  // next_order_seq_batch를 날짜 종류 수만큼만 호출한다(건마다 왕복하지 않음).
  if (newOrderInserts.length > 0) {
    const internalNumbers = await allocateOrderNumbers(tenant.id, newOrderInserts.map((o) => o.order_date));
    newOrderInserts.forEach((o, i) => {
      o.internal_order_number = internalNumbers[i];
    });
  }

  // ---------- Phase 3: flush everything in a handful of batch writes (customers -> orders -> items, in FK order) ----------
  if (newCustomerInserts.length > 0) {
    await customersRepository.createMany(newCustomerInserts);
  }
  if (newOrderInserts.length > 0) {
    await ordersRepository.createMany(newOrderInserts);
  }
  if (newItemInserts.length > 0) {
    await ordersRepository.createItems(newItemInserts);
  }
  let duplicateCandidateCount = 0;
  if (newDuplicateInserts.length > 0) {
    const created = await duplicatesRepository.createMany(newDuplicateInserts);
    duplicateCandidateCount = created.length;
  }
  for (const u of bagNoUpdates) {
    await customersRepository.update(u.id, { bag_no: u.bagNo });
  }

  const failedRows = parsed.rows.length - successRows;

  await importsRepository.update(importRecord.id, {
    status: "completed",
    success_rows: successRows,
    failed_rows: failedRows,
    new_customers: newCustomers,
    existing_customers: existingCustomers,
    duplicate_candidates: duplicateCandidateCount,
    column_mapping: mapping as Record<string, string>,
    error_log: errors,
  });

  return {
    importId: importRecord.id,
    summary: {
      totalOrders: groups.size,
      newCustomers,
      existingCustomers,
      duplicateCandidates: duplicateCandidateCount,
      failedRows,
    },
    errors,
  };
}

export interface DeleteImportResult {
  deletedOrders: number;
  deletedCustomers: number;
}

/**
 * Reverses a mistaken/duplicate upload: deletes every order (and its items,
 * via FK cascade) created by this import, then removes any customer that
 * import newly created and now has zero remaining orders. Customers that
 * were matched/reused from an existing pool are always left untouched since
 * created_by_import_id is only set on brand-new customers.
 */
export async function deleteImport(importId: string): Promise<DeleteImportResult> {
  const orders = await ordersRepository.findByImportId(importId);
  await ordersRepository.deleteMany(orders.map((o) => o.id));

  const candidateCustomers = await customersRepository.findByCreatedByImportId(importId);
  let deletedCustomers = 0;
  for (const customer of candidateCustomers) {
    const stats = await ordersRepository.aggregateStatsByCustomer(customer.id);
    if (stats.totalOrders > 0) continue;
    try {
      await customersRepository.delete(customer.id);
      deletedCustomers += 1;
    } catch {
      // Referenced elsewhere (e.g. kept side of a merge) — leave it in place.
    }
  }

  await importsRepository.delete(importId);

  return { deletedOrders: orders.length, deletedCustomers };
}
