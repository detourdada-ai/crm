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

/**
 * "누가 얼마나 구매했는가"가 주소록보다 먼저 보이도록 고객명 → 연락처 →
 * 최근 주문 → 주문 횟수 → 누적 구매액 → 등급(VIP) 순으로 우선순위를 준다.
 * 주소/상태/태그/담당자는 lg 이상에서만 노출되는 보조 정보 — 데이터는
 * 그대로, 시각적 위계만 조정.
 */
export function CustomerListTable({
  customers,
  vipCustomerIds,
  showOwner = false,
}: {
  customers: CustomerListRow[];
  vipCustomerIds: Set<string>;
  showOwner?: boolean;
}) {
  if (customers.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">검색 결과가 없습니다.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <SortableTableHead field="name">고객명</SortableTableHead>
            <SortableTableHead field="phone">연락처</SortableTableHead>
            <SortableTableHead field="last_order_at">최근 주문</SortableTableHead>
            <SortableTableHead field="total_orders" className="text-right" defaultDir="asc">
              주문 횟수
            </SortableTableHead>
            <SortableTableHead field="total_amount" className="text-right" defaultDir="asc">
              누적 구매액
            </SortableTableHead>
            <TableHead>등급</TableHead>
            <SortableTableHead field="customer_code" className="hidden lg:table-cell">
              고객번호
            </SortableTableHead>
            <SortableTableHead field="address" className="hidden lg:table-cell">
              주소
            </SortableTableHead>
            <TableHead className="hidden lg:table-cell">상태</TableHead>
            <TableHead className="hidden lg:table-cell">태그</TableHead>
            {showOwner ? <TableHead className="hidden lg:table-cell">담당자</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map((c) => (
            <TableRow key={c.id} className="hover:bg-muted/40">
              <TableCell>{c.is_favorite ? <Star className="size-4 fill-warning text-warning" /> : null}</TableCell>
              <TableCell>
                <Link href={`/customers/${c.id}`} className="font-semibold text-text-strong hover:text-primary">
                  {c.name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{c.phone ?? "-"}</TableCell>
              <TableCell>{c.last_order_at ? formatDate(c.last_order_at) : "-"}</TableCell>
              <TableCell className="text-right">{c.total_orders}회</TableCell>
              <TableCell className="text-right font-medium text-text-strong">{formatCurrency(c.total_amount)}</TableCell>
              <TableCell>{vipCustomerIds.has(c.id) ? <Badge variant="success">VIP</Badge> : null}</TableCell>
              <TableCell className="hidden lg:table-cell text-muted-foreground">
                <Link href={`/customers/${c.id}`} className="text-primary hover:underline">
                  {c.customer_code}
                </Link>
              </TableCell>
              <TableCell className="hidden lg:table-cell max-w-xs truncate text-muted-foreground">
                {c.address ?? "-"}
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Badge variant={c.status === "active" ? "outline" : "secondary"}>
                  {CUSTOMER_STATUS_LABELS[c.status as CustomerStatus] ?? c.status}
                </Badge>
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <div className="flex flex-wrap gap-1">
                  {c.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              {showOwner ? (
                <TableCell className="hidden lg:table-cell text-muted-foreground">{c.owner_username}</TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
