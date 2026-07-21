"use client";

import { useRef, useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Pencil className="size-4" />
          수정
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>수동 주문 수정</DialogTitle>
          <DialogDescription>이 주문의 내용을 수정합니다. 고객 정보는 별도로 동기화되지 않으니 필요하면 고객관리에서도 함께 수정해주세요.</DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="editName">고객 이름</Label>
            <Input id="editName" name="name" defaultValue={order.recipient_name} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="editPhone">전화번호</Label>
            <Input id="editPhone" name="phone" defaultValue={order.phone_snapshot ?? ""} placeholder="010-0000-0000" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="editAddress">주소</Label>
            <AddressSearchInput id="editAddress" name="address" defaultValue={order.address_snapshot ?? ""} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="editDeliveryMemo">배송메세지</Label>
            <Input id="editDeliveryMemo" name="deliveryMemo" defaultValue={order.delivery_memo ?? ""} />
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
          <div className="space-y-2">
            <Label htmlFor="editQuantity">수량</Label>
            <Input id="editQuantity" name="quantity" type="number" min={1} defaultValue={item?.quantity ?? 1} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="editUnitPrice">단가</Label>
            <Input id="editUnitPrice" name="unitPrice" type="number" min={0} defaultValue={item?.unit_price ?? 0} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="editStatus">상태</Label>
            <Input id="editStatus" name="status" defaultValue={order.status} placeholder="접수완료" />
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
