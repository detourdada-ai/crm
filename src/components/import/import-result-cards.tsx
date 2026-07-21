import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ImportSummary } from "@/types/domain";

export function ImportResultCards({ summary }: { summary: ImportSummary }) {
  const items = [
    { label: "총 주문", value: summary.totalOrders, hint: "서로 다른 주문번호 개수 (한 주문에 상품이 여러 개면 엑셀 행 수보다 적습니다)" },
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
            {item.hint ? <p className="text-xs text-muted-foreground">{item.hint}</p> : null}
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
