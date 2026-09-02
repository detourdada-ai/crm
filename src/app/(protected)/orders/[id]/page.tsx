import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, AlertTriangle, CircleDashed, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOrderDetailAction } from "@/actions/orders";
import { listDriversAction } from "@/actions/drivers";
import { listCandidateDriversAction } from "@/actions/driver-regions";
import { OrderItemRawData } from "@/components/orders/order-item-raw-data";
import { requireSession } from "@/lib/auth/current-session";
import { getTenantFeaturesForSession } from "@/lib/tenant/features";
import { ManualOrderEditDialog } from "@/components/orders/manual-order-edit-dialog";
import { ManualOrderDeleteButton } from "@/components/orders/manual-order-delete-button";
import { OrderCancelButton } from "@/components/orders/order-cancel-button";
import { OrderDriverAssign } from "@/components/orders/order-driver-assign";
import { OrderDeliveryStatusAction } from "@/components/orders/order-delivery-status-action";
import { BackButton } from "@/components/common/back-button";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/constants/order-status";
import { DELIVERY_STATUS_BADGE_VARIANT } from "@/lib/constants/delivery-status";
import { ORDER_SOURCE_LABELS } from "@/lib/constants/order-source";
import { PAYMENT_STATUS_BADGE_VARIANT } from "@/lib/constants/payment";
import { isLikelySafeNumber } from "@/lib/utils/phone";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 border-b py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium break-all">{value}</span>
    </div>
  );
}

