import { Card, CardContent } from "@/components/ui/card";
import { OrderTable } from "@/components/orders/order-table";
import { PaginationControls } from "@/components/common/pagination-controls";
import { listOrdersAction } from "@/actions/orders";
import { requireSession } from "@/lib/auth/current-session";

const PAGE_SIZE = 20;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) > 0 ? Number(pageParam) : 1;
  const [session, { orders, total }] = await Promise.all([requireSession(), listOrdersAction(page)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">주문관리</h1>
        <p className="text-sm text-muted-foreground">엑셀 업로드로 생성된 전체 주문 목록입니다.</p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <OrderTable orders={orders} showCustomerLink showOwner={session.role === "admin"} />
          <PaginationControls page={page} pageSize={PAGE_SIZE} total={total} />
        </CardContent>
      </Card>
    </div>
  );
}
