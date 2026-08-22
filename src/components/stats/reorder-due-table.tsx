import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { formatDate } from "@/lib/constants/order-status";
import type { ReorderDueCustomer } from "@/lib/services/reorder.service";

export function ReorderDueTable({ customers }: { customers: ReorderDueCustomer[] }) {
  if (customers.length === 0) {
    return <EmptyState title="재주문이 임박한 고객이 없습니다." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>고객번호</TableHead>
          <TableHead>이름</TableHead>
          <TableHead>전화번호</TableHead>
          <TableHead className="text-right">평균 주기</TableHead>
          <TableHead>최근 주문</TableHead>
          <TableHead className="text-right">지연</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map(({ customer, averageIntervalDays, lastOrderAt, overdueDays }) => (
          <TableRow key={customer.id}>
            <TableCell>
              <Link href={`/customers/${customer.id}`} className="font-medium text-primary hover:underline">
                {customer.customer_code}
              </Link>
            </TableCell>
            <TableCell>{customer.name}</TableCell>
            <TableCell>{customer.phone ?? "-"}</TableCell>
            <TableCell className="text-right">{averageIntervalDays}일</TableCell>
            <TableCell>{formatDate(lastOrderAt)}</TableCell>
            <TableCell className="text-right">
              <Badge variant="destructive">{overdueDays}일 지남</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
