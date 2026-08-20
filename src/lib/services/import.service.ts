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
import { geocodeBatch, type GeocodeFields } from "@/lib/services/geocoding.service";
import { triggerDeliveryGroupRegeneration } from "@/lib/services/delivery-group-regeneration.service";
import { kstDayDateStrOf } from "@/lib/utils/kst-date";
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
  // P8 3번: "신규 주문"/"반복 주문" — 고객 레코드가 새로 생겼는지가 아니라
  // "이 주문이 그 고객의 진짜 첫 주문인지"로 정의한다(신규 고객이면 항상
  // 첫 주문이지만, 기존 고객이어도 이전 주문이 0건이면 여전히 신규 주문).
  // 변수명은 P5/P7 시절 "신규/기존 고객" 카운터를 그대로 쓰지만, 실제로는
  // 이제 이 정의로 센다 — imports 테이블 컬럼(new_customers/existing_
  // customers)도 새 마이그레이션 없이 그대로 재사용한다.
  let newOrderCount = 0;
  let repeatOrderCount = 0;
  let successRows = 0;
  // P5: 261→157 같은 차이를 "임의로 정상 처리"라고 뭉개지 않기 위한 세분화
  // 카운터 — rowsWithoutOrderNumber(그룹화 단계 탈락)/alreadyImported*(이미
  // 존재해 건너뜀)/failedRowCount(고객 식별 불가·처리 예외)를 각각 추적한다.
  let rowsWithoutOrderNumber = 0;
  let alreadyImportedRows = 0;
  let alreadyImportedOrders = 0;
  let failedRowCount = 0;

  // 그룹마다 "몇 번째 원본 행부터 시작하는지"를 같이 들고 있어야 오류 메시지의
  // 행 번호(row:0 버그)를 실제 엑셀 행으로 채울 수 있다.
  const groups = new Map<string, { row: Record<string, unknown>; index: number }[]>();
  parsed.rows.forEach((row, index) => {
    const orderNumber = cellToString(getMapped(row, mapping, "order_number"));
    if (!orderNumber) {
      rowsWithoutOrderNumber += 1;
      errors.push({ row: index + 2, code: "missing_order_number", reason: "주문번호가 비어 있습니다.", raw: row });
      return;
    }
    const list = groups.get(orderNumber) ?? [];
    list.push({ row, index });
    groups.set(orderNumber, list);
  });

  // ---------- Phase 1: batch-fetch everything the per-row logic used to query individually ----------
  const [existingOrderNumbers, ownerCustomers] = await Promise.all([
    ordersRepository.findExistingOrderNumbers(Array.from(groups.keys()), tenant.id),
    customersRepository.findAllByOwner(ownerUsername),
  ]);
  const pool = new CustomerPoolIndex(ownerCustomers);
  // Import 시작 시점의 "고객별 기존 주문 수"(취소 제외, customer_order_stats
  // 뷰) — 이 파일 안에서 같은 고객이 여러 번 주문하면 첫 등장만 신규로
  // 세고 그 다음부터는 즉시 반복으로 넘어가도록 처리 중에 카운트를 올린다.
  const priorOrderCounts = await customersRepository.findOrderCounts(ownerCustomers.map((c) => c.id));

  // ---------- Phase 2: pure in-memory pass over every group — zero DB calls in this loop ----------
  const newCustomerInserts: CustomerInsert[] = [];
  const newOrderInserts: OrderInsert[] = [];
  const newItemInserts: OrderItemInsert[] = [];
  const newDuplicateInserts: DuplicateCandidateInsert[] = [];
  const bagNoUpdates: { id: string; bagNo: string }[] = [];
  // P10-1.5: Excel 주문은 geocoding이 아예 빠져 있어 기사후보 추천/배송그룹
  // 클러스터링의 입력(order.sido, latitude/longitude)이 영구히 비어있던
  // 문제를 고친다. 루프 안에서 매 행 await하면 대량 파일에서 느려지므로
  // (DB 왕복을 없앤 이 루프의 원칙과 같은 이유) 주소만 모아뒀다가 루프
  // 종료 후 한 번에 처리한다. 같은 정규화 주소는 파일 안에서 한 번만
  // geocode(query)하도록 addressQueries에 최초 1건만 등록한다.
  const addressQueries = new Map<string, string>(); // normalizedAddress -> cleanAddress(query)
  const pendingOrderGeocode: { insert: OrderInsert; addressKey: string }[] = [];
  const pendingCustomerGeocode: { insert: CustomerInsert; addressKey: string }[] = [];

  for (const [orderNumber, entries] of groups) {
    const rows = entries.map((e) => e.row);
    const firstIndex = entries[0].index;
    try {
      if (existingOrderNumbers.has(orderNumber)) {
        successRows += rows.length;
        alreadyImportedRows += rows.length;
        alreadyImportedOrders += 1;
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
        errors.push({
          row: firstIndex + 2,
          code: "missing_contact_info",
          reason: `[${orderNumber}] 전화번호와 주소가 모두 비어 있어 고객을 식별할 수 없습니다.`,
          raw: first,
        });
        failedRowCount += rows.length;
        continue;
      }

      const phone = formatPhoneNumber(rawPhone);
      const address = cleanAddress(rawAddress);
      const addressNormalized = normalizeAddressForCompare(rawAddress);

      let customerId: string;
      let isNew: boolean;
      // P10-1.5: 기존 고객이 이미 성공한 geocode를 갖고 있으면 그대로 재사용
      // — Excel 경로에선 고객의 집 주소와 이 주문의 배송지가 같은 rawAddress
      // 이므로(수동 주문처럼 둘이 다를 수 있는 별도 입력이 없음) 재호출 없이
      // 그대로 써도 정확하다. 없으면 아래에서 이 주문만 새로 geocode 큐에 넣는다
      // (기존 고객 프로필 자체는 "독립적 스냅샷" 원칙에 따라 건드리지 않는다).
      let reusableGeo: GeocodeFields | null = null;
      const exactMatch = pool.findExactMatch(name, phone, addressNormalized);
      if (exactMatch) {
        customerId = exactMatch.id;
        isNew = false;
        if (bagNo && !exactMatch.bag_no) {
          bagNoUpdates.push({ id: exactMatch.id, bagNo });
          exactMatch.bag_no = bagNo; // reflect immediately so later rows in this file see it as already set
        }
        if (exactMatch.geocode_status === "success" && exactMatch.latitude != null && exactMatch.longitude != null) {
          reusableGeo = {
            latitude: exactMatch.latitude,
            longitude: exactMatch.longitude,
            sido: exactMatch.sido,
            sigungu: exactMatch.sigungu,
            eupmyeondong: exactMatch.eupmyeondong,
            sido_code: exactMatch.sido_code,
            sigungu_code: exactMatch.sigungu_code,
            eupmyeondong_code: exactMatch.eupmyeondong_code,
            geocode_status: "success",
          };
        }
      } else {
        customerId = randomUUID();
        isNew = true;
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
        const customerInsert: CustomerInsert = {
          id: customerId,
          name,
          phone,
          address,
          address_normalized: addressNormalized,
          owner_username: ownerUsername,
          tenant_id: tenant.id,
          created_by_import_id: importRecord.id,
          bag_no: bagNo,
        };
        newCustomerInserts.push(customerInsert);
        pool.add(newCustomer);
        if (address && addressNormalized) {
          if (!addressQueries.has(addressNormalized)) addressQueries.set(addressNormalized, address);
          pendingCustomerGeocode.push({ insert: customerInsert, addressKey: addressNormalized });
        }
      }

      // P8 3번: 이 주문이 customerId의 진짜 첫 주문인지 — 신규 고객이면
      // priorOrderCounts에 항목이 없어 0으로 취급되어 항상 신규 주문이고,
      // 기존 고객이면 Import 시작 시점 주문 수를 기준으로 판정한다. 판정
      // 직후 카운트를 올려 같은 파일 안의 다음 주문부터는 반복으로 잡는다.
      const priorOrders = priorOrderCounts.get(customerId) ?? 0;
      if (priorOrders === 0) newOrderCount += 1;
      else repeatOrderCount += 1;
      priorOrderCounts.set(customerId, priorOrders + 1);

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
      const orderInsert: OrderInsert = {
        id: orderId,
        customer_id: customerId,
        order_number: orderNumber,
        internal_order_number: "", // Phase 5: batch-allocated after this loop, see below — never one RPC call per row
        order_date: orderDate,
        status: orderStatus,
        total_amount: totalAmount,
        recipient_name: name,
        phone_snapshot: formatPhoneNumber(rawPhone),
        address_snapshot: address,
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
      };
      if (reusableGeo) {
        Object.assign(orderInsert, reusableGeo, { geocoded_at: new Date().toISOString() });
      } else if (address && addressNormalized) {
        if (!addressQueries.has(addressNormalized)) addressQueries.set(addressNormalized, address);
        pendingOrderGeocode.push({ insert: orderInsert, addressKey: addressNormalized });
      }
      newOrderInserts.push(orderInsert);
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
        row: firstIndex + 2,
        code: "processing_error",
        reason: `[${orderNumber}] 처리 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`,
        raw: rows[0],
      });
      failedRowCount += rows.length;
    }
  }

  // Phase 4 (P10-1.5): 큐에 쌓인 서로 다른 주소만 제한된 동시성으로
  // geocode하고, 신규 고객/주문 insert 객체에 결과를 채워 넣는다.
  // geocodeBatch는 절대 throw하지 않으므로 이 단계가 실패해도 import
  // 자체는 계속 진행된다(실패한 주소는 geocode_status="failed"로 남을 뿐).
  let geocodeSuccess = 0;
  let geocodeFailed = 0;
  if (addressQueries.size > 0) {
    const geocodeResults = await geocodeBatch(addressQueries);
    for (const { insert, addressKey } of pendingCustomerGeocode) {
      const geo = geocodeResults.get(addressKey);
      if (geo) Object.assign(insert, geo, { geocoded_at: new Date().toISOString() });
    }
    for (const { insert, addressKey } of pendingOrderGeocode) {
      const geo = geocodeResults.get(addressKey);
      if (geo) Object.assign(insert, geo, { geocoded_at: new Date().toISOString() });
    }
  }
  for (const o of newOrderInserts) {
    if (o.geocode_status === "success") geocodeSuccess += 1;
    else if (o.geocode_status === "failed") geocodeFailed += 1;
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
    // P15-A: 150건이 들어와도 "건마다"가 아니라 이번 import에 포함된 배송일
    // 종류 수만큼만(보통 1~수 회) 재계산한다 — CPO 방침(P15-A 2번, Excel Import).
    const distinctDateStrs = new Set(
      newOrderInserts
        .filter((o): o is typeof o & { delivery_date: string } => !!o.delivery_date)
        .map((o) => kstDayDateStrOf(o.delivery_date))
    );
    for (const dateStr of distinctDateStrs) {
      await triggerDeliveryGroupRegeneration(tenant.id, dateStr, ownerUsername);
    }
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

  // P5: 더 이상 "총 행수 - 성공 행수"로 역산하지 않는다 — 그룹화 단계 탈락분과
  // 처리 실패분을 각각 직접 센 값의 합이므로, totalRawRows = rowsWithoutOrderNumber
  // + alreadyImportedRows + (신규 생성된 행 수) + failedRowCount가 항상 성립한다.
  const failedRows = rowsWithoutOrderNumber + failedRowCount;

  await importsRepository.update(importRecord.id, {
    status: "completed",
    success_rows: successRows,
    failed_rows: failedRows,
    new_customers: newOrderCount,
    existing_customers: repeatOrderCount,
    duplicate_candidates: duplicateCandidateCount,
    already_imported_rows: alreadyImportedRows,
    column_mapping: mapping as Record<string, string>,
    error_log: errors,
  });

  return {
    importId: importRecord.id,
    summary: {
      totalRawRows: parsed.rows.length,
      totalOrderGroups: groups.size,
      newOrdersCreated: newOrderInserts.length,
      alreadyImportedOrders,
      newOrders: newOrderCount,
      repeatOrders: repeatOrderCount,
      duplicateCandidates: duplicateCandidateCount,
      failedRows,
      geocodeSuccess,
      geocodeFailed,
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
export async function deleteImport(importId: string, ownerUsername?: string): Promise<DeleteImportResult> {
  const orders = await ordersRepository.findByImportId(importId);
  await ordersRepository.deleteMany(orders.map((o) => o.id));

  // P15-A: 삭제된 주문들이 걸쳐 있던 배송일마다 그룹을 재계산한다 —
  // deleteAllImports()가 이 함수를 반복 호출하므로 "전체 삭제"도 자동으로
  // 커버된다(별도 트리거 불필요).
  const affected = new Map<string, { tenantId: string; ownerUsername: string }>();
  for (const order of orders) {
    if (!order.delivery_date) continue;
    const dateStr = kstDayDateStrOf(order.delivery_date);
    affected.set(`${order.tenant_id}|${dateStr}`, { tenantId: order.tenant_id, ownerUsername: order.owner_username });
  }
  for (const [key, { tenantId, ownerUsername: owner }] of affected) {
    const dateStr = key.split("|")[1];
    await triggerDeliveryGroupRegeneration(tenantId, dateStr, owner);
  }

  const candidateCustomers = await customersRepository.findByCreatedByImportId(importId);
  let deletedCustomers = 0;
  for (const customer of candidateCustomers) {
    const stats = await ordersRepository.aggregateStatsByCustomer(customer.id);
    if (stats.totalOrders > 0) continue;
    try {
      await customersRepository.delete(customer.id, ownerUsername);
      deletedCustomers += 1;
    } catch {
      // Referenced elsewhere (e.g. kept side of a merge) — leave it in place.
    }
  }

  await importsRepository.delete(importId, ownerUsername);

  return { deletedOrders: orders.length, deletedCustomers };
}

export interface DeleteAllImportsResult {
  deletedImports: number;
  deletedOrders: number;
  deletedCustomers: number;
}

/**
 * P5: "엑셀 이력 전체 삭제" — 이 기능 자체가 기존 코드에 없어(행 단위 삭제만
 * 존재) "전체 삭제해도 20건이 남는다"는 버그를 재현할 수 없었다. 신규 구현.
 * ownerUsername 소속 이력만 지운다(admin이 눌러도 admin 자신의 소속 이력만
 * — 다른 사장님 이력에 영향을 주면 안 된다는 원칙은 그대로 유지).
 * deleteImport를 그대로 반복 호출해 기존 단건 삭제와 완전히 같은 정리 로직
 * (주문/품목 cascade + import로 생성된 고객 중 잔여 주문 없는 것만 삭제)을 재사용한다.
 */
export async function deleteAllImports(ownerUsername: string): Promise<DeleteAllImportsResult> {
  const ids = await importsRepository.listIdsByOwner(ownerUsername);
  let deletedOrders = 0;
  let deletedCustomers = 0;
  for (const id of ids) {
    const result = await deleteImport(id, ownerUsername);
    deletedOrders += result.deletedOrders;
    deletedCustomers += result.deletedCustomers;
  }
  return { deletedImports: ids.length, deletedOrders, deletedCustomers };
}
