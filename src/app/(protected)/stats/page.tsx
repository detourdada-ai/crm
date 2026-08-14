import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listVipCustomersAction, listReorderDueCustomersAction } from "@/actions/stats";
import {
  getDashboardStatsAction,
  getOrdersByWeekdayAction,
  getTopProductsAction,
  getCustomerRankingAction,
  getRecentlyInactiveCustomersAction,
} from "@/actions/dashboard";
import { VipCustomerTable } from "@/components/stats/vip-customer-table";
import { ReorderDueTable } from "@/components/stats/reorder-due-table";
import { RevenueTrendChart } from "@/components/dashboard/revenue-trend-chart";
import { WeekdayOrderChart } from "@/components/dashboard/weekday-order-chart";
import { TopProductsTable } from "@/components/dashboard/top-products-table";
import { CustomerRankingTable } from "@/components/dashboard/customer-ranking-table";
import { InactiveCustomerTable } from "@/components/dashboard/inactive-customer-table";
import { PageHeader } from "@/components/common/page-header";
import { SummaryFlow, type SummaryFlowItem } from "@/components/common/summary-flow";
import { formatCurrency } from "@/lib/constants/order-status";

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const [vipCustomers, reorderDue, stats, weekdayOrders, topProducts, customerRanking, inactiveCustomers] =
    await Promise.all([
      listVipCustomersAction(),
      listReorderDueCustomersAction(),
      getDashboardStatsAction(),
      getOrdersByWeekdayAction(),
      getTopProductsAction(),
      getCustomerRankingAction(),
      getRecentlyInactiveCustomersAction(),
    ]);

  const defaultTab = tab === "vip" ? "vip" : tab === "reorder" ? "reorder" : tab === "customers" ? "customers" : "sales";

  const totalThisMonthCustomers = stats.newVsRepeat.newCustomers + stats.newVsRepeat.repeatCustomers;
  const repeatRatio =
    totalThisMonthCustomers > 0 ? Math.round((stats.newVsRepeat.repeatCustomers / totalThisMonthCustomers) * 100) : 0;

  // 매출 → 주문 → 고객 순으로 우선순위를 준다 — Dashboard에서 뺀 상세 통계는
  // 여기서만 보여준다는 원칙에 따라, 페이지 전체에서 항상 보이는 핵심 지표를
  // 최상단 하나로 모으고 세부 분석은 아래 탭에서 이어간다.
  const summaryItems: SummaryFlowItem[] = [
    { key: "revenue", label: "이번 달 매출", value: formatCurrency(stats.monthRevenue), tone: "success", emphasize: true },
    { key: "orders", label: "총 주문", value: `${stats.totalOrders}건`, tone: "info" },
    { key: "customers", label: "총 고객", value: `${stats.totalCustomers}명`, tone: "neutral" },
    { key: "aov", label: "객단가", value: formatCurrency(stats.averageOrderValue), tone: "neutral" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="통계" description="주문과 고객 데이터를 바탕으로 매출과 운영 현황을 확인하세요." />

      <SummaryFlow items={summaryItems} />

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="sales">매출 · 상품</TabsTrigger>
          <TabsTrigger value="customers">고객 분석</TabsTrigger>
          <TabsTrigger value="vip">VIP 고객 ({vipCustomers.length})</TabsTrigger>
          <TabsTrigger value="reorder">재주문 임박 ({reorderDue.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="vip">
          <Card>
            <CardHeader>
              <CardTitle>VIP 고객</CardTitle>
              <CardDescription>
                총 구매금액 또는 주문횟수 기준. 기준값은 [설정] 화면에서 변경할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VipCustomerTable customers={vipCustomers} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reorder">
          <Card>
            <CardHeader>
              <CardTitle>재주문 임박 고객</CardTitle>
              <CardDescription>
                고객마다 실제 주문 간격(평균 주기)을 계산해, 그 주기를 이미 넘겼는데 재주문이 없는 고객만
                보여줍니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ReorderDueTable customers={reorderDue} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sales" className="space-y-4">
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
        </TabsContent>

        <TabsContent value="customers" className="space-y-4">
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
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>준비 중인 기능</CardTitle>
          <CardDescription>문자 발송(재주문 알림/프로모션)은 외부 연동이 필요해 추후 진행됩니다.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
