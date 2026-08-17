"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, PenLine, Plus } from "lucide-react";
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
import { createManualOrderAction } from "@/actions/orders";
import { AddressSearchInput } from "@/components/common/address-search-input";
import { OrderCustomerPicker } from "@/components/orders/order-customer-picker";
import { ORDER_SOURCE_OPTIONS } from "@/lib/constants/order-source";
import { kstTodayIso } from "@/lib/utils/kst-date";
import type { Customer } from "@/types/domain";

type Step = "choose" | "manual";

export function ManualOrderButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  // F6: 수령인은 고객 선택 시 자동으로 채워지되, 사용자가 이미 직접 손댔다면
  // 그 값을 덮어쓰지 않는다(이 주문만의 독립적인 배송 snapshot이므로).
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientTouched, setRecipientTouched] = useState(false);

  function handleCustomerChange(customer: Customer | null) {
    if (recipientTouched) return;
    setRecipientName(customer?.name ?? "");
    setRecipientPhone(customer?.phone ?? "");
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setStep("choose");
      setRecipientName("");
      setRecipientPhone("");
      setRecipientTouched(false);
    }
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
              <span className="text-xs text-muted-foreground">전화·문자·SNS 주문 등 1건씩 입력</span>
            </button>
          </div>
        </DialogContent>
      ) : (
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>직접 등록</DialogTitle>
            <DialogDescription>
              전화, 문자, SNS 등으로 받은 주문을 표준 형태로 등록합니다. 배송지는 주소 검색으로 선택한 값이 이
              주문에만 저장되며, 이후 고객 정보가 바뀌어도 이 주문의 배송지는 변하지 않습니다.
            </DialogDescription>
          </DialogHeader>
          <form ref={formRef} onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="mb-2 block text-sm font-medium">고객</Label>
              <OrderCustomerPicker onCustomerChange={handleCustomerChange} />
            </div>

            <div className="space-y-2 sm:col-span-2 border-t pt-4">
              <Label className="text-sm font-medium">배송 정보</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipientName">수령인</Label>
              <Input
                id="recipientName"
                name="recipientName"
                value={recipientName}
                onChange={(e) => {
                  setRecipientTouched(true);
                  setRecipientName(e.target.value);
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipientPhone">수령인 연락처</Label>
              <Input
                id="recipientPhone"
                name="recipientPhone"
                value={recipientPhone}
                onChange={(e) => {
                  setRecipientTouched(true);
                  setRecipientPhone(e.target.value);
                }}
                placeholder="010-0000-0000"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>배송지 주소</Label>
              <AddressSearchInput name="delivery" required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="deliveryMemo">배송 요청사항</Label>
              <Input id="deliveryMemo" name="deliveryMemo" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deliveryDate">배송일</Label>
              <Input id="deliveryDate" name="deliveryDate" type="date" />
            </div>

            <div className="space-y-2 sm:col-span-2 border-t pt-4">
              <Label className="text-sm font-medium">주문 정보</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="orderSource">주문 출처</Label>
              <Select name="orderSource" required>
                <SelectTrigger id="orderSource" className="w-full">
                  <SelectValue placeholder="주문을 받은 채널을 선택하세요" />
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
              <Label htmlFor="orderDate">주문일</Label>
              <Input id="orderDate" name="orderDate" type="date" defaultValue={kstTodayIso()} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="productName">상품명</Label>
              <Input id="productName" name="productName" required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="optionName">옵션</Label>
              <Input id="optionName" name="optionName" placeholder="예: 대/2인분" />
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
              <Label htmlFor="orderMemo">주문 메모</Label>
              <Input id="orderMemo" name="orderMemo" placeholder="고객 응대 시 참고할 메모" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="internalMemo">내부 메모</Label>
              <Input id="internalMemo" name="internalMemo" placeholder="직원만 보는 메모" />
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
