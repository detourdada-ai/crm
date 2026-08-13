import { Card, CardContent } from "@/components/ui/card";
import { CustomerSearchBar } from "@/components/customers/customer-search-bar";
import { CustomerListTable, type CustomerListRow } from "@/components/customers/customer-list-table";
import { DuplicateReviewDialog } from "@/components/customers/duplicate-review-dialog";
import { PaginationControls } from "@/components/common/pagination-controls";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { searchCustomersAction } from "@/actions/customers";
import { listPendingDuplicatesAction } from "@/actions/duplicates";
import { listVipCustomersAction } from "@/actions/stats";
import { getDashboardStatsAction, getRecentlyInactiveCustomersAction } from "@/actions/dashboard";
import { requireSession } from "@/lib/auth/current-session";
import type { CustomerSortField } from "@/lib/repositories/customers.repository";

const PAGE_SIZE = 20;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; dir?: string }>;
}) {
  const { q, page: pageParam, sort, dir } = await searchParams;
  const page = Number(pageParam) > 0 ? Number(pageParam) : 1;
  const [session, { customers, total }, duplicateViews, vipCustomers, stats, inactiveCustomers] = await Promise.all([
    requireSession(),
    searchCustomersAction(q ?? "", page, sort as CustomerSortField | undefined, dir === "asc"),
    listPendingDuplicatesAction(),
    listVipCustomersAction(),
    getDashboardStatsAction(),
    getRecentlyInactiveCustomersAction(),
  ]);

  const activeThisMonth = stats.newVsRepeat.newCustomers + stats.newVsRepeat.repeatCustomers;

  return (
    <div className="space-y-6">
      <PageHeader
        title="고객"
        description="고객 정보를 확인하고 주문 이력을 관리하세요."
        action={<DuplicateReviewDialog views={duplicateViews} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="전체 고객" value={total} cta="목록 보기" href="#list" />
        <KpiCard label="VIP" value={vipCustomers.length} cta="VIP 보기" href="/stats?tab=vip" />
        <KpiCard label="이번 달 주문 고객" value={activeThisMonth} cta="통계 보기" href="/stats?tab=sales" />
        <KpiCard label="미주문 고객" value={inactiveCustomers.length} cta="확인" href="/stats?tab=customers" />
      </div>

      <CustomerSearchBar />

      <Card id="list">
        <CardContent className="space-y-4 pt-6">
          <CustomerListTable customers={customers as CustomerListRow[]} showOwner={session.role === "admin"} />
          <PaginationControls page={page} pageSize={PAGE_SIZE} total={total} />
        </CardContent>
      </Card>
    </div>
  );
}
