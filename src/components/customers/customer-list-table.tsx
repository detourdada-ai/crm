import Link from "next/link";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead } from "@/components/common/sortable-table-head";
import { CUSTOMER_STATUS_LABELS } from "@/lib/constants/customer-status";
import { formatCurrency, formatDate } from "@/lib/constants/order-status";
import type { Customer, CustomerStatus } from "@/types/domain";

export interface CustomerListRow extends Customer {
  total_orders: number;
  total_amount: number;
  last_order_at: string | null;
}

export function CustomerListTable({
  customers,
  showOwner = false,
}: {
  customers: CustomerListRow[];
  showOwner?: boolean;
}) {
  if (customers.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">검색 결과가 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead />
          <SortableTableHead field="customer_code">고객번호</SortableTableHead>
          <SortableTableHead field="name">이름</SortableTableHead>
          <SortableTableHead field="phone">전화번호</SortableTableHead>
          <SortableTableHead field="address">주소</SortableTableHead>
          <TableHead>상태</TableHead>
          <TableHead>태그</TableHead>
          <SortableTableHead field="total_orders" className="text-right" defaultDir="asc">
            주문횟수
          </SortableTableHead>
          <SortableTableHead field="total_amount" className="text-right" defaultDir="asc">
            총금액
          </SortableTableHead>
          <SortableTableHead field="last_order_at">최근주문일</SortableTableHead>
          {showOwner ? <TableHead>담당자</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((c) => (
          <TableRow key={c.id}>
            <TableCell>
              {c.is_favorite ? <Star className="size-4 fill-yellow-400 text-yellow-400" /> : null}
            </TableCell>
            <TableCell>
              <Link href={`/customers/${c.id}`} className="font-medium text-primary hover:underline">
                {c.customer_code}
              </Link>
            </TableCell>
            <TableCell>{c.name}</TableCell>
            <TableCell>{c.phone ?? "-"}</TableCell>
            <TableCell className="max-w-xs truncate">{c.address ?? "-"}</TableCell>
            <TableCell>
              <Badge variant={c.status === "active" ? "outline" : "secondary"}>
                {CUSTOMER_STATUS_LABELS[c.status as CustomerStatus] ?? c.status}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {c.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell className="text-right">{c.total_orders}</TableCell>
            <TableCell className="text-right">{formatCurrency(c.total_amount)}</TableCell>
            <TableCell>{c.last_order_at ? formatDate(c.last_order_at) : "-"}</TableCell>
            {showOwner ? <TableCell className="text-muted-foreground">{c.owner_username}</TableCell> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
