import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/constants/order-status";
import type { Customer, CustomerStats } from "@/types/domain";

export function CustomerComparePanel({
  title,
  customer,
  stats,
}: {
  title: string;
  customer: Customer;
  stats: CustomerStats;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Row label="고객번호" value={customer.customer_code} />
        <Row label="이름" value={customer.name} />
        <Row label="전화번호" value={customer.phone ?? "-"} />
        <Row label="주소" value={customer.address ?? "-"} />
        <Row label="주문횟수" value={`${stats.totalOrders}회`} />
        <Row label="총금액" value={formatCurrency(stats.totalAmount)} />
        <Row label="최근 주문" value={formatDate(stats.lastOrderAt)} />
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium break-all">{value}</span>
    </div>
  );
}
