import { Card, CardContent } from "@/components/ui/card";
import { CustomerSearchBar } from "@/components/customers/customer-search-bar";
import { CustomerListTable, type CustomerListRow } from "@/components/customers/customer-list-table";
import { DuplicateReviewDialog } from "@/components/customers/duplicate-review-dialog";
import { CustomerCreateDialog } from "@/components/customers/customer-create-dialog";
import { PaginationControls } from "@/components/common/pagination-controls";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { SummaryFlow, type SummaryFlowItem } from "@/components/common/summary-flow";
import { Users } from "lucide-react";
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
  const vipCustomerIds = new Set(vipCustomers.map((v) => v.customer.id));
  const isEmpty = total === 0 && !q;

  const summaryItems: SummaryFlowItem[] = [
    { key: "all", label: "전체 고객", value: `${total}명`, caption: "등록된 전체 고객", href: "#list" },
    {
      key: "vip",
      label: "VIP",
      value: `${vipCustomers.length}명`,
      caption: "반복 구매 고객",
      href: "/stats?tab=vip",
      tone: "success",
      emphasize: true,
    },
    {
      key: "active",
      label: "이번 달 주문 고객",
      value: `${activeThisMonth}명`,
      caption: "이번 달 주문한 고객",
      href: "/stats?tab=sales",
      tone: "info",
    },
    {
      key: "inactive",
      label: "미주문 고객",
      value: `${inactiveCustomers.length}명`,
      caption: "30일 이상 재주문 없음",
      href: "/stats?tab=customers",
      tone: "warning",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="고객관리"
        description="고객 현황을 확인하고 주문 이력을 관리하세요."
        action={
          <div className="flex items-center gap-2">
            <CustomerCreateDialog />
            <DuplicateReviewDialog views={duplicateViews} />
          </div>
        }
      />

      <SummaryFlow items={summaryItems} />

      {isEmpty ? (
        <EmptyState
          icon={Users}
          title="고객이 없습니다."
          description="고객을 직접 등록하거나 주문이 들어오면 고객 정보가 자동으로 쌓입니다."
          action={<CustomerCreateDialog />}
        />
      ) : (
        <>
          <CustomerSearchBar />

          <Card id="list">
            <CardContent className="space-y-4 pt-6">
              <CustomerListTable
                customers={customers as CustomerListRow[]}
                vipCustomerIds={vipCustomerIds}
                showOwner={session.role === "admin"}
              />
              <PaginationControls page={page} pageSize={PAGE_SIZE} total={total} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
