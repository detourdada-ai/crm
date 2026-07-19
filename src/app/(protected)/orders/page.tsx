import { Card, CardContent } from "@/components/ui/card";
import { OrderTable } from "@/components/orders/order-table";
import { OrderFilterBar } from "@/components/orders/order-filter-bar";
import { BulkBagReturnButton } from "@/components/orders/bulk-bag-return-button";
import { ManualOrderButton } from "@/components/orders/manual-order-button";
import { PaginationControls } from "@/components/common/pagination-controls";
import { searchOrdersAction } from "@/actions/orders";
import { requireSession } from "@/lib/auth/current-session";
import type { OrderSortField } from "@/lib/repositories/orders.repository";

const PAGE_SIZE = 20;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    deliveryFrom?: string;
    deliveryTo?: string;
    status?: string;
    bagReturned?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Number(params.page) > 0 ? Number(params.page) : 1;

  const [session, { orders, total, itemSummaries }] = await Promise.all([
    requireSession(),
    searchOrdersAction({
      page,
      pageSize: PAGE_SIZE,
      status: params.status,
      bagReturned: params.bagReturned === "true" ? true : params.bagReturned === "false" ? false : undefined,
      deliveryDateFrom: params.deliveryFrom,
      deliveryDateTo: params.deliveryTo,
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
        <div className="flex items-center gap-2">
          <BulkBagReturnButton />
          <ManualOrderButton />
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <OrderFilterBar />
          <OrderTable
            orders={orders}
            itemSummaries={itemSummaries}
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
