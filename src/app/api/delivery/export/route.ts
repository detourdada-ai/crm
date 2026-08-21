import { NextRequest, NextResponse } from "next/server";
import { getDeliveryBoardAction } from "@/actions/delivery";
import { requireSession } from "@/lib/auth/current-session";
import { buildExcelBuffer, excelDownloadHeaders } from "@/lib/services/excel-export.service";
import { isValidDateString } from "@/lib/utils/date";
import { kstTodayIso, resolveKstQuickRange, isQuickDateFilter, type QuickDateFilterValue } from "@/lib/utils/kst-date";
import { digitsOnly } from "@/lib/utils/phone";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";

const UNGROUPED_SENTINEL = "__ungrouped__";
const EXPORT_MAX_ROWS = 5000;

function isDeliveryFilter(value: string | null): value is "unassigned" | "assigned" | "배송중" | "완료" {
  return value === "unassigned" || value === "assigned" || value === "배송중" || value === "완료";
}

/**
 * S2-C STEP6: 배송관리(/delivery) 화면과 정확히 같은 조회+필터 조건으로
 * Excel을 만든다. delivery/page.tsx의 날짜 해석과 driverId/q/상태 필터,
 * delivery-board.tsx의 group 필터 로직을 그대로 복제한다 — 그 셋 중 하나만
 * 바뀌면 "화면=엑셀"이 깨지므로 수정 시 함께 맞춰야 한다.
 */
export async function GET(request: NextRequest) {
  await requireSession();
  const params = request.nextUrl.searchParams;
  const today = kstTodayIso();

  const dateFilter: QuickDateFilterValue = isQuickDateFilter(params.get("dateFilter") ?? undefined)
    ? (params.get("dateFilter") as QuickDateFilterValue)
    : "today";
  const range =
    dateFilter === "all"
      ? null
      : dateFilter === "custom"
        ? {
            start: isValidDateString(params.get("dateFrom") ?? undefined) ? params.get("dateFrom")! : today,
            end: isValidDateString(params.get("dateTo") ?? undefined) ? params.get("dateTo")! : today,
          }
        : resolveKstQuickRange(dateFilter, today);

  const boardResult = await getDeliveryBoardAction(range?.start ?? null, range?.end);
  let orders: OrderShipmentBoardRow[] = boardResult.orders;

  const driverId = params.get("driverId");
  if (driverId) orders = orders.filter((o) => o.driver_id === driverId);

  const q = params.get("q");
  if (q?.trim()) {
    const term = q.trim().toLowerCase();
    const qDigits = digitsOnly(q.trim());
    orders = orders.filter(
      (o) =>
        o.recipient_name.toLowerCase().includes(term) ||
        (o.phone_snapshot ?? "").includes(term) ||
        (qDigits.length >= 3 && digitsOnly(o.phone_snapshot ?? "").includes(qDigits)) ||
        (o.order_number ?? "").toLowerCase().includes(term)
    );
  }

  const activeFilter = params.get("filter");
  if (isDeliveryFilter(activeFilter)) {
    if (activeFilter === "배송중" || activeFilter === "완료") {
      orders = orders.filter((o) => o.delivery_status === activeFilter);
    } else if (activeFilter === "unassigned") {
      orders = orders.filter((o) => o.delivery_status === "배송대기" && !o.driver_id && o.fulfillment_method !== "direct_pickup");
    } else if (activeFilter === "assigned") {
      orders = orders.filter((o) => o.delivery_status === "배송대기" && (!!o.driver_id || o.fulfillment_method === "direct_pickup"));
    }
  }

  const group = params.get("group");
  if (group) {
    orders = group === UNGROUPED_SENTINEL ? orders.filter((o) => !o.delivery_group_id) : orders.filter((o) => o.delivery_group_id === group);
  }

  if (orders.length > EXPORT_MAX_ROWS) {
    return NextResponse.json(
      { error: `조회 결과가 ${orders.length}건으로 한 번에 내려받을 수 있는 최대 건수(${EXPORT_MAX_ROWS}건)를 초과합니다. 기간·필터를 좁혀주세요.` },
      { status: 400 }
    );
  }

  const driverNames = Object.fromEntries(boardResult.drivers.map((d) => [d.id, d.name]));

  const rows = orders.map((o) => ({
    주문번호: o.internal_order_number ?? o.order_number ?? "-",
    주문일: o.order_date ? o.order_date.slice(0, 10) : "-",
    배송일: o.delivery_date ? o.delivery_date.slice(0, 10) : "미지정",
    고객명: o.recipient_name,
    연락처: o.phone_snapshot ?? "-",
    주소: o.address_snapshot ?? "-",
    배송상태: o.delivery_status,
    배송기사: o.driver_id ? (driverNames[o.driver_id] ?? "-") : o.fulfillment_method === "direct_pickup" ? "직접수령" : "-",
    배송순서: o.route_order ?? "",
    배송완료여부: o.delivery_status === "완료" ? "완료" : "미완료",
  }));

  const buffer = buildExcelBuffer(rows, "배송목록");
  return new NextResponse(new Uint8Array(buffer), { headers: excelDownloadHeaders(`배송목록_${today}.xlsx`) });
}
