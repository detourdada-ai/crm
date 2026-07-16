import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/constants/order-status";
import type { InactiveCustomerEntry } from "@/lib/services/dashboard.service";

export function InactiveCustomerTable({ entries }: { entries: InactiveCustomerEntry[] }) {
  if (entries.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">최근 미주문 고객이 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>고객</TableHead>
          <TableHead>전화번호</TableHead>
          <TableHead>최근 주문</TableHead>
          <TableHead className="text-right">경과일</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map(({ customer, stats, daysSinceLastOrder }) => (
          <TableRow key={customer.id}>
            <TableCell>
              <Link href={`/customers/${customer.id}`} className="font-medium text-primary hover:underline">
                {customer.name}
              </Link>
            </TableCell>
            <TableCell>{customer.phone ?? "-"}</TableCell>
            <TableCell>{formatDate(stats.last_order_at)}</TableCell>
            <TableCell className="text-right text-muted-foreground">{daysSinceLastOrder}일 전</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
