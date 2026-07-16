import "server-only";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { importsRepository } from "@/lib/repositories/imports.repository";
import { duplicatesRepository } from "@/lib/repositories/duplicates.repository";
import { detectDuplicateCandidates } from "./duplicate-detection.service";
import { resolveCustomerForImportRow } from "./customer.service";
import { formatPhoneNumber } from "@/lib/utils/phone";
import { cleanAddress } from "@/lib/utils/address";
import type { ParsedSheet, ColumnMapping } from "@/types/excel";
import type { ImportRowError, ImportSummary } from "@/types/domain";

export interface RunImportInput {
  fileName: string;
  parsed: ParsedSheet;
  mapping: ColumnMapping;
  ownerUsername: string;
}

export interface RunImportResult {
  importId: string;
  summary: ImportSummary;
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
 */
export async function runImport({ fileName, parsed, mapping, ownerUsername }: RunImportInput): Promise<RunImportResult> {
  const importRecord = await importsRepository.create({
    file_name: fileName,
    status: "processing",
    total_rows: parsed.rows.length,
    owner_username: ownerUsername,
  });

  const errors: ImportRowError[] = [];
  let newCustomers = 0;
  let existingCustomers = 0;
  let duplicateCandidateCount = 0;
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

  for (const [orderNumber, rows] of groups) {
    try {
      const already = await ordersRepository.findByOrderNumber(orderNumber);
      if (already) {
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

      const { customer, isNew } = await resolveCustomerForImportRow({ name, rawPhone, rawAddress, ownerUsername });
      if (isNew) newCustomers += 1;
      else existingCustomers += 1;

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

      const [order] = await ordersRepository.createMany([
        {
          customer_id: customer.id,
          order_number: orderNumber,
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
          import_id: importRecord.id,
          owner_username: ownerUsername,
        },
      ]);

      await ordersRepository.createItems(items.map((item) => ({ ...item, order_id: order.id })));

      if (isNew) {
        const candidates = await detectDuplicateCandidates({
          newCustomerId: customer.id,
          name: customer.name,
          phone: customer.phone,
          addressNormalized: customer.address_normalized,
          ownerUsername,
        });
        if (candidates.length > 0) {
          const created = await duplicatesRepository.createMany(
            candidates.map((c) => ({
              existing_customer_id: c.existingCustomerId,
              new_customer_id: customer.id,
              import_id: importRecord.id,
              match_type: c.matchType,
              confidence: c.confidence,
              reason: c.reason,
              owner_username: ownerUsername,
            }))
          );
          duplicateCandidateCount += created.length;
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
  };
}
