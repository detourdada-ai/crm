import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ORDER_STATUS_LABELS, formatCurrency, formatDateTime } from "@/lib/constants/order-status";
import type { Order } from "@/types/domain";

export function OrderTable({ orders, showCustomerLink = false }: { orders: Order[]; showCustomerLink?: boolean }) {
  if (orders.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">주문 내역이 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>주문번호</TableHead>
          <TableHead>주문일시</TableHead>
          <TableHead>수령인</TableHead>
          <TableHead>배송지</TableHead>
          <TableHead className="text-right">금액</TableHead>
          <TableHead>상태</TableHead>
          {showCustomerLink ? <TableHead>고객</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => (
          <TableRow key={order.id}>
            <TableCell className="font-medium">{order.order_number}</TableCell>
            <TableCell>{formatDateTime(order.order_date)}</TableCell>
            <TableCell>{order.recipient_name}</TableCell>
            <TableCell className="max-w-xs truncate">{order.address_snapshot ?? "-"}</TableCell>
            <TableCell className="text-right">{formatCurrency(Number(order.total_amount))}</TableCell>
            <TableCell>
              <Badge variant="secondary">{ORDER_STATUS_LABELS[order.status] ?? order.status}</Badge>
            </TableCell>
            {showCustomerLink ? (
              <TableCell>
                <Link href={`/customers/${order.customer_id}`} className="text-primary hover:underline">
                  보기
                </Link>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
