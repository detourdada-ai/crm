import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { OrderTable } from "@/components/orders/order-table";
import { OrderFilterBar } from "@/components/orders/order-filter-bar";
import { OrderStatusChips, type OrderStatusChipCount } from "@/components/orders/order-status-chips";
import { ManualOrderButton } from "@/components/orders/manual-order-button";
import { OrderColumnSelector } from "@/components/orders/order-column-selector";
import { PaginationControls } from "@/components/common/pagination-controls";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ClipboardList } from "lucide-react";
import { searchOrdersAction } from "@/actions/orders";
import { getColumnViewAction, getAvailableExtraColumnsAction } from "@/actions/column-view";
import { ORDER_TABLE_TOGGLEABLE_COLUMN_IDS } from "@/lib/constants/order-table-columns";
import { requireSession } from "@/lib/auth/current-session";
import { getTenantFeaturesForSession } from "@/lib/tenant/features";
import { isValidDateString } from "@/lib/utils/date";
import { DELIVERY_STATUS_OPTIONS } from "@/lib/constants/delivery-status";
import {
  kstTodayIso,
  resolveKstQuickRange,
  isQuickDateFilter,
  DELIVERY_DATE_QUICK_OPTIONS,
  type QuickDateFilterValue,
} from "@/lib/utils/kst-date";
import { isOrderSource } from "@/lib/constants/order-source";
import type { OrderSortField } from "@/lib/repositories/orders.repository";
import type { DeliveryStatus } from "@/types/domain";

