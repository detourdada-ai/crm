import "server-only";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { formatPhoneNumber } from "@/lib/utils/phone";
import { cleanAddress, normalizeAddressForCompare } from "@/lib/utils/address";
import { parseDeliveryDateFromOption } from "@/lib/utils/delivery-date";
import { kstDayDateStrOf } from "@/lib/utils/kst-date";
import { getMapped, cellToString, parseNumber, parseOptionalDate, parseOrderDate, NO_ORDER_NUMBER_PREFIX } from "@/lib/services/import.service";
import type { ParsedSheet, ColumnMapping, DedupAnalysis, DedupGroupResult, DedupOrderSnapshot } from "@/types/excel";
import type { Order } from "@/types/domain";

export interface ClassifyDuplicatesInput {
  parsed: ParsedSheet;
  mapping: ColumnMapping;
  ownerUsername: string;
}

function productSummaryOf(items: { product_name: string; option_name: string | null; quantity: number }[]): string {
  if (items.length === 0) return "-";
  const first = items[0];
  const label = first.option_name ? `${first.product_name}(${first.option_name})` : first.product_name;
  const suffix = items.length > 1 ? ` 외 ${items.length - 1}종` : "";
  return `${label} x${first.quantity}${suffix}`;
}

/**
 * §CPO 작업지시(누적 표준 엑셀 중복방지, 2026-08): Analyze 단계에서 호출하는
 * 읽기 전용 중복 판정 — DB에 아무 것도 쓰지 않는다. import.service.ts의
 * runImport()가 Confirm 시점에 사실상 동일한 규칙으로 다시 계산하므로(§14/§15
 * "서버 재검증", 브라우저 판단을 신뢰하지 않음), 이 함수의 결과는 어디까지나
 * 사용자에게 보여줄 미리보기다 — 최종 등록 여부는 항상 runImport()가 그
 * 순간의 실제 DB로 다시 결정한다.
 *
 * 행 → 이름/전화/주소/배송일/상품 정규화 로직은 import.service.ts의 Phase 2
 * 루프(주문 생성 로직)와 의도적으로 동일하게 맞춰져 있다 — CustomerPoolIndex가
 * duplicate-detection.service.ts의 판정 규칙을 "verbatim" 복제하는 것과 같은
 * 이유(성능/구조상 하나의 루프로 합치기 어려움). Phase 2의 파싱 로직이
 * 바뀌면 이 함수도 함께 갱신해야 한다.
 */
