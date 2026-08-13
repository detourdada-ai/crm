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

  const defaultTab = tab === "reorder" ? "reorder" : tab === "sales" ? "sales" : tab === "customers" ? "customers" : "vip";

  const totalThisMonthCustomers = stats.newVsRepeat.newCustomers + stats.newVsRepeat.repeatCustomers;
  const repeatRatio =
    totalThisMonthCustomers > 0 ? Math.round((stats.newVsRepeat.repeatCustomers / totalThisMonthCustomers) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">통계</h1>
        <p className="text-sm text-muted-foreground">주문과 고객 데이터를 분석하세요.</p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="vip">VIP 고객 ({vipCustomers.length})</TabsTrigger>
          <TabsTrigger value="reorder">재주문 임박 ({reorderDue.length})</TabsTrigger>
          <TabsTrigger value="sales">매출 · 상품</TabsTrigger>
          <TabsTrigger value="customers">고객 분석</TabsTrigger>
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>총 고객</CardDescription>
                <CardTitle className="text-2xl">{stats.totalCustomers}명</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>총 주문</CardDescription>
                <CardTitle className="text-2xl">{stats.totalOrders}건</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>이번 달 매출</CardDescription>
                <CardTitle className="text-2xl">{formatCurrency(stats.monthRevenue)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>객단가</CardDescription>
                <CardTitle className="text-2xl">{formatCurrency(stats.averageOrderValue)}</CardTitle>
              </CardHeader>
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
