"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, PenLine, Plus, Minus, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { kstTodayIso, resolveKstQuickRange } from "@/lib/utils/kst-date";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types/domain";

type Step = "choose" | "manual";

interface AddressSeed {
  postalCode: string | null;
  roadAddress: string | null;
  detailAddress: string | null;
}

export function ManualOrderButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [isPending, startTransition] = useTransition();

  // F12: 저장 후에도 dialog를 닫지 않고 폼만 초기화해 반복 입력을 빠르게
  // 한다 — formGeneration을 <form>의 key로 써서 통째로 remount시키면 내부
  // state를 가진 OrderCustomerPicker/AddressSearchInput까지 한 번에 깨끗이
  // 비워진다(단순 formRef.reset()은 이 두 컴포넌트의 React state까지는
  // 지우지 못해 이전 주문의 고객/주소가 남는 버그가 생길 수 있었다).
  const [formGeneration, setFormGeneration] = useState(0);

  // F6: 수령인은 고객 선택 시 자동으로 채워지되, 사용자가 이미 직접 손댔다면
  // 그 값을 덮어쓰지 않는다(이 주문만의 독립적인 배송 snapshot이므로).
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientTouched, setRecipientTouched] = useState(false);

  // F12: 고객을 선택하면 주소도 함께 채운다 — customerAddressKey를 바꿔
  // AddressSearchInput을 새 기본값으로 remount시킨다(내부 state라 prop만
  // 바꿔서는 갱신되지 않는다).
  const [addressSeed, setAddressSeed] = useState<AddressSeed | null>(null);
  const [customerAddressKey, setCustomerAddressKey] = useState(0);

  const [quantity, setQuantity] = useState(1);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [memoExpanded, setMemoExpanded] = useState(false);

  function handleCustomerChange(customer: Customer | null) {
    if (!recipientTouched) {
      setRecipientName(customer?.name ?? "");
      setRecipientPhone(customer?.phone ?? "");
    }
    setAddressSeed(
      customer
        ? {
            postalCode: customer.postal_code,
            // 구조화 주소 도입 전 고객은 road_address가 없으므로 기존 합성
            // 주소(address)로라도 채워준다 — customer-edit-form과 동일한 fallback.
            roadAddress: customer.road_address ?? customer.address,
            detailAddress: customer.detail_address,
          }
        : null
    );
    setCustomerAddressKey((k) => k + 1);
  }

  function resetForNextEntry() {
    setFormGeneration((g) => g + 1);
    setRecipientName("");
    setRecipientPhone("");
    setRecipientTouched(false);
    setAddressSeed(null);
    setCustomerAddressKey((k) => k + 1);
    setQuantity(1);
    setDeliveryDate("");
    setMemoExpanded(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setStep("choose");
      resetForNextEntry();
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
      toast.success(
        result.internalOrderNumber ? `주문을 등록했습니다. (${result.internalOrderNumber})` : "주문을 등록했습니다."
      );
      // F12 STEP13: dialog는 열어둔 채 다음 주문을 바로 입력할 수 있게 한다.
      resetForNextEntry();
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
          <form key={formGeneration} onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="mb-2 block text-sm font-medium">고객</Label>
              <OrderCustomerPicker onCustomerChange={handleCustomerChange} />
            </div>

            <div className="space-y-2 sm:col-span-2 border-t pt-4">
              <Label className="text-sm font-medium">배송 정보</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipientName">
                수령인 <span className="text-destructive">*</span>
              </Label>
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
              <Label htmlFor="recipientPhone">
                수령인 연락처 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="recipientPhone"
                name="recipientPhone"
                value={recipientPhone}
                onChange={(e) => {
                  setRecipientTouched(true);
                  setRecipientPhone(e.target.value);
                }}
                placeholder="010-0000-0000"
                required
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>
                배송지 주소 <span className="text-destructive">*</span>
              </Label>
              <AddressSearchInput
                key={`${formGeneration}-${customerAddressKey}`}
                name="delivery"
                defaultPostalCode={addressSeed?.postalCode}
                defaultRoadAddress={addressSeed?.roadAddress}
                defaultDetailAddress={addressSeed?.detailAddress}
                required
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="deliveryMemo">배송 요청사항</Label>
              <Input id="deliveryMemo" name="deliveryMemo" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deliveryDate">
                배송일 <span className="text-destructive">*</span>
              </Label>
              <div className="flex flex-wrap items-center gap-1.5">
                <Input
                  id="deliveryDate"
                  name="deliveryDate"
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="w-36"
                  required
                />
                <Button type="button" size="sm" variant="outline" onClick={() => setDeliveryDate(kstTodayIso())}>
                  오늘
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDeliveryDate(resolveKstQuickRange("tomorrow").start)}
                >
                  내일
                </Button>
              </div>
            </div>

            <div className="space-y-2 sm:col-span-2 border-t pt-4">
              <Label className="text-sm font-medium">주문 정보</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="orderSource">
                주문 출처 <span className="text-destructive">*</span>
              </Label>
              <Select name="orderSource" defaultValue="전화" required>
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
              <Label htmlFor="productName">
                상품명 <span className="text-destructive">*</span>
              </Label>
              <Input id="productName" name="productName" required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="optionName">옵션</Label>
              <Input id="optionName" name="optionName" placeholder="예: 대/2인분" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quantity">
                수량 <span className="text-destructive">*</span>
              </Label>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-9 shrink-0"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  aria-label="수량 감소"
                >
                  <Minus className="size-4" />
                </Button>
                <Input
                  id="quantity"
                  name="quantity"
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Math.trunc(Number(e.target.value)) || 1))}
                  className="text-center"
                  required
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-9 shrink-0"
                  onClick={() => setQuantity((q) => q + 1)}
                  aria-label="수량 증가"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="unitPrice">단가</Label>
              <Input id="unitPrice" name="unitPrice" type="number" min={0} defaultValue={0} />
            </div>

            <Collapsible
              open={memoExpanded}
              onOpenChange={setMemoExpanded}
              className="sm:col-span-2 border-t pt-4"
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span>메모 추가 (선택)</span>
                  <ChevronDown className={cn("size-4 transition-transform", memoExpanded && "rotate-180")} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="grid gap-4 pt-3 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="orderMemo">주문 메모</Label>
                  <Input id="orderMemo" name="orderMemo" placeholder="고객 응대 시 참고할 메모" />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="internalMemo">내부 메모 (고객에게 전달되지 않음)</Label>
                  <Input id="internalMemo" name="internalMemo" placeholder="직원만 보는 메모" />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="status">상태</Label>
                  <Input id="status" name="status" placeholder="접수완료" />
                </div>
              </CollapsibleContent>
            </Collapsible>

            <DialogFooter className="sm:col-span-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? "등록하는 중..." : "등록하고 계속 입력"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
