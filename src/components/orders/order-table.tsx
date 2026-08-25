import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead } from "@/components/common/sortable-table-head";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/constants/order-status";
import { DELIVERY_STATUS_BADGE_VARIANT } from "@/lib/constants/delivery-status";
import { ORDER_SOURCE_LABELS } from "@/lib/constants/order-source";
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
  bagManagementEnabled = false,
  visibleColumns,
}: {
  /** S1-3: rowKey가 있으면(배송건 단위 조회) 그것을 React key/상품요약 조회 키로 쓴다 — 같은 주문이 배송일별로 여러 행이 될 수 있어 order.id만으로는 행이 충돌한다. */
  orders: (Order & { rowKey?: string })[];
  itemSummaries?: Record<string, OrderItemSummary>;
  driverNames?: Record<string, string>;
  showCustomerLink?: boolean;
  showOwner?: boolean;
  /** Phase 10: 가방 관리 미사용 사업장에서는 컬럼 자체를 숨긴다. */
  bagManagementEnabled?: boolean;
  /**
   * STD-8/UX11: 계정이 선택한 노출 컬럼 id 목록 — 항상 구체적인 배열이다
   * (기본값은 호출부에서 ORDER_TABLE_TOGGLEABLE_COLUMN_IDS로 이미 채워서
   * 넘긴다). "extra:헤더명" 형태의 id는 엑셀 원본 컬럼(order_items.extra)을
   * 가리킨다 — 시스템 고정 컬럼이 아니므로 저장된 적 없으면 기본적으로
   * 노출되지 않는다(핵심 9개만 기본 노출한다는 원칙).
   */
  visibleColumns: string[];
}) {
  if (orders.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">주문 내역이 없습니다.</p>;
  }

  const isVisible = (columnId: string) => visibleColumns.includes(columnId);
  const extraColumns = visibleColumns.filter((id) => id.startsWith("extra:")).map((id) => id.slice("extra:".length));

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
            {isVisible("orderDate") ? (
              <SortableTableHead field="order_date" className="hidden lg:table-cell">
                주문일
              </SortableTableHead>
            ) : null}
            {isVisible("quantity") ? <TableHead className="hidden lg:table-cell text-right">수량</TableHead> : null}
            {isVisible("phone") ? (
              <SortableTableHead field="phone_snapshot" className="hidden lg:table-cell">
                연락처
              </SortableTableHead>
            ) : null}
            {isVisible("address") ? (
              <SortableTableHead field="address_snapshot" className="hidden xl:table-cell">
                배송지주소
              </SortableTableHead>
            ) : null}
            {isVisible("memo") ? <TableHead className="hidden xl:table-cell">배송메세지</TableHead> : null}
            {bagManagementEnabled && isVisible("bag") ? (
              <TableHead className="hidden lg:table-cell">가방번호 / 회수</TableHead>
            ) : null}
            {isVisible("driver") ? (
              <SortableTableHead field="driver_id" className="hidden lg:table-cell">
                담당기사
              </SortableTableHead>
            ) : null}
            {showCustomerLink && isVisible("customerLink") ? <TableHead className="hidden lg:table-cell">고객</TableHead> : null}
            {showOwner && isVisible("owner") ? <TableHead className="hidden lg:table-cell">담당자</TableHead> : null}
            {extraColumns.map((col) => (
              <TableHead key={col} className="hidden xl:table-cell">
                {col}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => {
            const rowKey = order.rowKey ?? order.id;
            const summary = itemSummaries?.[rowKey];
            return (
              <TableRow key={rowKey} className="hover:bg-muted/40">
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
                <TableCell className="text-right">{formatCurrency(summary ? summary.totalAmount : Number(order.total_amount))}</TableCell>
                {isVisible("orderDate") ? (
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {formatDateTime(order.order_date)}
                  </TableCell>
                ) : null}
                {isVisible("quantity") ? (
                  <TableCell className="hidden lg:table-cell text-right text-muted-foreground">
                    {summary?.totalQuantity ?? "-"}
                  </TableCell>
                ) : null}
                {isVisible("phone") ? (
                  <TableCell className="hidden lg:table-cell text-muted-foreground">{order.phone_snapshot ?? "-"}</TableCell>
                ) : null}
                {isVisible("address") ? (
                  <TableCell className="hidden xl:table-cell max-w-xs truncate text-muted-foreground">
                    {order.address_snapshot ?? "-"}
                  </TableCell>
                ) : null}
                {isVisible("memo") ? (
                  <TableCell className="hidden xl:table-cell max-w-40 truncate text-muted-foreground">
                    {order.delivery_memo ?? "-"}
                  </TableCell>
                ) : null}
                {bagManagementEnabled && isVisible("bag") ? (
                  <TableCell className="hidden lg:table-cell">
                    {/* 가방번호/회수 입력은 배송관리 화면 전용 — 주문관리는 조회만(배송건에서 동기화된 값). */}
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>{order.bag_number ?? "-"}</span>
                      <Badge variant={order.bag_returned ? "secondary" : "outline"}>
                        {order.bag_returned ? "회수완료" : "미회수"}
                      </Badge>
                    </div>
                  </TableCell>
                ) : null}
                {isVisible("driver") ? (
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {order.driver_id ? (driverNames?.[order.driver_id] ?? "-") : "-"}
                  </TableCell>
                ) : null}
                {showCustomerLink && isVisible("customerLink") ? (
                  <TableCell className="hidden lg:table-cell">
                    <Link href={`/customers/${order.customer_id}`} className="text-primary hover:underline">
                      보기
                    </Link>
                  </TableCell>
                ) : null}
                {showOwner && isVisible("owner") ? (
                  <TableCell className="hidden lg:table-cell text-muted-foreground">{order.owner_username}</TableCell>
                ) : null}
                {extraColumns.map((col) => (
                  <TableCell key={col} className="hidden xl:table-cell max-w-40 truncate text-muted-foreground">
                    {summary?.extra?.[col] != null ? String(summary.extra[col]) : "-"}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
