import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ORDER_STATUS_LABELS, formatCurrency, formatDate, formatDateTime } from "@/lib/constants/order-status";
import { OrderBagCell } from "./order-bag-cell";
import type { Order } from "@/types/domain";
import type { OrderItemSummary } from "@/actions/orders";

export function OrderTable({
  orders,
  itemSummaries,
  showCustomerLink = false,
  showOwner = false,
  editableBag = false,
}: {
  orders: Order[];
  itemSummaries?: Record<string, OrderItemSummary>;
  showCustomerLink?: boolean;
  showOwner?: boolean;
  editableBag?: boolean;
}) {
  if (orders.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">주문 내역이 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>주문번호</TableHead>
          <TableHead>배송일</TableHead>
          <TableHead>구매자</TableHead>
          <TableHead>상품명</TableHead>
          <TableHead className="text-right">수량</TableHead>
          <TableHead>연락처</TableHead>
          <TableHead>배송지주소</TableHead>
          <TableHead>배송메세지</TableHead>
          <TableHead>가방번호 / 회수</TableHead>
          <TableHead className="text-right">금액</TableHead>
          <TableHead>상태</TableHead>
          {showCustomerLink ? <TableHead>고객</TableHead> : null}
          {showOwner ? <TableHead>담당자</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => {
          const summary = itemSummaries?.[order.id];
          return (
            <TableRow key={order.id}>
              <TableCell className="font-medium">
                <Link href={`/orders/${order.id}`} className="text-primary hover:underline">
                  {order.order_number}
                </Link>
                <p className="text-xs text-muted-foreground">{formatDateTime(order.order_date)}</p>
              </TableCell>
              <TableCell>{order.delivery_date ? formatDate(order.delivery_date) : "-"}</TableCell>
              <TableCell>{order.buyer_name ?? order.recipient_name}</TableCell>
              <TableCell className="max-w-48 truncate">{summary?.productSummary ?? "-"}</TableCell>
              <TableCell className="text-right">{summary?.totalQuantity ?? "-"}</TableCell>
              <TableCell>{order.phone_snapshot ?? "-"}</TableCell>
              <TableCell className="max-w-xs truncate">{order.address_snapshot ?? "-"}</TableCell>
              <TableCell className="max-w-40 truncate">{order.delivery_memo ?? "-"}</TableCell>
              <TableCell>
                {editableBag ? (
                  <OrderBagCell
                    orderId={order.id}
                    initialBagNumber={order.bag_number}
                    initialBagReturned={order.bag_returned}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <span>{order.bag_number ?? "-"}</span>
                    <Badge variant={order.bag_returned ? "secondary" : "outline"}>
                      {order.bag_returned ? "회수완료" : "미회수"}
                    </Badge>
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right">{formatCurrency(Number(order.total_amount))}</TableCell>
              <TableCell>
                {order.status ? (
                  <Badge variant="secondary">{ORDER_STATUS_LABELS[order.status] ?? order.status}</Badge>
                ) : (
                  "-"
                )}
              </TableCell>
              {showCustomerLink ? (
                <TableCell>
                  <Link href={`/customers/${order.customer_id}`} className="text-primary hover:underline">
                    보기
                  </Link>
                </TableCell>
              ) : null}
              {showOwner ? <TableCell className="text-muted-foreground">{order.owner_username}</TableCell> : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
