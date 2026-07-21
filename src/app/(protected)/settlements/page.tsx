import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { SettlementPeriodPicker } from "@/components/settlements/settlement-period-picker";
import { SettlementTable } from "@/components/settlements/settlement-table";
import { getSettlementBoardAction } from "@/actions/settlements";
import { requireSession } from "@/lib/auth/current-session";
import { isValidDateString } from "@/lib/utils/date";
import type { SettlementPeriodType } from "@/lib/services/settlement.service";

function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string }>;
}) {
  const session = await requireSession();

  if (session.role !== "admin") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">정산관리</h1>
        </div>
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            정산관리는 관리자만 조회할 수 있습니다.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { period, date } = await searchParams;
  const periodType: SettlementPeriodType =
    period === "daily" || period === "weekly" || period === "monthly" ? period : "monthly";
  const referenceDate = isValidDateString(date) ? date : todayIso();

  const { periodStart, periodEnd, rows } = await getSettlementBoardAction(periodType, referenceDate);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">정산관리</h1>
        <p className="text-sm text-muted-foreground">배송완료 건 기준으로 기사별 정산 금액을 계산합니다. 입금은 수동으로 처리합니다.</p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <SettlementPeriodPicker periodType={periodType} date={referenceDate} />
          <CardDescription>
            정산 기간: {periodStart} ~ {periodEnd}
          </CardDescription>
          <SettlementTable rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