const PAGE_SIZE = 20;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    orderDateFilter?: string;
    orderDateFrom?: string;
    orderDateTo?: string;
    deliveryDateFilter?: string;
    deliveryDateFrom?: string;
    deliveryDateTo?: string;
    deliveryStatus?: string;
    orderSource?: string;
    q?: string;
    bagReturned?: string;
    sort?: string;
    dir?: string;
    product?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Number(params.page) > 0 ? Number(params.page) : 1;
  const today = kstTodayIso();

  // S1-3: "오늘 발송할 상품주문만 오늘 화면에 보여준다"가 주문관리의 기본
  // 화면이어야 한다는 CEO 지시로, 배송일 기본값을 오늘로, 주문일 기본값을
  // 전체로 뒤집었다(Phase 4-B STEP3 때의 반대).
  const orderDateFilter: QuickDateFilterValue = isQuickDateFilter(params.orderDateFilter) ? params.orderDateFilter : "all";
  const orderRange =
    orderDateFilter === "custom"
      ? {
          start: isValidDateString(params.orderDateFrom) ? params.orderDateFrom! : today,
          end: isValidDateString(params.orderDateTo) ? params.orderDateTo! : today,
        }
      : orderDateFilter === "all"
        ? null
        : resolveKstQuickRange(orderDateFilter, today);
  const orderDateFrom = orderRange?.start;
  const orderDateTo = orderRange?.end;

  const deliveryDateFilter: QuickDateFilterValue = isQuickDateFilter(params.deliveryDateFilter)
    ? params.deliveryDateFilter
    : "today";
  const deliveryRange =
    deliveryDateFilter === "all"
      ? null
      : deliveryDateFilter === "custom"
        ? {
            start: isValidDateString(params.deliveryDateFrom) ? params.deliveryDateFrom! : today,
            end: isValidDateString(params.deliveryDateTo) ? params.deliveryDateTo! : today,
          }
        : resolveKstQuickRange(deliveryDateFilter, today);
  const deliveryDateFrom = deliveryRange?.start;
  const deliveryDateTo = deliveryRange?.end;

  const activeStatus = (params.deliveryStatus as DeliveryStatus | undefined) ?? "all";
  const commonDateFilter = { orderDateFrom, orderDateTo, deliveryDateFrom, deliveryDateTo };

  const session = await requireSession();
  const [
    features,
    savedColumnView,
    availableExtraColumns,
    { orders, total, itemSummaries, driverNames, productSummary },
    { total: allTimeTotal },
    ...statusCounts
  ] = await Promise.all([
    getTenantFeaturesForSession(session),
    getColumnViewAction("orders"),
    getAvailableExtraColumnsAction(),
    searchOrdersAction({
      page,
      pageSize: PAGE_SIZE,
      deliveryStatus: params.deliveryStatus as DeliveryStatus | undefined,
      orderSource: params.orderSource && isOrderSource(params.orderSource) ? params.orderSource : undefined,
      query: params.q,
      bagReturned: params.bagReturned === "true" ? true : params.bagReturned === "false" ? false : undefined,
      ...commonDateFilter,
      sortBy: (params.sort as OrderSortField) || "delivery_date",
      sortAscending: params.dir === "asc",
      productName: params.product,
      includeProductSummary: true,
    }),
    // Phase 6 STEP10: 필터 때문에 0건인 것과 애초에 주문이 하나도 없는 것을
    // 구분하기 위한 무필터 카운트 — EmptyState 문구/액션을 다르게 보여준다.
    searchOrdersAction({ pageSize: 1 }),
    searchOrdersAction({ pageSize: 1, ...commonDateFilter }),
    ...DELIVERY_STATUS_OPTIONS.map((status) => searchOrdersAction({ pageSize: 1, deliveryStatus: status, ...commonDateFilter })),
  ]);

  const chipCounts: OrderStatusChipCount[] = [
    { status: "all", label: "전체", count: statusCounts[0].total },
    ...DELIVERY_STATUS_OPTIONS.map((status, i) => ({ status, label: status, count: statusCounts[i + 1].total })),
  ];

  function buildStatusHref(status: DeliveryStatus | "all") {
    const search = new URLSearchParams();
    if (params.orderDateFilter) search.set("orderDateFilter", params.orderDateFilter);
    if (params.orderDateFrom) search.set("orderDateFrom", params.orderDateFrom);
    if (params.orderDateTo) search.set("orderDateTo", params.orderDateTo);
    if (params.deliveryDateFilter) search.set("deliveryDateFilter", params.deliveryDateFilter);
    if (params.deliveryDateFrom) search.set("deliveryDateFrom", params.deliveryDateFrom);
    if (params.deliveryDateTo) search.set("deliveryDateTo", params.deliveryDateTo);
    if (params.bagReturned) search.set("bagReturned", params.bagReturned);
    if (params.orderSource) search.set("orderSource", params.orderSource);
    if (params.q) search.set("q", params.q);
    if (params.sort) search.set("sort", params.sort);
    if (params.dir) search.set("dir", params.dir);
    if (params.product) search.set("product", params.product);
    if (status !== "all") search.set("deliveryStatus", status);
    const qs = search.toString();
    return qs ? `/orders?${qs}` : "/orders";
  }

  // S2-C STEP5: 지금 화면에 적용된 필터 그대로 Excel API를 호출하기 위한
  // 쿼리스트링 — buildStatusHref와 같은 값들이지만 deliveryStatus는
  // status칩이 아니라 현재 activeStatus를 그대로 넘긴다.
  function buildExportHref() {
    const search = new URLSearchParams();
    if (params.orderDateFilter) search.set("orderDateFilter", params.orderDateFilter);
    if (params.orderDateFrom) search.set("orderDateFrom", params.orderDateFrom);
    if (params.orderDateTo) search.set("orderDateTo", params.orderDateTo);
    if (params.deliveryDateFilter) search.set("deliveryDateFilter", params.deliveryDateFilter);
    if (params.deliveryDateFrom) search.set("deliveryDateFrom", params.deliveryDateFrom);
    if (params.deliveryDateTo) search.set("deliveryDateTo", params.deliveryDateTo);
    if (params.bagReturned) search.set("bagReturned", params.bagReturned);
    if (params.orderSource) search.set("orderSource", params.orderSource);
    if (params.q) search.set("q", params.q);
    if (params.sort) search.set("sort", params.sort);
    if (params.dir) search.set("dir", params.dir);
    if (params.deliveryStatus) search.set("deliveryStatus", params.deliveryStatus);
    if (params.product) search.set("product", params.product);
    const qs = search.toString();
    return qs ? `/api/orders/export?${qs}` : "/api/orders/export";
  }

  const resolvedVisibleColumns = savedColumnView ?? ORDER_TABLE_TOGGLEABLE_COLUMN_IDS;

  const deliveryRangeLabel =
    deliveryDateFilter === "all"
      ? "전체 기간"
      : deliveryDateFilter === "custom"
        ? "선택한 기간"
        : (DELIVERY_DATE_QUICK_OPTIONS.find((o) => o.value === deliveryDateFilter)?.label ?? "선택한 기간");

  return (
    <div className="space-y-6">
      <PageHeader
        title="주문관리"
        description={`${deliveryRangeLabel} 발송할 상품주문(배송일 기준)을 확인하고 처리하세요. 주문일 필터는 기본적으로 전체입니다.`}
        action={
          <div className="flex items-center gap-2">
            <OrderColumnSelector viewId="orders" visibleColumns={resolvedVisibleColumns} extraColumns={availableExtraColumns} />
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href={buildExportHref()}>
                <Download className="size-4" />
                Excel 다운로드
              </a>
            </Button>
            <ManualOrderButton />
          </div>
        }
      />

      <OrderStatusChips counts={chipCounts} active={activeStatus} buildHref={buildStatusHref} />

      <OrderFilterBar
        orderDateFilter={orderDateFilter}
        orderDateFrom={orderDateFrom ?? today}
        orderDateTo={orderDateTo ?? today}
        deliveryDateFilter={deliveryDateFilter}
        deliveryDateFrom={deliveryDateFrom ?? today}
        deliveryDateTo={deliveryDateTo ?? today}
        bagManagementEnabled={features.bagManagement}
        productOptions={productSummary}
      />

      {total === 0 ? (
        allTimeTotal === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="주문이 없습니다."
            description="엑셀로 주문을 업로드하거나 전화·현장 주문을 직접 등록해보세요."
            action={<ManualOrderButton />}
          />
        ) : (
          <EmptyState
            icon={ClipboardList}
            title="조건에 맞는 주문이 없습니다."
            description="선택한 기간·상태 필터에 해당하는 주문이 없습니다. 필터를 초기화하면 전체 주문을 볼 수 있습니다."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/orders">필터 초기화</Link>
              </Button>
            }
          />
        )
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <OrderTable
              orders={orders}
              itemSummaries={itemSummaries}
              driverNames={driverNames}
              showCustomerLink
              showOwner={session.role === "admin"}
              bagManagementEnabled={features.bagManagement}
              visibleColumns={resolvedVisibleColumns}
            />
            <PaginationControls page={page} pageSize={PAGE_SIZE} total={total} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
