"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, PenLine, Plus } from "lucide-react";
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
import { kstTodayIso } from "@/lib/utils/kst-date";

type Step = "choose" | "manual";

export function ManualOrderButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setStep("choose");
  }

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
      handleOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" />
          주문 등록
        </Button>
      </DialogTrigger>

      {step === "choose" ? (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>주문 등록</DialogTitle>
            <DialogDescription>등록 방법을 선택하세요.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => router.push("/import")}
              className="flex flex-col items-center gap-2 rounded-lg border p-6 text-center transition-colors hover:border-primary hover:bg-accent/40"
            >
              <FileSpreadsheet className="size-7 text-primary" />
              <span className="font-medium">Excel로 등록</span>
              <span className="text-xs text-muted-foreground">여러 건을 한 번에 업로드</span>
            </button>
            <button
              type="button"
              onClick={() => setStep("manual")}
              className="flex flex-col items-center gap-2 rounded-lg border p-6 text-center transition-colors hover:border-primary hover:bg-accent/40"
            >
              <PenLine className="size-7 text-primary" />
              <span className="font-medium">직접 등록</span>
              <span className="text-xs text-muted-foreground">전화 주문 등 1건씩 입력</span>
            </button>
          </div>
        </DialogContent>
      ) : (
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>직접 등록</DialogTitle>
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
            <Input id="orderDate" name="orderDate" type="date" defaultValue={kstTodayIso()} />
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
      )}
    </Dialog>
  );
}
