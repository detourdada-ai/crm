import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList, Truck, Wallet } from "lucide-react";
import { searchOrdersAction, listOrdersAction } from "@/actions/orders";
import { getDeliveryBoardAction } from "@/actions/delivery";
import { getSettlementBoardAction } from "@/actions/settlements";
import { listRecentImportsAction } from "@/actions/import";
import { ActionCard } from "@/components/dashboard/action-card";
import { TodayDeliveryList } from "@/components/dashboard/today-delivery-list";
import { RecentOrdersList } from "@/components/dashboard/recent-orders-list";
import { RecentImportsList } from "@/components/dashboard/recent-imports-list";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "좋은 아침입니다";
  if (hour < 18) return "좋은 오후입니다";
  return "수고 많으셨습니다";
}

export default async function DashboardPage() {
  const today = todayIso();

  const [pendingOrders, deliveryBoard, settlementBoard, recentOrders, recentImports] = await Promise.all([
    searchOrdersAction({ deliveryStatus: "배송대기", pageSize: 1 }),
    getDeliveryBoardAction(today),
    getSettlementBoardAction("daily", today),
    listOrdersAction(1, 5),
    listRecentImportsAction(5),
  ]);

  const pendingSettlementCount = settlementBoard.rows.filter(
    (row) => row.settlement.status !== "paid" && row.settlement.amount > 0
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{greeting()} 👋</h1>
        <p className="text-sm text-muted-foreground">오늘 운영 현황을 확인하세요.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ActionCard
          icon={ClipboardList}
          label="처리할 주문"
          count={pendingOrders.total}
          cta="주문 확인"
          href="/orders?deliveryStatus=배송대기"
        />
        <ActionCard
          icon={Truck}
          label="오늘 배송"
          count={deliveryBoard.orders.length}
          cta="배송 관리"
          href="/delivery"
        />
        <ActionCard
          icon={Wallet}
          label="정산 대기"
          count={pendingSettlementCount}
          cta="정산 확인"
          href="/settlements"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>오늘의 배송</CardTitle>
          </CardHeader>
          <CardContent>
            <TodayDeliveryList orders={deliveryBoard.orders} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>오늘의 주문</CardTitle>
          </CardHeader>
          <CardContent>
            <RecentOrdersList orders={recentOrders.orders} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>최근 활동</CardTitle>
          </CardHeader>
          <CardContent>
            <RecentImportsList imports={recentImports} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
