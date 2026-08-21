import { NextRequest, NextResponse } from "next/server";
import { searchOrdersAction } from "@/actions/orders";
import { requireSession } from "@/lib/auth/current-session";
import { buildExcelBuffer, excelDownloadHeaders } from "@/lib/services/excel-export.service";
import { isValidDateString } from "@/lib/utils/date";
import { kstTodayIso, resolveKstQuickRange, isQuickDateFilter, type QuickDateFilterValue } from "@/lib/utils/kst-date";
import { isOrderSource } from "@/lib/constants/order-source";
import type { OrderSortField } from "@/lib/repositories/orders.repository";
import type { DeliveryStatus } from "@/types/domain";

// 화면에서 페이지네이션 없이 한 번에 받아올 수 있는 최대 건수. 실제 운영
// 규모(수백~수천 건)에서는 여유 있는 상한이며, 넘는 경우엔 조용히 잘라
// 내려주는 대신 필터를 좁혀달라는 에러로 막는다(§12 "화면과 다르게 내려주지
// 않는다" 원칙 — 잘못된 부분 데이터를 조용히 주는 것보다 명시적으로 막는
// 쪽을 택한다).
const EXPORT_MAX_ROWS = 5000;

/**
 * S2-C STEP5: 주문관리(/orders) 화면과 정확히 같은 조회 조건으로 Excel을
 * 만든다. page.tsx의 날짜 필터 해석 로직과 반드시 동일하게 유지해야 한다 —
 * 둘 중 하나만 바뀌면 "화면=엑셀"이 깨진다.
 */
export async function GET(request: NextRequest) {
  const session = await requireSession();
  const params = request.nextUrl.searchParams;
  const today = kstTodayIso();

  const orderDateFilter: QuickDateFilterValue = isQuickDateFilter(params.get("orderDateFilter") ?? undefined)
    ? (params.get("orderDateFilter") as QuickDateFilterValue)
    : "all";
  const orderRange =
    orderDateFilter === "custom"
      ? {
          start: isValidDateString(params.get("orderDateFrom") ?? undefined) ? params.get("orderDateFrom")! : today,
          end: isValidDateString(params.get("orderDateTo") ?? undefined) ? params.get("orderDateTo")! : today,
        }
      : orderDateFilter === "all"
        ? null
        : resolveKstQuickRange(orderDateFilter, today);

  const deliveryDateFilter: QuickDateFilterValue = isQuickDateFilter(params.get("deliveryDateFilter") ?? undefined)
    ? (params.get("deliveryDateFilter") as QuickDateFilterValue)
    : "today";
  const deliveryRange =
    deliveryDateFilter === "all"
      ? null
      : deliveryDateFilter === "custom"
        ? {
            start: isValidDateString(params.get("deliveryDateFrom") ?? undefined) ? params.get("deliveryDateFrom")! : today,
            end: isValidDateString(params.get("deliveryDateTo") ?? undefined) ? params.get("deliveryDateTo")! : today,
          }
        : resolveKstQuickRange(deliveryDateFilter, today);

  const orderSourceParam = params.get("orderSource");
  const bagReturnedParam = params.get("bagReturned");

  const { orders, total, itemSummaries, driverNames } = await searchOrdersAction({
    page: 1,
    pageSize: EXPORT_MAX_ROWS,
    deliveryStatus: (params.get("deliveryStatus") as DeliveryStatus | null) ?? undefined,
    orderSource: orderSourceParam && isOrderSource(orderSourceParam) ? orderSourceParam : undefined,
    query: params.get("q") ?? undefined,
    bagReturned: bagReturnedParam === "true" ? true : bagReturnedParam === "false" ? false : undefined,
    orderDateFrom: orderRange?.start,
    orderDateTo: orderRange?.end,
    deliveryDateFrom: deliveryRange?.start,
    deliveryDateTo: deliveryRange?.end,
    sortBy: (params.get("sort") as OrderSortField) || "delivery_date",
    sortAscending: params.get("dir") === "asc",
  });

  if (total > orders.length) {
    return NextResponse.json(
      { error: `조회 결과가 ${total}건으로 한 번에 내려받을 수 있는 최대 건수(${EXPORT_MAX_ROWS}건)를 초과합니다. 기간·상태 필터를 좁혀주세요.` },
      { status: 400 }
    );
  }

  const rows = orders.map((o) => ({
    주문번호: o.internal_order_number ?? o.order_number ?? "-",
    출처: o.order_source,
    주문일: o.order_date ? o.order_date.slice(0, 10) : "-",
    배송일: o.delivery_date ? o.delivery_date.slice(0, 10) : "미지정",
    고객명: o.recipient_name,
    연락처: o.phone_snapshot ?? "-",
    주소: o.address_snapshot ?? "-",
    배송메모: o.delivery_memo ?? "",
    상품요약: itemSummaries[o.rowKey]?.productSummary ?? "-",
    수량: itemSummaries[o.rowKey]?.totalQuantity ?? 0,
    금액: itemSummaries[o.rowKey]?.totalAmount ?? o.total_amount ?? 0,
    배송상태: o.delivery_status,
    담당기사: o.driver_id ? (driverNames[o.driver_id] ?? "-") : "-",
    ...(session.role === "admin" ? { 담당자: o.owner_username } : {}),
  }));

  const buffer = buildExcelBuffer(rows, "주문목록");
  return new NextResponse(new Uint8Array(buffer), { headers: excelDownloadHeaders(`주문목록_${today}.xlsx`) });
}
