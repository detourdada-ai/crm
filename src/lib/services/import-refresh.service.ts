import "server-only";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { orderShipmentsRepository } from "@/lib/repositories/order-shipments.repository";
import { parseDeliveryDateFromOption } from "@/lib/utils/delivery-date";
import { kstDayDateStrOf } from "@/lib/utils/kst-date";
import { getMapped, cellToString, parseOptionalDate } from "@/lib/services/import.service";
import type { ColumnMapping, ParsedSheet } from "@/types/excel";

/**
 * STEP22 최종(CPO 승인, 2026-09-08) — "당일 배송 최신화" 판정.
 *
 * 사장님이 선택한 **배송일 하루**의 배송 목록을 이번 파일 기준으로 맞춘다.
 * 그 배송일에서 이번 파일에 없는 배송건은 배송 대상에서 제외(취소)한다.
 *
 * ── 반드시 배송건(order_shipments) 단위다 ────────────────────────────
 * 한 주문이 여러 배송일에 걸치는 것이 실데이터로 확인됐다(스마트스토어 옵션의
 * "날짜 선택"이 상품주문마다 다르다). 그래서 orders 단위로 취소/유지를 판단하면
 * 같은 주문의 다른 날짜 배송분까지 함께 취소된다. 판정도 취소도 배송건 단위로 한다.
 *
 * ── 건드리지 않는 것 ──────────────────────────────────────────────────
 *   완료 · 이미 취소 · 배송중(정책 미확정) · 수기 주문(import_id null) · 다른 배송일
 *   그리고 어떤 경우에도 행을 지우지 않는다(cancelMany는 UPDATE만 한다).
 */

export interface RefreshPreview {
  /** 선택한 배송일에 해당하는 **파일 안의** 상품주문 수. 0이면 날짜를 잘못 고른 것으로 보고 차단한다. */
  fileRowsOnDate: number;
  /** 선택한 배송일의 기존 배송건 수(완료·취소·수기 제외). */
  existingShipments: number;
  /** 파일에 없어서 제외될 배송건(배송대기만). */
  toExcludeShipmentIds: string[];
  /** 파일에 없지만 배송중이라 자동 취소하지 않는 배송건 — "확인 필요"로만 보여준다. */
  inProgressShipmentIds: string[];
  /** 차단 사유. null이면 진행 가능. */
  blockedReason: string | null;
}

/**
 * 파일 한 행의 배송일을 산출한다 — `runImport`와 **같은 규칙**이다.
 * 옵션정보의 "날짜 선택"이 우선이고, 없으면 매핑된 배송일 컬럼을 쓴다.
 * (runImport의 해당 로직을 건드리지 않기 위해 규칙만 그대로 옮겨 둔다.)
 */
function rowDeliveryDate(row: Record<string, unknown>, mapping: ColumnMapping): string | null {
  const orderDateRaw = parseOptionalDate(getMapped(row, mapping, "order_date"));
  const reference = orderDateRaw ? new Date(orderDateRaw) : new Date();
  const fromOption = parseDeliveryDateFromOption(cellToString(getMapped(row, mapping, "option_name")), reference);
  return fromOption ?? parseOptionalDate(getMapped(row, mapping, "delivery_date"));
}

/**
 * 최신화 대상을 계산한다. **읽기 전용** — 여기서는 아무것도 바꾸지 않는다.
 * 분석 단계의 미리보기와 확정 단계의 실제 실행이 **같은 함수**를 쓴다
 * (브라우저가 보낸 숫자를 믿지 않고 확정 시점에 서버가 다시 계산한다 — 기존 중복판정과 같은 원칙).
 */
export async function computeRefreshTargets(input: {
  parsed: ParsedSheet;
  mapping: ColumnMapping;
  ownerUsername: string;
  deliveryDate: string;
}): Promise<RefreshPreview> {
  const { parsed, mapping, ownerUsername, deliveryDate } = input;

  // 1. 파일에 등장한 상품주문번호 전체 — 배송일이 바뀐 건도 "파일에 있음"으로 본다.
  const ponsInFile = new Set(
    parsed.rows
      .map((row) => cellToString(getMapped(row, mapping, "product_order_number")))
      .filter((v): v is string => !!v)
  );

  // 2. 그중 선택한 배송일에 해당하는 행 수 — 날짜 오선택 차단에 쓴다.
  const fileRowsOnDate = parsed.rows.filter((row) => {
    const d = rowDeliveryDate(row, mapping);
    return d !== null && kstDayDateStrOf(d) === deliveryDate;
  }).length;

  // 3. 선택한 배송일의 기존 배송건 — findByDeliveryDate는 '취소'를 이미 제외한다.
  const board = await orderShipmentsRepository.findByDeliveryDate(deliveryDate, ownerUsername, deliveryDate);
  const active = board.filter(
    (row) => row.delivery_status !== "완료" && row.import_id !== null // 완료 보호 + 수기 주문 보호
  );

  // 4. 각 배송건이 파일에 있는지 — 그 배송건의 상품주문번호 중 하나라도 파일에 있으면 유지.
  const items = await ordersRepository.findItemsByShipmentIds(active.map((s) => s.shipmentId));
  const ponsByShipment = new Map<string, string[]>();
  for (const it of items) {
    if (!it.shipment_id) continue;
    const list = ponsByShipment.get(it.shipment_id) ?? [];
    if (it.product_order_number) list.push(it.product_order_number);
    ponsByShipment.set(it.shipment_id, list);
  }

  const toExcludeShipmentIds: string[] = [];
  const inProgressShipmentIds: string[] = [];
  for (const s of active) {
    const pons = ponsByShipment.get(s.shipmentId) ?? [];
    // 상품주문번호가 아예 없는 배송건(표준 엑셀 유래)은 파일과 대조할 근거가 없다 — 건드리지 않는다.
    if (pons.length === 0) continue;
    const inFile = pons.some((p) => ponsInFile.has(p));
    if (inFile) continue;
    if (s.delivery_status === "배송중") inProgressShipmentIds.push(s.shipmentId);
    else toExcludeShipmentIds.push(s.shipmentId);
  }

  // 5. 차단 판정 — 실수로 그 날짜 전체를 취소시키는 것을 막는 필수 안전장치.
  let blockedReason: string | null = null;
  if (fileRowsOnDate === 0) {
    blockedReason = `이 파일에 ${deliveryDate} 배송 주문이 없습니다. 배송일을 잘못 선택했을 수 있어 최신화를 진행할 수 없습니다.`;
  }

  return {
    fileRowsOnDate,
    existingShipments: active.length,
    toExcludeShipmentIds,
    inProgressShipmentIds,
    blockedReason,
  };
}