/** F-P3E: 색상만으로 상태를 구분하지 않도록 아이콘 + 텍스트를 항상 함께 표시한다. */
function GeocodeStatusBadge({ status }: { status: "pending" | "success" | "failed" }) {
  if (status === "success") {
    return (
      <Badge variant="success">
        <CheckCircle2 className="size-3" />
        좌표 확인됨
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="warning">
        <AlertTriangle className="size-3" />
        좌표 확인 실패
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <CircleDashed className="size-3" />
      좌표 확인 대기
    </Badge>
  );
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const [detail, drivers, features, candidateDrivers] = await Promise.all([
    getOrderDetailAction(id),
    listDriversAction(),
    getTenantFeaturesForSession(session),
    listCandidateDriversAction(id),
  ]);
  if (!detail) notFound();

  const { order, items, driverName, shipments, shipmentDriverNames } = detail;
  const regionLabel = [order.sido, order.sigungu, order.eupmyeondong].filter(Boolean).join(" ");
  // S1-1 Phase 5: 발송일이 같은 주문은 배송건이 1개뿐이라 기존 화면과 동일하게 보인다.
  // 발송일이 달라 배송건이 여러 개로 쪼개진 주문만 아래에서 배송건별로 따로 보여준다.
  const singleShipment = shipments.length === 1 ? shipments[0] : null;
  // P4C STEP2-B(2026-08 CPO 작업지시): 배송건이 여러 개인데 상태가 서로
  // 다르면(예: 오늘 배송은 완료, 다른 날짜 배송은 아직 배송대기) 상단의
  // "주문 상태"(부모 롤업, 예: 배송중)만 보고는 "오늘 배송이 완료됐는데 왜
  // 아직 배송중이지?"라는 혼란이 생긴다 — 그 이유를 짧게 설명한다.
  const hasMixedShipmentStatus = shipments.length > 1 && new Set(shipments.map((s) => s.delivery_status)).size > 1;

  return (
    <div className="space-y-6">
      <BackButton fallbackHref="/orders" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{order.internal_order_number}</h1>
        <Badge variant="outline">{ORDER_SOURCE_LABELS[order.order_source]}</Badge>
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">{singleShipment ? "배송 상태" : "주문 상태"}</span>
          <Badge variant={DELIVERY_STATUS_BADGE_VARIANT[order.delivery_status]}>{order.delivery_status}</Badge>
          {singleShipment ? (
            <OrderDeliveryStatusAction shipmentId={singleShipment.id} deliveryStatus={singleShipment.delivery_status} />
          ) : shipments.length > 1 ? (
            <span className="text-xs text-muted-foreground">배송건 {shipments.length}건 — 아래에서 개별 확인</span>
          ) : null}
        </div>
        {hasMixedShipmentStatus ? (
          <p className="w-full text-xs text-muted-foreground">
            ※ 일부 배송이 아직 완료되지 않아 주문 상태가 &ldquo;{order.delivery_status}&rdquo;로 표시됩니다.
          </p>
        ) : null}
        <div className="ml-auto flex gap-2">
          <ManualOrderEditDialog order={order} item={items[0] ?? null} deliveryGroupLocked={singleShipment?.delivery_group_locked ?? false} />
          <OrderCancelButton orderId={order.id} deliveryStatus={order.delivery_status} />
          {order.import_id === null ? <ManualOrderDeleteButton orderId={order.id} /> : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>주문 정보</CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="수령인" value={order.recipient_name} />
            <Field label="원본 주문번호" value={order.order_number} />
            <div className="flex justify-between gap-3 border-b py-1.5 text-sm last:border-0">
              <span className="text-muted-foreground">고객 상세</span>
              <Link href={`/customers/${order.customer_id}`} className="font-medium text-primary hover:underline">
                고객 페이지로 이동
              </Link>
            </div>
            <Field label="수령인 연락처" value={order.phone_snapshot} />
            <Field label="구매자 연락처(원본)" value={order.buyer_phone_snapshot} />
            {order.recipient_phone_snapshot ? (
              <div className="flex justify-between gap-3 border-b py-1.5 text-sm last:border-0">
                <span className="text-muted-foreground">수취인 연락처(원본)</span>
                <span className="flex items-center gap-1.5 text-right font-medium break-all">
                  {order.recipient_phone_snapshot}
                  {isLikelySafeNumber(order.recipient_phone_snapshot) ? (
                    <Badge variant="outline" className="gap-1 text-amber-700">
                      <AlertTriangle className="size-3" />
                      안심번호 가능성
                    </Badge>
                  ) : null}
                </span>
              </div>
            ) : null}
            <Field label="배송지" value={order.address_snapshot} />
            <Field label="우편번호" value={order.zipcode} />
            <div className="flex items-center justify-between gap-3 border-b py-1.5 text-sm last:border-0">
              <span className="text-muted-foreground">행정구역</span>
              <span className="flex items-center gap-1.5 text-right">
                {regionLabel ? (
                  <span className="flex items-center gap-1 font-medium">
                    <MapPin className="size-3.5 text-muted-foreground" />
                    {regionLabel}
                  </span>
                ) : null}
                <GeocodeStatusBadge status={order.geocode_status} />
              </span>
            </div>
            <Field label="배송 요청사항" value={order.delivery_memo} />
            <Field label="주문 메모" value={order.order_memo} />
            <Field label="내부 메모" value={order.internal_memo} />
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
            {shipments.length <= 1 ? (
              <>
                <div className="flex justify-between gap-3 border-b py-1.5 text-sm last:border-0">
                  <span className="text-muted-foreground">배송일</span>
                  {(singleShipment?.delivery_date ?? order.delivery_date) ? (
                    <span className="text-right font-medium">{formatDate((singleShipment?.delivery_date ?? order.delivery_date)!)}</span>
                  ) : (
                    <span className="text-right font-medium text-warning">미지정</span>
                  )}
                </div>
                {!(singleShipment?.delivery_date ?? order.delivery_date) ? (
                  <p className="border-b py-1.5 text-xs text-muted-foreground last:border-0">
                    ※ 배송일이 지정되지 않은 주문입니다. 상단의 &ldquo;수정&rdquo; 버튼으로 배송일을 지정할 수 있습니다.
                  </p>
                ) : null}
                <Field label="배송가능지역" value={order.delivery_area} />
                <div className="flex items-center justify-between gap-3 border-b py-1.5 text-sm last:border-0">
                  <span className="text-muted-foreground">담당기사</span>
                  {singleShipment ? (
                    <OrderDriverAssign
                      shipmentId={singleShipment.id}
                      deliveryStatus={singleShipment.delivery_status}
                      driverId={singleShipment.driver_id}
                      driverName={driverName}
                      drivers={drivers}
                    />
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </div>
                {singleShipment?.delivery_group_locked ? (
                  <p className="border-b py-1.5 text-xs text-warning last:border-0">
                    ※ 이 배송건은 자동 배송그룹 계산에서 제외되어 있습니다.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="space-y-2 border-b py-1.5 last:border-0">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">배송건 ({shipments.length}건)</span>
                  <span className="text-xs text-muted-foreground">발송일이 달라 배송건이 나뉘었습니다</span>
                </div>
                <div className="space-y-2">
                  {shipments.map((s) => (
                    <div key={s.id} className="space-y-1.5 rounded-md border p-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{s.delivery_date ? formatDate(s.delivery_date) : "배송일 미지정"}</span>
                        <Badge variant={DELIVERY_STATUS_BADGE_VARIANT[s.delivery_status]}>{s.delivery_status}</Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="shrink-0 text-xs text-muted-foreground">담당기사</span>
                        <OrderDriverAssign
                          shipmentId={s.id}
                          deliveryStatus={s.delivery_status}
                          driverId={s.driver_id}
                          driverName={s.driver_id ? (shipmentDriverNames[s.driver_id] ?? null) : null}
                          drivers={drivers}
                        />
                      </div>
                      {s.delivery_group_locked ? (
                        <p className="text-xs text-warning">※ 이 배송건은 자동 배송그룹 계산에서 제외되어 있습니다.</p>
                      ) : null}
                      <div className="flex justify-end">
                        <OrderDeliveryStatusAction shipmentId={s.id} deliveryStatus={s.delivery_status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {candidateDrivers.length > 0 ? (
              <div className="flex items-start justify-between gap-3 border-b py-1.5 text-sm last:border-0">
                <span className="shrink-0 text-muted-foreground">담당 기사 후보</span>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {candidateDrivers.map((c) => (
                    <Badge key={c.driverId} variant="outline" title={`담당지역: ${c.regionLabel}`}>
                      {c.driverName}
                      {c.driverStatus === "inactive" ? " (비활성)" : ""}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            <Field label="판매채널" value={order.sales_channel} />
            <Field label="택배사" value={order.courier} />
            <Field label="송장번호" value={order.tracking_number} />
            <Field label="배송완료일" value={order.shipped_at ? formatDateTime(order.shipped_at) : null} />
            <div className="flex justify-between gap-3 border-b py-1.5 text-sm last:border-0">
              <span className="text-muted-foreground">결제상태</span>
              {order.payment_status ? (
                <Badge variant={PAYMENT_STATUS_BADGE_VARIANT[order.payment_status]}>{order.payment_status}</Badge>
              ) : (
                <Badge variant="outline" className="text-warning">확인 필요</Badge>
              )}
            </div>
            <Field label="결제방법" value={order.payment_method} />
            <Field label="결제일" value={order.paid_at ? formatDateTime(order.paid_at) : null} />
            <Field label="배송비" value={order.delivery_fee ? formatCurrency(Number(order.delivery_fee)) : null} />
            <Field label="할인금액" value={order.discount_amount ? formatCurrency(Number(order.discount_amount)) : null} />
            <Field label="총 주문금액" value={formatCurrency(Number(order.total_amount))} />
            <Field label="담당자" value={order.owner_username} />
          </CardContent>
        </Card>

        {features.bagManagement ? (
          <Card>
            <CardHeader>
              <CardTitle>가방 정보</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* 가방번호/회수 입력은 배송관리 화면 전용 — 여기는 조회만. */}
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">가방번호</span>
                <span className="font-medium">{order.bag_number ?? "-"}</span>
                <Badge variant={order.bag_returned ? "secondary" : "outline"}>
                  {order.bag_returned ? "회수완료" : "미회수"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">가방번호 등록·회수 처리는 배송관리에서 합니다.</p>
            </CardContent>
          </Card>
        ) : null}
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
