import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/constants/order-status";
import type { VipCustomer } from "@/lib/services/vip.service";

export function VipCustomerTable({ customers }: { customers: VipCustomer[] }) {
  if (customers.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">VIP 기준을 충족하는 고객이 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>고객번호</TableHead>
          <TableHead>이름</TableHead>
          <TableHead>전화번호</TableHead>
          <TableHead className="text-right">주문횟수</TableHead>
          <TableHead className="text-right">총 구매금액</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map(({ customer, stats }) => (
          <TableRow key={customer.id}>
            <TableCell>
              <Link href={`/customers/${customer.id}`} className="font-medium text-primary hover:underline">
                {customer.customer_code}
              </Link>
            </TableCell>
            <TableCell>{customer.name}</TableCell>
            <TableCell>{customer.phone ?? "-"}</TableCell>
            <TableCell className="text-right">{stats.total_orders}회</TableCell>
            <TableCell className="text-right">{formatCurrency(Number(stats.total_amount))}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
