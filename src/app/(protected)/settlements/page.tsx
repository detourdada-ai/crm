import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { SettlementPeriodPicker } from "@/components/settlements/settlement-period-picker";
import { SettlementTable } from "@/components/settlements/settlement-table";
import { getSettlementBoardAction } from "@/actions/settlements";
import { requireSession } from "@/lib/auth/current-session";
import { listAccounts } from "@/lib/auth/credentials";
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
  searchParams: Promise<{ period?: string; date?: string; owner?: string }>;
}) {
  const session = await requireSession();
  const isAdmin = session.role === "admin";

  const { period, date, owner } = await searchParams;
  const periodType: SettlementPeriodType =
    period === "daily" || period === "weekly" || period === "monthly" ? period : "monthly";
  const referenceDate = isValidDateString(date) ? date : todayIso();
  const ownerFilter = isAdmin ? owner : undefined;

  const [{ periodStart, periodEnd, rows }, accountUsernames] = await Promise.all([
    getSettlementBoardAction(periodType, referenceDate, ownerFilter),
    isAdmin ? listAccounts().then((accounts) => accounts.filter((a) => a.role !== "driver").map((a) => a.username)) : Promise.resolve(undefined),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">정산관리</h1>
        <p className="text-sm text-muted-foreground">
          배송완료 건 기준으로 기사별 정산 금액을 계산합니다. 입금은 수동으로 처리합니다.
          {isAdmin ? "" : " 내가 등록한 기사만 표시됩니다."}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <SettlementPeriodPicker
            periodType={periodType}
            date={referenceDate}
            ownerFilter={ownerFilter}
            accountUsernames={accountUsernames}
          />
          <CardDescription>
            정산 기간: {periodStart} ~ {periodEnd}
          </CardDescription>
          <SettlementTable rows={rows} showOwner={isAdmin && !ownerFilter} />
        </CardContent>
      </Card>
    </div>
  );
}
