import { Card, CardContent } from "@/components/ui/card";
import { OrderTable } from "@/components/orders/order-table";
import { OrderFilterBar } from "@/components/orders/order-filter-bar";
import { OrderStatusChips, type OrderStatusChipCount } from "@/components/orders/order-status-chips";
import { ManualOrderButton } from "@/components/orders/manual-order-button";
import { PaginationControls } from "@/components/common/pagination-controls";
import { PageHeader } from "@/components/common/page-header";
import { searchOrdersAction } from "@/actions/orders";
import { requireSession } from "@/lib/auth/current-session";
import { resolvePeriodRange } from "@/lib/services/settlement.service";
import { isValidDateString } from "@/lib/utils/date";
import { DELIVERY_STATUS_OPTIONS } from "@/lib/constants/delivery-status";
import type { OrderSortField } from "@/lib/repositories/orders.repository";
import type { DeliveryStatus } from "@/types/domain";

const PAGE_SIZE = 20;

function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    orderDateFrom?: string;
    orderDateTo?: string;
    deliveryDate?: string;
    deliveryStatus?: string;
    bagReturned?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Number(params.page) > 0 ? Number(params.page) : 1;

  // 필터를 아직 지정하지 않았으면 주문일은 이번주, 배송일은 오늘로 기본 설정
  // (전체 이력을 한 번에 다 보여주면 목록이 너무 길어짐) — 필터 초기화도 이 기본값으로 돌아간다.
  const thisWeek = resolvePeriodRange("weekly", todayIso());
  const orderDateFrom = isValidDateString(params.orderDateFrom) ? params.orderDateFrom : thisWeek.start;
  const orderDateTo = isValidDateString(params.orderDateTo) ? params.orderDateTo : thisWeek.end;
  const deliveryDate = isValidDateString(params.deliveryDate) ? params.deliveryDate : todayIso();

  const activeStatus = (params.deliveryStatus as DeliveryStatus | undefined) ?? "all";
  const commonDateFilter = { orderDateFrom, orderDateTo, deliveryDate };

  const [session, { orders, total, itemSummaries, driverNames }, ...statusCounts] = await Promise.all([
    requireSession(),
    searchOrdersAction({
      page,
      pageSize: PAGE_SIZE,
      deliveryStatus: params.deliveryStatus as DeliveryStatus | undefined,
      bagReturned: params.bagReturned === "true" ? true : params.bagReturned === "false" ? false : undefined,
      ...commonDateFilter,
      sortBy: (params.sort as OrderSortField) || "delivery_date",
      sortAscending: params.dir === "asc",
    }),
    searchOrdersAction({ pageSize: 1, ...commonDateFilter }),
    ...DELIVERY_STATUS_OPTIONS.map((status) => searchOrdersAction({ pageSize: 1, deliveryStatus: status, ...commonDateFilter })),
  ]);

  const chipCounts: OrderStatusChipCount[] = [
    { status: "all", label: "전체", count: statusCounts[0].total },
    ...DELIVERY_STATUS_OPTIONS.map((status, i) => ({ status, label: status, count: statusCounts[i + 1].total })),
  ];

  function buildStatusHref(status: DeliveryStatus | "all") {
    const search = new URLSearchParams();
    if (params.orderDateFrom) search.set("orderDateFrom", params.orderDateFrom);
    if (params.orderDateTo) search.set("orderDateTo", params.orderDateTo);
    if (params.deliveryDate) search.set("deliveryDate", params.deliveryDate);
    if (params.bagReturned) search.set("bagReturned", params.bagReturned);
    if (params.sort) search.set("sort", params.sort);
    if (params.dir) search.set("dir", params.dir);
    if (status !== "all") search.set("deliveryStatus", status);
    const qs = search.toString();
    return qs ? `/orders?${qs}` : "/orders";
  }

  return (
    <div className="space-y-6">
      <PageHeader title="주문" description="오늘 들어온 주문을 확인하고 처리하세요." />

      <OrderStatusChips counts={chipCounts} active={activeStatus} buildHref={buildStatusHref} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <OrderFilterBar orderDateFrom={orderDateFrom} orderDateTo={orderDateTo} deliveryDate={deliveryDate} />
        <ManualOrderButton />
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <OrderTable
            orders={orders}
            itemSummaries={itemSummaries}
            driverNames={driverNames}
            showCustomerLink
            showOwner={session.role === "admin"}
            editableBag
          />
          <PaginationControls page={page} pageSize={PAGE_SIZE} total={total} />
        </CardContent>
      </Card>
    </div>
  );
}
