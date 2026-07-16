import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOrderDetailAction } from "@/actions/orders";
import { OrderItemRawData } from "@/components/orders/order-item-raw-data";
import { BackButton } from "@/components/common/back-button";
import { formatCurrency, formatDateTime } from "@/lib/constants/order-status";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 border-b py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium break-all">{value}</span>
    </div>
  );
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getOrderDetailAction(id);
  if (!detail) notFound();

  const { order, items } = detail;

  return (
    <div className="space-y-6">
      <BackButton fallbackHref="/orders" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{order.order_number}</h1>
        {order.status ? <Badge variant="secondary">{order.status}</Badge> : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>주문 정보</CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="고객" value={order.recipient_name} />
            <div className="flex justify-between gap-3 border-b py-1.5 text-sm last:border-0">
              <span className="text-muted-foreground">고객 상세</span>
              <Link href={`/customers/${order.customer_id}`} className="font-medium text-primary hover:underline">
                고객 페이지로 이동
              </Link>
            </div>
            <Field label="수취인 연락처" value={order.phone_snapshot} />
            <Field label="배송지" value={order.address_snapshot} />
            <Field label="우편번호" value={order.zipcode} />
            <Field label="배송메모" value={order.delivery_memo} />
            <Field label="구매자명" value={order.buyer_name} />
            <Field label="구매자ID" value={order.buyer_id} />
            <Field label="주문일시" value={formatDateTime(order.order_date)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>배송/결제 정보</CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="판매채널" value={order.sales_channel} />
            <Field label="택배사" value={order.courier} />
            <Field label="송장번호" value={order.tracking_number} />
            <Field label="배송완료일" value={order.shipped_at ? formatDateTime(order.shipped_at) : null} />
            <Field label="총 주문금액" value={formatCurrency(Number(order.total_amount))} />
            <Field label="담당자" value={order.owner_username} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>주문 상품</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>상품명</TableHead>
                <TableHead>옵션</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead className="text-right">단가</TableHead>
                <TableHead className="text-right">금액</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.product_name}</TableCell>
                  <TableCell>{item.option_name ?? "-"}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(item.unit_price))}</TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(item.amount))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="space-y-3">
            {items.map((item) => (
              <OrderItemRawData key={item.id} extra={item.extra} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
