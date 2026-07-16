import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/constants/order-status";
import type { CustomerRankingEntry } from "@/lib/services/dashboard.service";

export function CustomerRankingTable({ entries }: { entries: CustomerRankingEntry[] }) {
  if (entries.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">주문 데이터가 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>고객</TableHead>
          <TableHead className="text-right">주문횟수</TableHead>
          <TableHead className="text-right">총 구매금액</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map(({ customer, stats }, index) => (
          <TableRow key={customer.id}>
            <TableCell className="text-muted-foreground">{index + 1}</TableCell>
            <TableCell>
              <Link href={`/customers/${customer.id}`} className="font-medium text-primary hover:underline">
                {customer.name}
              </Link>
            </TableCell>
            <TableCell className="text-right">{stats.total_orders}회</TableCell>
            <TableCell className="text-right">{formatCurrency(Number(stats.total_amount))}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
