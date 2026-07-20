import { Card, CardContent } from "@/components/ui/card";
import { OrderTable } from "@/components/orders/order-table";
import { OrderFilterBar } from "@/components/orders/order-filter-bar";
import { ManualOrderButton } from "@/components/orders/manual-order-button";
import { PaginationControls } from "@/components/common/pagination-controls";
import { searchOrdersAction } from "@/actions/orders";
import { requireSession } from "@/lib/auth/current-session";
import { resolvePeriodRange } from "@/lib/services/settlement.service";
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
  const orderDateFrom = params.orderDateFrom ?? thisWeek.start;
  const orderDateTo = params.orderDateTo ?? thisWeek.end;
  const deliveryDate = params.deliveryDate ?? todayIso();

  const [session, { orders, total, itemSummaries, driverNames }] = await Promise.all([
    requireSession(),
    searchOrdersAction({
      page,
      pageSize: PAGE_SIZE,
      deliveryStatus: params.deliveryStatus as DeliveryStatus | undefined,
      bagReturned: params.bagReturned === "true" ? true : params.bagReturned === "false" ? false : undefined,
      orderDateFrom,
      orderDateTo,
      deliveryDate,
      sortBy: (params.sort as OrderSortField) || "delivery_date",
      sortAscending: params.dir === "asc",
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">주문관리</h1>
          <p className="text-sm text-muted-foreground">엑셀 업로드 또는 수동 등록으로 생성된 전체 주문 목록입니다.</p>
        </div>
        <ManualOrderButton />
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <OrderFilterBar orderDateFrom={orderDateFrom} orderDateTo={orderDateTo} deliveryDate={deliveryDate} />
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
