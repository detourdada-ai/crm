import { Card, CardContent } from "@/components/ui/card";
import { CustomerSearchBar } from "@/components/customers/customer-search-bar";
import { CustomerListTable, type CustomerListRow } from "@/components/customers/customer-list-table";
import { DuplicateReviewDialog } from "@/components/customers/duplicate-review-dialog";
import { PaginationControls } from "@/components/common/pagination-controls";
import { PageHeader } from "@/components/common/page-header";
import { searchCustomersAction } from "@/actions/customers";
import { listPendingDuplicatesAction } from "@/actions/duplicates";
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
  const [session, { customers, total }, duplicateViews] = await Promise.all([
    requireSession(),
    searchCustomersAction(q ?? "", page, sort as CustomerSortField | undefined, dir === "asc"),
    listPendingDuplicatesAction(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="고객관리"
        description="고객 정보를 확인하고 관리하세요."
        action={<DuplicateReviewDialog views={duplicateViews} />}
      />

      <CustomerSearchBar />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <CustomerListTable customers={customers as CustomerListRow[]} showOwner={session.role === "admin"} />
          <PaginationControls page={page} pageSize={PAGE_SIZE} total={total} />
        </CardContent>
      </Card>
    </div>
  );
}
