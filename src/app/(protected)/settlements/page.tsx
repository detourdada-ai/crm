import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { SettlementPeriodPicker } from "@/components/settlements/settlement-period-picker";
import { SettlementTable } from "@/components/settlements/settlement-table";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { getSettlementBoardAction } from "@/actions/settlements";
import { requireSession } from "@/lib/auth/current-session";
import { listAccounts } from "@/lib/auth/credentials";
import { isValidDateString } from "@/lib/utils/date";
import { formatCurrency } from "@/lib/constants/order-status";
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

  const [{ periodStart, periodEnd, rows }, accountUsernames, monthly] = await Promise.all([
    getSettlementBoardAction(periodType, referenceDate, ownerFilter),
    isAdmin ? listAccounts().then((accounts) => accounts.filter((a) => a.role !== "driver").map((a) => a.username)) : Promise.resolve(undefined),
    getSettlementBoardAction("monthly", todayIso(), ownerFilter),
  ]);

  const pendingCount = rows.filter((r) => r.settlement.status !== "paid" && r.settlement.amount > 0).length;
  const paidCount = rows.filter((r) => r.settlement.status === "paid").length;
  const monthlyPaidAmount = monthly.rows
    .filter((r) => r.settlement.status === "paid")
    .reduce((sum, r) => sum + r.settlement.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="정산"
        description={`배송 완료된 주문을 기준으로 정산을 확인하세요.${isAdmin ? "" : " 내가 등록한 기사만 표시됩니다."}`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="정산 대기" value={pendingCount} cta="확인" href="#list" />
        <KpiCard label="정산 완료" value={paidCount} cta="확인" href="#list" />
        <KpiCard label="이번 달 정산액" value={formatCurrency(monthlyPaidAmount)} unit="" cta="상세 보기" href="#list" />
      </div>

      <Card id="list">
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
