import { Card, CardContent } from "@/components/ui/card";
import { CustomerSearchBar } from "@/components/customers/customer-search-bar";
import { CustomerListTable, type CustomerListRow } from "@/components/customers/customer-list-table";
import { PaginationControls } from "@/components/common/pagination-controls";
import { searchCustomersAction } from "@/actions/customers";
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
  const [session, { customers, total }] = await Promise.all([
    requireSession(),
    searchCustomersAction(q ?? "", page, sort as CustomerSortField | undefined, dir === "asc"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">고객관리</h1>
        <p className="text-sm text-muted-foreground">이름, 전화번호, 주소, 고객번호로 검색할 수 있습니다.</p>
      </div>

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
