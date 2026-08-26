"use client";

import { useRef, useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { updateManualOrderAction } from "@/actions/orders";
import { AddressSearchInput } from "@/components/common/address-search-input";
import { ORDER_SOURCE_OPTIONS } from "@/lib/constants/order-source";
import {
  PAYMENT_STATUS_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  DEFAULT_PAYMENT_STATUS,
  NO_PAYMENT_METHOD_VALUE,
} from "@/lib/constants/payment";
import type { Order, OrderItem } from "@/types/domain";

export function ManualOrderEditDialog({ order, item }: { order: Order; item: OrderItem | null }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateManualOrderAction(order.id, { ok: false, error: null }, formData);
      if (!result.ok) {
        toast.error(result.error ?? "주문 수정 중 오류가 발생했습니다.");
        return;
      }
      toast.success("주문을 수정했습니다.");
      setOpen(false);
    });
  }

  const locked = order.delivery_status === "취소";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={locked}>
          <Pencil className="size-4" />
          수정
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>주문 수정</DialogTitle>
          <DialogDescription>이 주문의 내용을 수정합니다. 고객 정보는 별도로 동기화되지 않으니 필요하면 고객관리에서도 함께 수정해주세요.</DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="editName">수령인</Label>
            <Input id="editName" name="name" defaultValue={order.recipient_name} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="editPhone">수령인 연락처</Label>
            <Input id="editPhone" name="phone" defaultValue={order.phone_snapshot ?? ""} placeholder="010-0000-0000" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>배송지 주소</Label>
            <AddressSearchInput
              name="delivery"
              defaultPostalCode={order.zipcode}
              defaultRoadAddress={order.road_address_snapshot ?? order.address_snapshot}
              defaultDetailAddress={order.detail_address_snapshot}
              required
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="editDeliveryMemo">배송 요청사항</Label>
            <Input id="editDeliveryMemo" name="deliveryMemo" defaultValue={order.delivery_memo ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="editOrderSource">주문 출처</Label>
            <Select name="orderSource" defaultValue={order.order_source} required>
              <SelectTrigger id="editOrderSource" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORDER_SOURCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="editOrderDate">주문일</Label>
            <Input id="editOrderDate" name="orderDate" type="date" defaultValue={order.order_date.slice(0, 10)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="editDeliveryDate">배송일</Label>
            <Input id="editDeliveryDate" name="deliveryDate" type="date" defaultValue={order.delivery_date?.slice(0, 10) ?? ""} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="editProductName">상품명</Label>
            <Input id="editProductName" name="productName" defaultValue={item?.product_name ?? ""} required />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="editOptionName">옵션</Label>
            <Input id="editOptionName" name="optionName" defaultValue={item?.option_name ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="editQuantity">수량</Label>
            <Input id="editQuantity" name="quantity" type="number" min={1} defaultValue={item?.quantity ?? 1} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="editUnitPrice">단가</Label>
            <Input id="editUnitPrice" name="unitPrice" type="number" min={0} defaultValue={item?.unit_price ?? 0} />
          </div>
          <div className="space-y-2 sm:col-span-2 border-t pt-4">
            <Label className="text-sm font-medium">결제 정보</Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="editPaymentStatus">결제상태</Label>
            <Select name="paymentStatus" defaultValue={order.payment_status ?? DEFAULT_PAYMENT_STATUS}>
              <SelectTrigger id="editPaymentStatus" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="editPaymentMethod">결제방법</Label>
            <Select name="paymentMethod" defaultValue={order.payment_method ?? NO_PAYMENT_METHOD_VALUE}>
              <SelectTrigger id="editPaymentMethod" className="w-full">
                <SelectValue placeholder="선택 안 함" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PAYMENT_METHOD_VALUE}>선택 안 함</SelectItem>
                {PAYMENT_METHOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="editPaidAt">결제일</Label>
            <Input id="editPaidAt" name="paidAt" type="date" defaultValue={order.paid_at?.slice(0, 10) ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="editDeliveryFee">배송비</Label>
            <Input id="editDeliveryFee" name="deliveryFee" type="number" min={0} defaultValue={order.delivery_fee ?? 0} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="editDiscountAmount">할인금액</Label>
            <Input id="editDiscountAmount" name="discountAmount" type="number" min={0} defaultValue={order.discount_amount ?? 0} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="editOrderMemo">주문 메모</Label>
            <Input id="editOrderMemo" name="orderMemo" defaultValue={order.order_memo ?? ""} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="editInternalMemo">내부 메모</Label>
            <Input id="editInternalMemo" name="internalMemo" defaultValue={order.internal_memo ?? ""} />
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "저장하는 중..." : "저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
