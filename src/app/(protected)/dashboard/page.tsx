import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ClipboardList } from "lucide-react";
import { searchOrdersAction, listOrdersAction } from "@/actions/orders";
import { getDeliveryBoardAction } from "@/actions/delivery";
import { getSettlementBoardAction } from "@/actions/settlements";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { TodayTasks } from "@/components/dashboard/today-tasks";
import { TodayDeliveryList } from "@/components/dashboard/today-delivery-list";
import { RecentOrdersList } from "@/components/dashboard/recent-orders-list";
import { ManualOrderButton } from "@/components/orders/manual-order-button";
import Link from "next/link";

function dateIso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "좋은 아침입니다";
  if (hour < 18) return "좋은 오후입니다";
  return "수고 많으셨습니다";
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export default async function DashboardPage() {
  const today = dateIso();
  const yesterday = dateIso(-1);
  const now = new Date();
  const dateLabel = `${now.getMonth() + 1}월 ${now.getDate()}일 (${WEEKDAY_LABELS[now.getDay()]})`;

  const [todayOrders, yesterdayOrders, pendingOrders, deliveryBoard, settlementBoard, recentOrders] = await Promise.all([
    searchOrdersAction({ orderDateFrom: today, orderDateTo: today, pageSize: 1 }),
    searchOrdersAction({ orderDateFrom: yesterday, orderDateTo: yesterday, pageSize: 1 }),
    searchOrdersAction({ deliveryStatus: "배송대기", pageSize: 1 }),
    getDeliveryBoardAction(today),
    getSettlementBoardAction("daily", today),
    listOrdersAction(1, 5),
  ]);

  const pendingSettlementCount = settlementBoard.rows.filter(
    (row) => row.settlement.status !== "paid" && row.settlement.amount > 0
  ).length;
  const needsDriverCount = deliveryBoard.orders.filter((o) => !o.driver_id).length;

  const tasks = [
    { label: "배송 대기", count: pendingOrders.total, cta: "주문 확인", href: "/orders?deliveryStatus=배송대기" },
    { label: "기사 배정 필요", count: needsDriverCount, cta: "배송 관리", href: "/delivery" },
    { label: "정산 대기", count: pendingSettlementCount, cta: "정산 확인", href: "/settlements" },
  ];

  const isEmpty = todayOrders.total === 0 && recentOrders.orders.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <PageHeader title="대시보드" description="오늘 해야 할 일을 한눈에 확인하세요." />
        <p className="mt-1 text-xs text-muted-foreground">
          {greeting()} · {dateLabel}
        </p>
      </div>

      {isEmpty ? (
        <EmptyState
          icon={ClipboardList}
          title="아직 주문이 없습니다."
          description="엑셀 파일을 업로드하거나 직접 주문을 등록하면 여기에서 오늘의 주문을 확인할 수 있습니다."
          action={<ManualOrderButton />}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="오늘 주문"
              value={todayOrders.total}
              delta={todayOrders.total - yesterdayOrders.total}
              cta="주문 확인"
              href={`/orders?orderDateFrom=${today}&orderDateTo=${today}`}
            />
            <KpiCard
              label="배송 대기"
              value={pendingOrders.total}
              cta="주문 확인"
              href="/orders?deliveryStatus=배송대기"
            />
            <KpiCard label="오늘 배송" value={deliveryBoard.orders.length} cta="배송 관리" href="/delivery" />
            <KpiCard label="정산 대기" value={pendingSettlementCount} cta="정산 확인" href="/settlements" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>오늘의 업무</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <TodayTasks tasks={tasks} />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>최근 주문</CardTitle>
                <Link href="/orders" className="text-xs font-medium text-primary hover:underline">
                  전체 보기 →
                </Link>
              </CardHeader>
              <CardContent>
                <RecentOrdersList orders={recentOrders.orders} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>오늘 배송</CardTitle>
                <Link href="/delivery" className="text-xs font-medium text-primary hover:underline">
                  전체 보기 →
                </Link>
              </CardHeader>
              <CardContent>
                <TodayDeliveryList orders={deliveryBoard.orders} />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
