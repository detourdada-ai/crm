import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/constants/order-status";
import type { CustomerStats } from "@/types/domain";

export function CustomerStatsCards({ stats }: { stats: CustomerStats }) {
  const items = [
    { label: "총 주문횟수", value: `${stats.totalOrders}회` },
    { label: "총 구매금액", value: formatCurrency(stats.totalAmount) },
    { label: "평균 구매금액", value: formatCurrency(stats.averageAmount) },
    { label: "최근 주문", value: formatDate(stats.lastOrderAt) },
    { label: "첫 주문", value: formatDate(stats.firstOrderAt) },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {items.map((item) => (
        <Card key={item.label}>
          <CardHeader className="pb-2">
            <CardDescription>{item.label}</CardDescription>
            <CardTitle className="text-lg">{item.value}</CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