export async function classifyDuplicates({ parsed, mapping, ownerUsername }: ClassifyDuplicatesInput): Promise<DedupAnalysis> {
  const tenant = await tenantsRepository.findByUsername(ownerUsername);
  if (!tenant) throw new Error(`No tenant membership found for account "${ownerUsername}".`);

  const groups = new Map<string, { row: Record<string, unknown>; index: number }[]>();
  parsed.rows.forEach((row, index) => {
    const orderNumber = cellToString(getMapped(row, mapping, "order_number"));
    const groupKey = orderNumber || `${NO_ORDER_NUMBER_PREFIX}${index}`;
    const list = groups.get(groupKey) ?? [];
    list.push({ row, index });
    groups.set(groupKey, list);
  });

  const realGroupKeys = Array.from(groups.keys()).filter((k) => !k.startsWith(NO_ORDER_NUMBER_PREFIX));
  const noOrderNumberPhones = new Set<string>();
  for (const [key, entries] of groups) {
    if (!key.startsWith(NO_ORDER_NUMBER_PREFIX)) continue;
    const formatted = formatPhoneNumber(cellToString(getMapped(entries[0].row, mapping, "phone")));
    if (formatted) noOrderNumberPhones.add(formatted);
  }

  const [existingOrderNumbers, globallyExistingOrderNumbers, candidateOrders] = await Promise.all([
    ordersRepository.findExistingOrderNumbers(realGroupKeys, tenant.id),
    ordersRepository.findGloballyExistingOrderNumbers(realGroupKeys),
    ordersRepository.findByPhonesForDedup(tenant.id, [...noOrderNumberPhones]),
  ]);
  const crossTenantConflicts = new Set([...globallyExistingOrderNumbers].filter((n) => !existingOrderNumbers.has(n)));
  const candidateItems = await ordersRepository.findItemsByOrderIds(candidateOrders.map((o) => o.id));
  const itemsByOrderId = new Map<string, typeof candidateItems>();
  for (const item of candidateItems) {
    const list = itemsByOrderId.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrderId.set(item.order_id, list);
  }
  const orderById = new Map(candidateOrders.map((o) => [o.id, o]));

  function snapshotOfExisting(o: Order): DedupOrderSnapshot {
    const items = itemsByOrderId.get(o.id) ?? [];
    return {
      orderNumber: o.order_number,
      recipientName: o.recipient_name,
      phone: o.phone_snapshot,
      address: o.address_snapshot,
      deliveryDate: o.delivery_date,
      productSummary: productSummaryOf(items),
      deliveryStatus: o.delivery_status,
    };
  }

  const results: DedupGroupResult[] = [];
  for (const [groupKey, entries] of groups) {
    const rows = entries.map((e) => e.row);
    const hasRealOrderNumber = !groupKey.startsWith(NO_ORDER_NUMBER_PREFIX);
    const orderNumber = hasRealOrderNumber ? groupKey : null;
    const first = rows[0];

    const rawPhone = cellToString(getMapped(first, mapping, "phone")) || null;
    const rawAddress = cellToString(getMapped(first, mapping, "address")) || null;
    const buyerName = cellToString(getMapped(first, mapping, "buyer_name")) || null;
    const buyerId = cellToString(getMapped(first, mapping, "buyer_id")) || null;
    const rawRecipientName = cellToString(getMapped(first, mapping, "recipient_name"));
    const name = rawRecipientName || buyerName || (buyerId ? `구매자(${buyerId})` : "") || "이름 미확인";
    const phone = formatPhoneNumber(rawPhone);
    const address = cleanAddress(rawAddress);
    const addressNormalized = normalizeAddressForCompare(rawAddress);
    const explicitDeliveryDate = parseOptionalDate(getMapped(first, mapping, "delivery_date"));
    const items = rows.map((row) => ({
      product_name: cellToString(getMapped(row, mapping, "product_name")) || "상품",
      option_name: cellToString(getMapped(row, mapping, "option_name")) || null,
      quantity: parseNumber(getMapped(row, mapping, "quantity")) || 1,
    }));
    const orderDateObj = new Date(parseOrderDate(getMapped(first, mapping, "order_date")));
    const itemDeliveryDates = items.map((item) => parseDeliveryDateFromOption(item.option_name, orderDateObj));
    const deliveryDate = itemDeliveryDates.find((d) => d !== null) ?? explicitDeliveryDate ?? null;

    const upload: DedupOrderSnapshot = {
      orderNumber,
      recipientName: name,
      phone,
      address,
      deliveryDate,
      productSummary: productSummaryOf(items),
    };

    if (!rawPhone && !rawAddress) {
      results.push({
        groupKey,
        status: "error",
        reason: "전화번호와 주소가 모두 비어 있어 고객을 식별할 수 없습니다.",
        upload,
      });
      continue;
    }

    if (hasRealOrderNumber) {
      if (existingOrderNumbers.has(groupKey)) {
        results.push({
          groupKey,
          status: "confirmed_duplicate",
          reason: "이미 등록된 주문입니다.",
          upload,
        });
        continue;
      }
      if (crossTenantConflicts.has(groupKey)) {
        results.push({
          groupKey,
          status: "error",
          reason: `[${orderNumber}] 이 주문번호는 이미 다른 계정의 주문에 등록되어 있어 등록할 수 없습니다.`,
          upload,
        });
        continue;
      }
      results.push({ groupKey, status: "new", reason: "신규 주문입니다.", upload });
      continue;
    }

    // 주문번호 없는 행: 고객(전화+이름+정규화주소 완전일치) + 배송일이 같은
    // 기존 주문을 찾는다 — 둘 중 하나라도 없으면(배송일 미확인 등) 안전하게
    // "신규"로 분류한다(§CPO: 과도한 자동 확정 금지).
    const matchedOrders = candidateOrders.filter(
      (o) =>
        o.phone_snapshot === phone &&
        o.recipient_name === name &&
        normalizeAddressForCompare(o.address_snapshot) === addressNormalized &&
        !!o.delivery_date &&
        !!deliveryDate &&
        kstDayDateStrOf(o.delivery_date) === kstDayDateStrOf(deliveryDate)
    );
    if (matchedOrders.length === 0) {
      results.push({ groupKey, status: "new", reason: "신규 주문입니다.", upload });
      continue;
    }
    const uploadItem = items[0];
    const exactMatch = matchedOrders.find((o) =>
      (itemsByOrderId.get(o.id) ?? []).some(
        (it) => it.product_name === uploadItem.product_name && it.option_name === uploadItem.option_name && it.quantity === uploadItem.quantity
      )
    );
    if (exactMatch) {
      results.push({
        groupKey,
        status: "confirmed_duplicate",
        reason: "이미 등록된 주문입니다.",
        upload,
        existing: snapshotOfExisting(orderById.get(exactMatch.id)!),
      });
      continue;
    }
    results.push({
      groupKey,
      status: "candidate",
      reason: "이미 등록된 주문과 비슷한 정보가 있습니다. 확인 후 등록해주세요.",
      upload,
      existing: snapshotOfExisting(matchedOrders[0]),
    });
  }

  return {
    totalGroups: results.length,
    newCount: results.filter((r) => r.status === "new").length,
    confirmedDuplicateCount: results.filter((r) => r.status === "confirmed_duplicate").length,
    candidateCount: results.filter((r) => r.status === "candidate").length,
    errorCount: results.filter((r) => r.status === "error").length,
    groups: results,
  };
}
