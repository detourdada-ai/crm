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
export async function runImport({ fileName, parsed, mapping }: RunImportInput): Promise<RunImportResult> {
  const importRecord = await importsRepository.create({
    file_name: fileName,
    status: "processing",
    total_rows: parsed.rows.length,
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
      const name = cellToString(getMapped(first, mapping, "recipient_name"));
      const rawPhone = cellToString(getMapped(first, mapping, "phone")) || null;
      const rawAddress = cellToString(getMapped(first, mapping, "address")) || null;
      const deliveryMemo = cellToString(getMapped(first, mapping, "delivery_memo")) || null;
      const orderDate = parseOrderDate(getMapped(first, mapping, "order_date"));

      if (!name) {
        errors.push({ row: 0, reason: `[${orderNumber}] 수령인/주문자명이 비어 있습니다.`, raw: first });
        continue;
      }

      const { customer, isNew } = await resolveCustomerForImportRow({ name, rawPhone, rawAddress });
      if (isNew) newCustomers += 1;
      else existingCustomers += 1;

      const items = rows.map((row) => ({
        product_name: cellToString(getMapped(row, mapping, "product_name")) || "상품",
        option_name: cellToString(getMapped(row, mapping, "option_name")) || null,
        quantity: parseNumber(getMapped(row, mapping, "quantity")) || 1,
        unit_price: parseNumber(getMapped(row, mapping, "unit_price")),
        amount: parseNumber(getMapped(row, mapping, "amount")),
      }));
      const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

      const [order] = await ordersRepository.createMany([
        {
          customer_id: customer.id,
          order_number: orderNumber,
          order_date: orderDate,
          total_amount: totalAmount,
          recipient_name: name,
          phone_snapshot: formatPhoneNumber(rawPhone),
          address_snapshot: cleanAddress(rawAddress),
          delivery_memo: deliveryMemo,
          import_id: importRecord.id,
        },
      ]);

      await ordersRepository.createItems(items.map((item) => ({ ...item, order_id: order.id })));

      if (isNew) {
        const candidates = await detectDuplicateCandidates({
          newCustomerId: customer.id,
          name: customer.name,
          phone: customer.phone,
          addressNormalized: customer.address_normalized,
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
