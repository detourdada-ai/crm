import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ClipboardList } from "lucide-react";
import { searchOrdersAction, listOrdersAction } from "@/actions/orders";
import { getDeliveryBoardAction } from "@/actions/delivery";
import { getSettlementBoardAction } from "@/actions/settlements";
import { TodayTasks } from "@/components/dashboard/today-tasks";
import { TodayDeliveryList } from "@/components/dashboard/today-delivery-list";
import { RecentOrdersList } from "@/components/dashboard/recent-orders-list";
import { ManualOrderButton } from "@/components/orders/manual-order-button";
import { kstTodayIso } from "@/lib/utils/kst-date";
import Link from "next/link";

// Phase 4-B STEP2: KST 기준 통일 — 서버 프로세스의 OS 타임존과 무관하게 항상
// 한국 기준 "오늘"을 계산한다 (kst-date.ts 참고).
function greeting() {
  const kstHour = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours();
  if (kstHour < 12) return "좋은 아침입니다";
  if (kstHour < 18) return "좋은 오후입니다";
  return "수고 많으셨습니다";
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export default async function DashboardPage() {
  const today = kstTodayIso();
  const [y, m, d] = today.split("-").map(Number);
  const kstDate = new Date(Date.UTC(y, m - 1, d));
  const dateLabel = `${m}월 ${d}일 (${WEEKDAY_LABELS[kstDate.getUTCDay()]})`;

  const [todayOrders, pendingOrders, deliveryBoard, settlementBoard, recentOrders] = await Promise.all([
    searchOrdersAction({ orderDateFrom: today, orderDateTo: today, pageSize: 1 }),
    searchOrdersAction({ deliveryStatus: "배송대기", pageSize: 1 }),
    getDeliveryBoardAction(today),
    getSettlementBoardAction("daily", today),
    listOrdersAction(1, 5),
  ]);

  const pendingSettlementCount = settlementBoard.rows.filter(
    (row) => row.settlement.status !== "paid" && row.settlement.amount > 0
  ).length;
  const needsDriverCount = deliveryBoard.orders.filter((o) => !o.driver_id).length;
  const inTransitCount = deliveryBoard.orders.filter((o) => o.delivery_status === "배송중").length;

  // Dashboard는 "Action Center" — 오늘 처리해야 할 일만 하나의 목록으로
  // 보여준다. 상세 통계(매출 추이/인기 상품/고객 랭킹 등)는 /stats에서만.
  const tasks = [
    // Phase 8 STEP11: "처리할 주문" count는 전체 기간 배송대기 건수인데,
    // orderDateFilter를 안 넘기면 /orders 기본값(이번주)으로 걸려 대부분
    // 사라진 것처럼 보였다(165건 표시 -> 실제 1건만 노출). orderDateFilter=all로
    // 링크해 대시보드 숫자와 클릭 후 화면이 항상 일치하도록 한다.
    { label: "처리할 주문", count: pendingOrders.total, cta: "주문 확인하기", href: "/orders?deliveryStatus=배송대기&orderDateFilter=all" },
    { label: "배송 대기", count: needsDriverCount, cta: "배송 관리하기", href: "/delivery" },
    { label: "배송 중", count: inTransitCount, cta: "배송 관리하기", href: "/delivery" },
    // 이 카운트는 daily 기준(오늘)인데 /settlements 기본값은 monthly라
    // 클릭 후 다른 숫자가 보일 수 있었다 — 링크에 동일 기준을 명시한다.
    { label: "정산 대기", count: pendingSettlementCount, cta: "정산 확인하기", href: `/settlements?period=daily&date=${today}` },
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
