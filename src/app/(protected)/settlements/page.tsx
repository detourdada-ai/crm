import Link from "next/link";
import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { SettlementPeriodPicker } from "@/components/settlements/settlement-period-picker";
import { SettlementTable } from "@/components/settlements/settlement-table";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { SummaryFlow, type SummaryFlowItem } from "@/components/common/summary-flow";
import { Wallet } from "lucide-react";
import { getSettlementBoardAction, listSettlementDriverOptionsAction } from "@/actions/settlements";
import { requireSession } from "@/lib/auth/current-session";
import { listAccounts } from "@/lib/auth/credentials";
import { isValidDateString } from "@/lib/utils/date";
import { formatCurrency } from "@/lib/constants/order-status";
import { kstTodayIso } from "@/lib/utils/kst-date";
import type { SettlementPeriodType } from "@/lib/services/settlement.service";
import type { SettlementRow } from "@/actions/settlements";

type SettlementFilter = "all" | "unpaid" | "paid";

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string; dateFrom?: string; dateTo?: string; owner?: string; driver?: string; status?: string }>;
}) {
  const session = await requireSession();
  const isAdmin = session.role === "admin";

  const { period, date, dateFrom, dateTo, owner, driver, status } = await searchParams;
  const periodType: SettlementPeriodType =
    period === "daily" || period === "weekly" || period === "monthly" || period === "custom" ? period : "monthly";
  const today = kstTodayIso();
  const referenceDate = isValidDateString(date) ? date : today;
  const customFrom = isValidDateString(dateFrom) ? dateFrom : today;
  const customTo = isValidDateString(dateTo) ? dateTo : today;
  const customRange = periodType === "custom" ? { start: customFrom, end: customTo } : undefined;
  const ownerFilter = isAdmin ? owner : undefined;
  const driverFilter = driver || undefined;
  const statusFilter: SettlementFilter = status === "unpaid" || status === "paid" ? status : "all";

  const [{ periodStart, periodEnd, rows }, accountUsernames, driverOptions, monthly] = await Promise.all([
    getSettlementBoardAction(periodType, referenceDate, ownerFilter, driverFilter, customRange),
    isAdmin ? listAccounts().then((accounts) => accounts.filter((a) => a.role !== "driver").map((a) => a.username)) : Promise.resolve(undefined),
    listSettlementDriverOptionsAction(ownerFilter),
    getSettlementBoardAction("monthly", kstTodayIso(), ownerFilter),
  ]);

  const pendingCount = rows.filter((r) => r.settlement.status !== "paid" && r.settlement.amount > 0).length;
  const paidCount = rows.filter((r) => r.settlement.status === "paid").length;
  const monthlyPaidAmount = monthly.rows
    .filter((r) => r.settlement.status === "paid")
    .reduce((sum, r) => sum + r.settlement.amount, 0);

  function filterRows(list: SettlementRow[]): SettlementRow[] {
    if (statusFilter === "unpaid") return list.filter((r) => r.settlement.status !== "paid");
    if (statusFilter === "paid") return list.filter((r) => r.settlement.status === "paid");
    return list;
  }
  const visibleRows = filterRows(rows);
  // Phase 6 STEP10: rows는 기사마다 항상 한 줄씩 있으므로(배송완료 0건이어도) "정산할
  // 내역이 없다"는 rows.length===0이 아니라 "지급 이력도 없고 금액도 전부 0"인
  // 경우로 판단한다 — 기사 등록 자체가 없는 것과는 다른 케이스.
  const hasSettlementActivity = rows.some((r) => r.settlement.amount > 0 || r.settlement.status === "paid");

  function buildStatusHref(next: SettlementFilter) {
    const search = new URLSearchParams();
    if (period) search.set("period", period);
    if (date) search.set("date", date);
    if (dateFrom) search.set("dateFrom", dateFrom);
    if (dateTo) search.set("dateTo", dateTo);
    if (owner) search.set("owner", owner);
    if (driver) search.set("driver", driver);
    if (next !== "all") search.set("status", next);
    const qs = search.toString();
    return qs ? `/settlements?${qs}` : "/settlements";
  }

  const summaryItems: SummaryFlowItem[] = [
    {
      key: "unpaid",
      label: "정산 대기",
      value: `${pendingCount}건`,
      href: buildStatusHref("unpaid"),
      tone: "warning",
      active: statusFilter === "unpaid",
    },
    {
      key: "paid",
      label: "정산 완료",
      value: `${paidCount}건`,
      href: buildStatusHref("paid"),
      tone: "success",
      active: statusFilter === "paid",
    },
    {
      key: "monthly",
      label: "이번 달 정산액",
      value: formatCurrency(monthlyPaidAmount),
      tone: "neutral",
      emphasize: true,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="정산관리"
        description={`판매 금액과 정산 내역을 한눈에 확인하세요.${isAdmin ? "" : " 내가 등록한 기사만 표시됩니다."}`}
      />

      <SummaryFlow items={summaryItems} />

      <SettlementPeriodPicker
        periodType={periodType}
        date={referenceDate}
        dateFrom={customFrom}
        dateTo={customTo}
        ownerFilter={ownerFilter}
        accountUsernames={accountUsernames}
        driverFilter={driverFilter}
        driverOptions={driverOptions}
      />

      <Card id="list">
        <CardContent className="space-y-4 pt-6">
          <CardDescription>
            정산 기간: {periodStart} ~ {periodEnd}
          </CardDescription>
          {!hasSettlementActivity ? (
            <EmptyState
              icon={Wallet}
              title="정산할 배송 완료 내역이 없습니다."
              description="선택한 기간에 배송완료 처리된 건이 있으면 여기에 정산 금액이 표시됩니다."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/delivery">배송관리로 이동</Link>
                </Button>
              }
            />
          ) : (
            <SettlementTable rows={visibleRows} periodStart={periodStart} periodEnd={periodEnd} showOwner={isAdmin && !ownerFilter} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
