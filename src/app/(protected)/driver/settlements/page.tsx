import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SettlementPeriodPicker } from "@/components/settlements/settlement-period-picker";
import { formatCurrency } from "@/lib/constants/order-status";
import { getMySettlementAction } from "@/actions/settlements";
import { isValidDateString } from "@/lib/utils/date";
import type { SettlementPeriodType } from "@/lib/services/settlement.service";

function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

export default async function DriverSettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string }>;
}) {
  const { period, date } = await searchParams;
  const periodType: SettlementPeriodType =
    period === "daily" || period === "weekly" || period === "monthly" ? period : "monthly";
  const referenceDate = isValidDateString(date) ? date : todayIso();

  const result = await getMySettlementAction(periodType, referenceDate);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">정산관리</h1>
        <p className="text-sm text-muted-foreground">배송완료 건 기준으로 내가 받을 정산 금액을 확인합니다.</p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <SettlementPeriodPicker periodType={periodType} date={referenceDate} />
          {result ? (
            <>
              <CardDescription>
                정산 기간: {result.periodStart} ~ {result.periodEnd}
              </CardDescription>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">배송건수</p>
                  <p className="text-2xl font-semibold">{result.settlement.delivery_count}건</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">받을 금액</p>
                  <p className="text-2xl font-semibold">{formatCurrency(result.settlement.amount)}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">지급 상태</p>
                  <Badge variant={result.settlement.status === "paid" ? "default" : "outline"} className="mt-1">
                    {result.settlement.status === "paid" ? "지급완료" : "미지급"}
                  </Badge>
                </div>
              </div>
            </>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">정산 정보를 불러올 수 없습니다.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
