"use client";

import { useRef, useState, useTransition } from "react";
import { Plus } from "lucide-react";
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
import { createManualOrderAction } from "@/actions/orders";
import { AddressSearchInput } from "@/components/common/address-search-input";

export function ManualOrderButton() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createManualOrderAction({ ok: false, error: null }, formData);
      if (!result.ok) {
        toast.error(result.error ?? "주문 등록 중 오류가 발생했습니다.");
        return;
      }
      toast.success("주문을 등록했습니다.");
      formRef.current?.reset();
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" />
          수동 주문 등록
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>수동 주문 등록</DialogTitle>
          <DialogDescription>
            전화 주문이나 정정 등 엑셀 업로드 없이 직접 주문을 등록합니다. 고객 정보는 기존 고객과 자동으로
            매칭되거나 새로 생성되어 고객관리에도 바로 반영됩니다.
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">고객 이름</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">전화번호</Label>
            <Input id="phone" name="phone" placeholder="010-0000-0000" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="address">주소</Label>
            <AddressSearchInput id="address" name="address" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="deliveryMemo">배송메세지</Label>
            <Input id="deliveryMemo" name="deliveryMemo" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="orderDate">주문일</Label>
            <Input id="orderDate" name="orderDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manualDeliveryDate">배송일</Label>
            <Input id="manualDeliveryDate" name="deliveryDate" type="date" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="productName">상품명</Label>
            <Input id="productName" name="productName" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quantity">수량</Label>
            <Input id="quantity" name="quantity" type="number" min={1} defaultValue={1} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="unitPrice">단가</Label>
            <Input id="unitPrice" name="unitPrice" type="number" min={0} defaultValue={0} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="status">상태</Label>
            <Input id="status" name="status" placeholder="접수완료" />
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "등록하는 중..." : "등록"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
