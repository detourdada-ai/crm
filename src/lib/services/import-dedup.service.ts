import "server-only";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { orderShipmentsRepository } from "@/lib/repositories/order-shipments.repository";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { formatPhoneNumber } from "@/lib/utils/phone";
import { cleanAddress, normalizeAddressForCompare } from "@/lib/utils/address";
import { parseDeliveryDateFromOption } from "@/lib/utils/delivery-date";
import { kstDayDateStrOf } from "@/lib/utils/kst-date";
import {
  getMapped,
  cellToString,
  parseNumber,
  parseOptionalDate,
  parseOrderDate,
  resolvePaymentStatusCell,
  NO_ORDER_NUMBER_PREFIX,
  REPEAT_ORDER_NUMBER_CONFIRM_THRESHOLD,
} from "@/lib/services/import.service";
import type {
  ParsedSheet,
  ColumnMapping,
  DedupAnalysis,
  DedupGroupResult,
  DedupOrderSnapshot,
  DedupProductOrderItem,
  DedupIdentityConflictEntry,
  DedupRepeatRowEntry,
} from "@/types/excel";

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
 * §CPO 작업지시(누적 표준 엑셀 중복방지, 2026-08 / STEP2 재설계): Analyze
 * 단계에서 호출하는 읽기 전용 중복 판정 — DB에 아무 것도 쓰지 않는다.
 * import.service.ts의 runImport()가 Confirm 시점에 사실상 동일한 규칙으로
 * 다시 계산하므로(§7 "서버 재검증", 브라우저 판단을 신뢰하지 않음), 이
 * 함수의 결과는 어디까지나 사용자에게 보여줄 미리보기다.
 *
 * STEP2 핵심 변경: 중복판정의 1차 키를 order_number(부모)에서
 * product_order_number(상품주문)로 바꿨다. order_number는 이제 "이 신규
 * 상품주문을 어느 부모 주문에 붙일지"를 결정하는 연결 정보로만 쓰인다.
 * 한 부모 주문 아래 일부 상품주문은 이미 등록되어 있고 일부는 신규인
 * "혼재(partial)" 그룹을 정확히 구분해야, 8/26 배송분처럼 부모 주문이
 * 이미 존재한다는 이유만으로 신규 상품주문까지 막히는 사고를 막을 수 있다
 * (CPO 작업지시서 §3-2/§8 Case B/D, 실 데이터 검증 기준: 421행/220개 부모
 * 주문/421개 상품주문).
 *
 * product_order_number 컬럼 자체가 매핑되지 않은 파일(표준 엑셀 등)은
 * 상품주문 단위 식별자가 없으므로, 그 경우에만 예전과 동일한 "부모 주문
 * 전체 단위" 판정으로 폴백한다(§9).
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

  // Phase 2 §5(2026-08 CPO 작업지시): Confirm 이전 미리보기에도 "결제상태
  // 인식불가" 경고를 노출한다 — import.service.ts(Confirm)와 동일한 판정
  // 함수(resolvePaymentStatusCell)를 재사용해 결과가 어긋나지 않게 한다.
  let unrecognizedPaymentStatusCount = 0;
  for (const [, entries] of groups) {
    const cell = cellToString(getMapped(entries[0].row, mapping, "payment_status"));
    if (!resolvePaymentStatusCell(cell).recognized) unrecognizedPaymentStatusCount += 1;
  }

  const realGroupKeys = Array.from(groups.keys()).filter((k) => !k.startsWith(NO_ORDER_NUMBER_PREFIX));
  const hasProductOrderNumberColumn = !!mapping["product_order_number"];
  const noOrderNumberPhones = new Set<string>();
  for (const [key, entries] of groups) {
    if (!key.startsWith(NO_ORDER_NUMBER_PREFIX)) continue;
    const formatted = formatPhoneNumber(cellToString(getMapped(entries[0].row, mapping, "phone")));
    if (formatted) noOrderNumberPhones.add(formatted);
  }

  // STEP2: existingParentOrders가 findExistingOrderNumbers를 대체한다 —
  // "이 order_number가 이 tenant에 이미 있는가"와 "그 주문 객체 자체"를
  // 한 번의 조회로 같이 얻는다(불필요한 중복 쿼리 제거).
  const [existingParentOrders, globallyExistingOrderNumbers, candidateOrders] = await Promise.all([
    ordersRepository.findOrdersByOrderNumbersForTenant(realGroupKeys, tenant.id),
    ordersRepository.findGloballyExistingOrderNumbers(realGroupKeys),
    ordersRepository.findByPhonesForDedup(tenant.id, [...noOrderNumberPhones]),
  ]);
  const crossTenantConflicts = new Set([...globallyExistingOrderNumbers].filter((n) => !existingParentOrders.has(n)));
  const candidateItems = await ordersRepository.findItemsByOrderIds(candidateOrders.map((o) => o.id));
  const itemsByOrderId = new Map<string, typeof candidateItems>();
  for (const item of candidateItems) {
    const list = itemsByOrderId.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrderId.set(item.order_id, list);
  }
  const orderById = new Map(candidateOrders.map((o) => [o.id, o]));

  // STEP2: 이미 부모 주문이 존재하는 그룹의 상품주문번호를 전부 모아 한 번에
  // 조회한다 — 존재 여부(Set)가 아니라 실제 행(shipment_id 포함)이 필요하다
  // (§6/QA-7 "정보 차이 표시"를 위해 배송일까지 비교해야 함).
  const allProductOrderNumbers: string[] = [];
  if (hasProductOrderNumberColumn) {
    for (const key of realGroupKeys) {
      if (!existingParentOrders.has(key)) continue; // 부모가 없으면 애초에 전부 신규 — 조회 불필요
      for (const entry of groups.get(key)!) {
        const pon = cellToString(getMapped(entry.row, mapping, "product_order_number"));
        if (pon) allProductOrderNumbers.push(pon);
      }
    }
  }
  const existingProductOrderItems = await ordersRepository.findExistingProductOrderItems(allProductOrderNumbers, tenant.id);
  const existingItemByProductOrderNumber = new Map(existingProductOrderItems.map((it) => [it.product_order_number as string, it]));
  const existingShipments = await orderShipmentsRepository.findByOrderIds([...existingParentOrders.values()].map((o) => o.id));
  const shipmentById = new Map(existingShipments.map((s) => [s.id, s]));

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
      // 주문관리·표준엑셀·배송관리 UX 개선(2026-08 CPO 작업지시) §3-2/§4 Phase1:
      // product_order_number가 없는 파일(표준 엑셀 등)에서는 이 order_number
      // 그룹의 여러 행이 실제로 같은 고객인지 검증할 방법이 이것뿐이다 — 이름/
      // 전화/주소가 전부 같지 않으면 절대 자동으로 한 주문으로 병합하지 않는다
      // (Case C/D: 실수로 서로 다른 고객에게 같은 주문번호를 입력한 경우, 병합하면
      // 첫 번째 고객만 남고 나머지 고객정보가 사라진다 — 실제 재현으로 확인된
      // 데이터 유실 결함).
      if (!hasProductOrderNumberColumn && rows.length > 1) {
        const rowIdentities = rows.map((row) => {
          const rPhoneRaw = cellToString(getMapped(row, mapping, "phone")) || null;
          const rAddressRaw = cellToString(getMapped(row, mapping, "address")) || null;
          const rBuyerName = cellToString(getMapped(row, mapping, "buyer_name")) || null;
          const rBuyerId = cellToString(getMapped(row, mapping, "buyer_id")) || null;
          const rRawName = cellToString(getMapped(row, mapping, "recipient_name"));
          const rName = rRawName || rBuyerName || (rBuyerId ? `구매자(${rBuyerId})` : "") || "이름 미확인";
          const rPhone = formatPhoneNumber(rPhoneRaw);
          const rAddressNormalized = normalizeAddressForCompare(rAddressRaw);
          return {
            key: `${rName}|${rPhone ?? ""}|${rAddressNormalized ?? ""}`,
            recipientName: rName,
            phone: rPhone,
            address: cleanAddress(rAddressRaw),
            productName: cellToString(getMapped(row, mapping, "product_name")) || "상품",
            optionName: cellToString(getMapped(row, mapping, "option_name")) || null,
            quantity: parseNumber(getMapped(row, mapping, "quantity")) || 1,
          };
        });
        const distinctKeys = new Set(rowIdentities.map((r) => r.key));
        if (distinctKeys.size > 1) {
          const seen = new Map<string, DedupIdentityConflictEntry>();
          for (const r of rowIdentities) {
            if (seen.has(r.key)) continue;
            seen.set(r.key, {
              recipientName: r.recipientName,
              phone: r.phone,
              address: r.address,
              productSummary: productSummaryOf([{ product_name: r.productName, option_name: r.optionName, quantity: r.quantity }]),
            });
          }
          results.push({
            groupKey,
            status: "identity_conflict",
            reason: `[${orderNumber}] 주문번호가 같지만 서로 다른 고객 정보가 섞여 있어 등록하지 않았습니다.`,
            upload,
            conflictingIdentities: [...seen.values()],
          });
          continue;
        }
        // Phase 2(2026-08 CPO 작업지시) §2: 고객은 같지만(distinctKeys.size===1)
        // 같은 order_number를 2건 이상 반복 사용한 경우 — "진짜 하나의 다상품
        // 주문"일 수도, "같은 고객이 서로 다른 시점에 주문하며 번호를 실수로
        // 반복 입력"한 것일 수도 있다. 시스템이 임의로 병합을 확정하지 않고
        // 사용자가 상품/배송일을 보고 병합/분리를 직접 고른다(기본값은 미등록).
        if (rows.length >= REPEAT_ORDER_NUMBER_CONFIRM_THRESHOLD) {
          const repeatRows: DedupRepeatRowEntry[] = items.map((item, i) => ({
            productSummary: productSummaryOf([item]),
            deliveryDate: itemDeliveryDates[i] ?? explicitDeliveryDate ?? null,
          }));
          results.push({
            groupKey,
            status: "repeat_confirm_needed",
            reason: `[${orderNumber}] 같은 주문번호가 ${rows.length}개 행에서 사용되었습니다. 하나의 주문인지 확인해주세요.`,
            upload,
            repeatRows,
          });
          continue;
        }
      }

      const existingParent = existingParentOrders.get(orderNumber!);

      if (!existingParent) {
        // Case A(§8): 부모 주문 자체가 이 tenant에 없다 — 새로 만들어야 하므로
        // orders.order_number 전역 UNIQUE와의 충돌만 확인하면 된다. 부모가
        // 없다는 건 그 안의 상품주문 전부가 확실히 신규라는 뜻이라 개별
        // product_order_number 조회는 필요 없다.
        if (crossTenantConflicts.has(orderNumber!)) {
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

      // Case B/C/D(§8): 부모 주문이 이미 이 tenant에 존재한다.
      if (!hasProductOrderNumberColumn) {
        // §9: 상품주문번호 컬럼 자체가 없는 파일 — 예전과 동일하게 부모 주문
        // 단위로만 판정한다(폴백, 회귀 없음).
        results.push({
          groupKey,
          status: "confirmed_duplicate",
          reason: "이미 등록된 주문입니다.",
          upload,
          existing: snapshotOfExisting(existingParent),
        });
        continue;
      }

      const productOrderItems: DedupProductOrderItem[] = rows.map((row, i) => {
        const pon = cellToString(getMapped(row, mapping, "product_order_number"));
        const item = items[i];
        const itemDeliveryDate = itemDeliveryDates[i] ?? explicitDeliveryDate ?? null;
        const productSummary = productSummaryOf([item]);
        if (!pon) {
          // 부모 그룹에는 상품주문번호가 있는 행도 있는데 이 행만 비어있는
          // 이례적인 경우 — 식별할 수 없으므로 안전하게 신규로만 취급한다.
          return { productOrderNumber: `(미확인)`, status: "new", productSummary, deliveryDate: itemDeliveryDate };
        }
        const existingItem = existingItemByProductOrderNumber.get(pon);
        if (!existingItem) {
          return { productOrderNumber: pon, status: "new", productSummary, deliveryDate: itemDeliveryDate };
        }
        const existingShipment = existingItem.shipment_id ? shipmentById.get(existingItem.shipment_id) : undefined;
        const infoDiffers =
          (!!itemDeliveryDate &&
            !!existingShipment?.delivery_date &&
            kstDayDateStrOf(itemDeliveryDate) !== kstDayDateStrOf(existingShipment.delivery_date)) ||
          (!!rawAddress && normalizeAddressForCompare(existingParent.address_snapshot) !== addressNormalized);
        return { productOrderNumber: pon, status: "confirmed_duplicate", productSummary, deliveryDate: itemDeliveryDate, infoDiffers };
      });

      const allExisting = productOrderItems.every((i) => i.status === "confirmed_duplicate");
      const allNew = productOrderItems.every((i) => i.status === "new");
      if (allExisting) {
        results.push({
          groupKey,
          status: "confirmed_duplicate",
          reason: "이미 등록된 주문입니다.",
          upload,
          existing: snapshotOfExisting(existingParent),
          // §6/QA-7: 그룹 전체가 이미 등록된 경우에도 "정보 차이"(배송일/주소가
          // 이번 업로드 값과 다름)는 사용자에게 보여줘야 한다 — partial 그룹만
          // productOrderItems를 채우면 단일 상품주문 그룹의 정보 차이가 조용히
          // 사라진다.
          productOrderItems,
        });
      } else if (allNew) {
        // 부모는 있는데 그 안의 상품주문이 전부 신규 — 이론상 드물지만(부모
        // 생성 시점에 최소 1건은 등록됐어야 함) 방어적으로 신규 처리한다.
        results.push({ groupKey, status: "new", reason: "신규 주문입니다.", upload });
      } else {
        results.push({
          groupKey,
          status: "partial",
          reason: "이 주문번호의 상품주문 중 일부는 이미 등록되어 있고, 일부는 신규입니다.",
          upload,
          existing: snapshotOfExisting(existingParent),
          productOrderItems,
        });
      }
      continue;
    }

    // 주문번호 없는 행: 고객(전화+이름+정규화주소 완전일치) + 배송일이 같은
    // 기존 주문을 찾는다 — 둘 중 하나라도 없으면(배송일 미확인 등) 안전하게
    // "신규"로 분류한다(§CPO: 과도한 자동 확정 금지). 이 경로는 STEP2에서
    // 변경하지 않는다(product_order_number가 없는 표준 엑셀 전용 보조 판정).
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

  // STEP2: 카운트는 "상품주문(엑셀 원본 행)" 단위로 집계한다 — partial
  // 그룹은 내부 productOrderItems 각각의 상태로, 그 외 그룹은 그룹 전체
  // status를 그 그룹의 행 수(rows.length)만큼 반영한다. CPO 요구사항:
  // "421건 중 각 상품주문이 어떤 판정을 받았는지 숫자로 보고 가능해야 한다."
  let totalProductOrders = 0;
  let newCount = 0;
  let confirmedDuplicateCount = 0;
  let candidateCount = 0;
  let errorCount = 0;
  // §3-2/§4 Phase1: identity_conflict는 errorCount에도 접혀 들어가 기존
  // newCount+confirmedDuplicateCount+candidateCount+errorCount===totalProductOrders
  // 불변식을 유지하면서, 화면에서 "왜 오류인지"를 구분해 보여줄 수 있도록
  // identityConflictCount로 별도 추적한다.
  let identityConflictCount = 0;
  // Phase 2 §2: repeat_confirm_needed는 candidateCount와 같은 성격의 별도
  // 버킷이다(오류가 아니라, 사용자가 병합/분리를 직접 골라야 미등록 상태를
  // 벗어난다) — newCount+confirmedDuplicateCount+candidateCount+errorCount+
  // repeatConfirmCount === totalProductOrders 불변식을 이룬다.
  let repeatConfirmCount = 0;
  const resultByGroupKey = new Map(results.map((r) => [r.groupKey, r]));
  for (const [groupKey, entries] of groups) {
    const result = resultByGroupKey.get(groupKey)!;
    const rowCount = entries.length;
    totalProductOrders += rowCount;
    if (result.status === "partial" && result.productOrderItems) {
      for (const item of result.productOrderItems) {
        if (item.status === "new") newCount += 1;
        else confirmedDuplicateCount += 1;
      }
      continue;
    }
    if (result.status === "identity_conflict") {
      identityConflictCount += rowCount;
      errorCount += rowCount;
    } else if (result.status === "repeat_confirm_needed") repeatConfirmCount += rowCount;
    else if (result.status === "new") newCount += rowCount;
    else if (result.status === "confirmed_duplicate") confirmedDuplicateCount += rowCount;
    else if (result.status === "candidate") candidateCount += rowCount;
    else if (result.status === "error") errorCount += rowCount;
  }

  return {
    totalGroups: results.length,
    totalProductOrders,
    newCount,
    confirmedDuplicateCount,
    candidateCount,
    errorCount,
    identityConflictCount,
    repeatConfirmCount,
    unrecognizedPaymentStatusCount,
    groups: results,
  };
}
