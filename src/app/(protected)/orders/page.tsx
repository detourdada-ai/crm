import { Card, CardContent } from "@/components/ui/card";
import { OrderTable } from "@/components/orders/order-table";
import { OrderFilterBar } from "@/components/orders/order-filter-bar";
import { ManualOrderButton } from "@/components/orders/manual-order-button";
import { PaginationControls } from "@/components/common/pagination-controls";
import { searchOrdersAction } from "@/actions/orders";
import { requireSession } from "@/lib/auth/current-session";
import type { OrderSortField } from "@/lib/repositories/orders.repository";
import type { DeliveryStatus } from "@/types/domain";

const PAGE_SIZE = 20;

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

  const [session, { orders, total, itemSummaries, driverNames }] = await Promise.all([
    requireSession(),
    searchOrdersAction({
      page,
      pageSize: PAGE_SIZE,
      deliveryStatus: params.deliveryStatus as DeliveryStatus | undefined,
      bagReturned: params.bagReturned === "true" ? true : params.bagReturned === "false" ? false : undefined,
      orderDateFrom: params.orderDateFrom,
      orderDateTo: params.orderDateTo,
      deliveryDate: params.deliveryDate,
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
          <OrderFilterBar />
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
