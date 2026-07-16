import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardStatsAction } from "@/actions/dashboard";
import { formatCurrency } from "@/lib/constants/order-status";

export default async function DashboardPage() {
  const stats = await getDashboardStatsAction();

  const cards = [
    { label: "총 고객", value: `${stats.totalCustomers}명` },
    { label: "총 주문", value: `${stats.totalOrders}건` },
    { label: "처리 대기 동일인 후보", value: `${stats.pendingDuplicates}건` },
    { label: "이번 달 매출", value: formatCurrency(stats.monthRevenue) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">반찬가게 CRM 운영 현황 요약</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-2xl">{card.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Sprint 3 예정</CardTitle>
          <CardDescription>
            VIP 고객, 재주문 분석, 문자 발송 등 통계 대시보드는 Sprint 3에서 이어서 구축됩니다.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
