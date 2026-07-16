import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ImportSummary } from "@/types/domain";

export function ImportResultCards({ summary }: { summary: ImportSummary }) {
  const items = [
    { label: "총 주문", value: summary.totalOrders },
    { label: "신규 고객", value: summary.newCustomers },
    { label: "기존 고객", value: summary.existingCustomers },
    { label: "동일인 후보", value: summary.duplicateCandidates },
    { label: "실패 건수", value: summary.failedRows, danger: summary.failedRows > 0 },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {items.map((item) => (
        <Card key={item.label}>
          <CardHeader className="pb-2">
            <CardDescription>{item.label}</CardDescription>
            <CardTitle className={`text-2xl ${item.danger ? "text-destructive" : ""}`}>{item.value}</CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
