import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserSearch } from "lucide-react";
import {
  getDashboardStatsAction,
  getOrdersByWeekdayAction,
  getTopProductsAction,
  getCustomerRankingAction,
  getRecentlyInactiveCustomersAction,
} from "@/actions/dashboard";
import { listOrdersAction } from "@/actions/orders";
import { listRecentImportsAction } from "@/actions/import";
import { formatCurrency } from "@/lib/constants/order-status";
import { RevenueTrendChart } from "@/components/dashboard/revenue-trend-chart";
import { WeekdayOrderChart } from "@/components/dashboard/weekday-order-chart";
import { TopProductsTable } from "@/components/dashboard/top-products-table";
import { CustomerRankingTable } from "@/components/dashboard/customer-ranking-table";
import { InactiveCustomerTable } from "@/components/dashboard/inactive-customer-table";
import { RecentOrdersList } from "@/components/dashboard/recent-orders-list";
import { RecentImportsList } from "@/components/dashboard/recent-imports-list";

export default async function DashboardPage() {
  const [stats, weekdayOrders, topProducts, customerRanking, inactiveCustomers, recentOrders, recentImports] =
    await Promise.all([
      getDashboardStatsAction(),
      getOrdersByWeekdayAction(),
      getTopProductsAction(),
      getCustomerRankingAction(),
      getRecentlyInactiveCustomersAction(),
      listOrdersAction(1, 5),
      listRecentImportsAction(5),
    ]);

  const kpiCards = [
    { label: "총 고객", value: `${stats.totalCustomers}명`, href: "/customers" },
    { label: "총 주문", value: `${stats.totalOrders}건`, href: "/orders" },
    { label: "이번 달 매출", value: formatCurrency(stats.monthRevenue), href: "/orders" },
    { label: "객단가", value: formatCurrency(stats.averageOrderValue), href: "/orders" },
    { label: "VIP 고객", value: `${stats.vipCount}명`, href: "/stats?tab=vip" },
    { label: "재주문 임박 고객", value: `${stats.reorderDueCount}명`, href: "/stats?tab=reorder" },
    {
      label: "평균 재주문 주기",
      value: stats.averageReorderCycleDays != null ? `${stats.averageReorderCycleDays}일` : "-",
      href: "/stats?tab=reorder",
    },
    { label: "처리 대기 동일인 후보", value: `${stats.pendingDuplicates}건`, href: "/duplicates" },
  ];

  const totalThisMonthCustomers = stats.newVsRepeat.newCustomers + stats.newVsRepeat.repeatCustomers;
  const repeatRatio =
    totalThisMonthCustomers > 0 ? Math.round((stats.newVsRepeat.repeatCustomers / totalThisMonthCustomers) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">CRM 운영 현황 요약</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((card) => (
          <Link key={card.label} href={card.href}>
            <Card className="transition-colors hover:bg-muted/40">
              <CardHeader className="pb-2">
                <CardDescription>{card.label}</CardDescription>
                <CardTitle className="text-2xl">{card.value}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>최근 주문</CardTitle>
          </CardHeader>
          <CardContent>
            <RecentOrdersList orders={recentOrders.orders} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>최근 업로드</CardTitle>
          </CardHeader>
          <CardContent>
            <RecentImportsList imports={recentImports} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>동일인 검토</CardTitle>
            <CardDescription>자동 병합되지 않으며, 관리자 확인이 필요합니다.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-6">
            <UserSearch className="size-8 text-muted-foreground" />
            <p className="text-3xl font-semibold">{stats.pendingDuplicates}건</p>
            <Button asChild size="sm">
              <Link href="/duplicates">검토하러 가기</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>월별 매출 추이 (최근 6개월)</CardTitle>
          </CardHeader>
          <CardContent>
            <RevenueTrendChart data={stats.revenueTrend} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>요일별 주문 건수</CardTitle>
          </CardHeader>
          <CardContent>
            <WeekdayOrderChart data={weekdayOrders} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>이번 달 신규 vs 재구매</CardTitle>
            <CardDescription>이번 달 주문한 고객 기준</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">신규 고객</span>
              <span className="font-medium">{stats.newVsRepeat.newCustomers}명</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">재구매 고객</span>
              <span className="font-medium">{stats.newVsRepeat.repeatCustomers}명</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">재구매 비율</span>
              <span className="font-medium">{repeatRatio}%</span>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>인기 상품 TOP 10</CardTitle>
          </CardHeader>
          <CardContent>
            <TopProductsTable products={topProducts} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>고객 구매 랭킹 TOP 10</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerRankingTable entries={customerRanking} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>최근 미주문 고객</CardTitle>
            <CardDescription>30일 이상 재주문이 없는 고객입니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <InactiveCustomerTable entries={inactiveCustomers} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>준비 중인 기능</CardTitle>
          <CardDescription>문자 발송(재주문 알림/프로모션)은 외부 연동이 필요해 추후 진행됩니다.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
