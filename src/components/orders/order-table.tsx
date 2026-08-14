import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead } from "@/components/common/sortable-table-head";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/constants/order-status";
import { DELIVERY_STATUS_BADGE_VARIANT } from "@/lib/constants/delivery-status";
import { ORDER_SOURCE_LABELS } from "@/lib/constants/order-source";
import { OrderBagCell } from "./order-bag-cell";
import type { Order } from "@/types/domain";
import type { OrderItemSummary } from "@/actions/orders";

/**
 * 주문 업무 화면의 핵심 — 주문번호/구매자/상품/상태는 항상 보이고(3초 안에
 * "무슨 주문이 어느 단계인지" 파악), 나머지 세부 필드는 화면이 좁을 때
 * 우선순위에 따라 숨긴다. 데이터 자체는 그대로 유지, 시각적 위계만 조정.
 */
export function OrderTable({
  orders,
  itemSummaries,
  driverNames,
  showCustomerLink = false,
  showOwner = false,
  editableBag = false,
}: {
  orders: Order[];
  itemSummaries?: Record<string, OrderItemSummary>;
  driverNames?: Record<string, string>;
  showCustomerLink?: boolean;
  showOwner?: boolean;
  editableBag?: boolean;
}) {
  if (orders.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">주문 내역이 없습니다.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableTableHead field="internal_order_number">주문번호</SortableTableHead>
            <SortableTableHead field="recipient_name">구매자</SortableTableHead>
            <TableHead>상품명</TableHead>
            <SortableTableHead field="delivery_date">배송일</SortableTableHead>
            <SortableTableHead field="delivery_status">상태</SortableTableHead>
            <SortableTableHead field="total_amount" className="text-right" defaultDir="asc">
              금액
            </SortableTableHead>
            <SortableTableHead field="order_date" className="hidden lg:table-cell">
              주문일
            </SortableTableHead>
            <TableHead className="hidden lg:table-cell text-right">수량</TableHead>
            <SortableTableHead field="phone_snapshot" className="hidden lg:table-cell">
              연락처
            </SortableTableHead>
            <SortableTableHead field="address_snapshot" className="hidden xl:table-cell">
              배송지주소
            </SortableTableHead>
            <TableHead className="hidden xl:table-cell">배송메세지</TableHead>
            <TableHead className="hidden lg:table-cell">가방번호 / 회수</TableHead>
            <SortableTableHead field="driver_id" className="hidden lg:table-cell">
              담당기사
            </SortableTableHead>
            {showCustomerLink ? <TableHead className="hidden lg:table-cell">고객</TableHead> : null}
            {showOwner ? <TableHead className="hidden lg:table-cell">담당자</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => {
            const summary = itemSummaries?.[order.id];
            return (
              <TableRow key={order.id} className="hover:bg-muted/40">
                <TableCell className="font-medium">
                  <Link href={`/orders/${order.id}`} className="flex items-center gap-1.5 text-primary hover:underline">
                    <span>{order.internal_order_number}</span>
                    <Badge variant="outline" className="text-muted-foreground">
                      {ORDER_SOURCE_LABELS[order.order_source]}
                    </Badge>
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/orders/${order.id}`} className="font-semibold text-text-strong hover:text-primary">
                    {order.buyer_name ?? order.recipient_name}
                  </Link>
                </TableCell>
                <TableCell className="max-w-48 truncate font-medium text-text-strong">
                  {summary?.productSummary ?? "-"}
                </TableCell>
                <TableCell>
                  {order.delivery_date ? (
                    formatDate(order.delivery_date)
                  ) : (
                    <span className="text-muted-foreground">미지정</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={DELIVERY_STATUS_BADGE_VARIANT[order.delivery_status]}>{order.delivery_status}</Badge>
                </TableCell>
                <TableCell className="text-right">{formatCurrency(Number(order.total_amount))}</TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground">
                  {formatDateTime(order.order_date)}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-right text-muted-foreground">
                  {summary?.totalQuantity ?? "-"}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground">{order.phone_snapshot ?? "-"}</TableCell>
                <TableCell className="hidden xl:table-cell max-w-xs truncate text-muted-foreground">
                  {order.address_snapshot ?? "-"}
                </TableCell>
                <TableCell className="hidden xl:table-cell max-w-40 truncate text-muted-foreground">
                  {order.delivery_memo ?? "-"}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {editableBag ? (
                    <OrderBagCell
                      orderId={order.id}
                      initialBagNumber={order.bag_number}
                      initialBagReturned={order.bag_returned}
                    />
                  ) : (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>{order.bag_number ?? "-"}</span>
                      <Badge variant={order.bag_returned ? "secondary" : "outline"}>
                        {order.bag_returned ? "회수완료" : "미회수"}
                      </Badge>
                    </div>
                  )}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground">
                  {order.driver_id ? (driverNames?.[order.driver_id] ?? "-") : "-"}
                </TableCell>
                {showCustomerLink ? (
                  <TableCell className="hidden lg:table-cell">
                    <Link href={`/customers/${order.customer_id}`} className="text-primary hover:underline">
                      보기
                    </Link>
                  </TableCell>
                ) : null}
                {showOwner ? (
                  <TableCell className="hidden lg:table-cell text-muted-foreground">{order.owner_username}</TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
