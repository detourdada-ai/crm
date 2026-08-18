"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, PenLine, Plus, Minus, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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
import { listActiveProductsAction } from "@/actions/products";
import { AddressSearchInput } from "@/components/common/address-search-input";
import { OrderCustomerPicker } from "@/components/orders/order-customer-picker";
import { ORDER_SOURCE_OPTIONS } from "@/lib/constants/order-source";
import { kstTodayIso, resolveKstQuickRange } from "@/lib/utils/kst-date";
import { cn } from "@/lib/utils";
import type { Customer, Product } from "@/types/domain";

type Step = "choose" | "manual";

/** F-P3C: "직접 입력"을 선택했을 때 쓰는 sentinel — 실제 product.id와 절대 겹치지 않는다. */
const CUSTOM_PRODUCT_VALUE = "__custom__";

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

  // F-P3A: "고객명과 동일" 체크(기본 켜짐) 상태에서는 고객명이 바뀔 때마다
  // 수령인 이름도 함께 갱신되고, 필드 자체는 잠긴다. 체크를 해제하면 그
  // 순간부터는 고객명이 바뀌어도 수령인은 더 이상 따라가지 않고 직접 수정할
  // 수 있다 — 이 주문만의 독립적인 배송 snapshot이라는 기존 원칙과 동일하다.
  const [customerName, setCustomerName] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [syncRecipientName, setSyncRecipientName] = useState(true);
  // 연락처는 기존과 동일하게 "고객 선택 시 채우되, 직접 손대면 더 이상
  // 덮어쓰지 않는" 방식을 유지한다(이번 작업 범위 밖).
  const [recipientPhone, setRecipientPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);

  // F12: 고객을 선택하면 주소도 함께 채운다 — customerAddressKey를 바꿔
  // AddressSearchInput을 새 기본값으로 remount시킨다(내부 state라 prop만
  // 바꿔서는 갱신되지 않는다).
  const [addressSeed, setAddressSeed] = useState<AddressSeed | null>(null);
  const [customerAddressKey, setCustomerAddressKey] = useState(0);

  // F-P3C: 상품 카탈로그 SelectBox — "직접 입력"(sentinel)이 기본값이라
  // 카탈로그가 비어있는 계정도 기존과 동일하게 자유 입력으로 주문을 등록할
  // 수 있다. 실제 상품을 선택하면 상품명/단가가 자동 입력되고 잠기지만,
  // 저장은 이 필드들의 "현재 값"을 그대로 스냅샷으로 남기므로 이후 상품
  // 카탈로그의 가격이 바뀌어도 이미 등록된 주문에는 영향이 없다.
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState(CUSTOM_PRODUCT_VALUE);
  const [productName, setProductName] = useState("");
  const [unitPrice, setUnitPrice] = useState(0);
  const isCustomProduct = selectedProductId === CUSTOM_PRODUCT_VALUE;

  const [quantity, setQuantity] = useState(1);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [memoExpanded, setMemoExpanded] = useState(false);

  useEffect(() => {
    if (step === "manual") {
      listActiveProductsAction().then(setProducts);
    }
  }, [step]);

  function handleProductSelect(value: string) {
    setSelectedProductId(value);
    if (value === CUSTOM_PRODUCT_VALUE) return;
    const product = products.find((p) => p.id === value);
    if (product) {
      setProductName(product.name);
      setUnitPrice(product.unit_price);
    }
  }

  function handleCustomerChange(customer: Customer | null) {
    const name = customer?.name ?? "";
    setCustomerName(name);
    if (syncRecipientName) setRecipientName(name);
    if (!phoneTouched) setRecipientPhone(customer?.phone ?? "");
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

  /** F-P3A: "신규 고객 등록" 탭에서 고객명을 타이핑할 때마다 실시간으로 반영. */
  function handleCustomerNameChange(name: string) {
    setCustomerName(name);
    if (syncRecipientName) setRecipientName(name);
  }

  function handleSyncToggle(checked: boolean) {
    setSyncRecipientName(checked);
    if (checked) setRecipientName(customerName);
  }

  function resetForNextEntry() {
    setFormGeneration((g) => g + 1);
    setCustomerName("");
    setRecipientName("");
    setSyncRecipientName(true);
    setRecipientPhone("");
    setPhoneTouched(false);
    setAddressSeed(null);
    setCustomerAddressKey((k) => k + 1);
    setSelectedProductId(CUSTOM_PRODUCT_VALUE);
    setProductName("");
    setUnitPrice(0);
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
              <OrderCustomerPicker onCustomerChange={handleCustomerChange} onNameChange={handleCustomerNameChange} />
            </div>

            <div className="space-y-2 sm:col-span-2 border-t pt-4">
              <Label className="text-sm font-medium">배송 정보</Label>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="recipientName">
                  수령인 <span className="text-destructive">*</span>
                </Label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={syncRecipientName}
                    onCheckedChange={(checked) => handleSyncToggle(checked === true)}
                  />
                  고객명과 동일
                </label>
              </div>
              <Input
                id="recipientName"
                name="recipientName"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                readOnly={syncRecipientName}
                className={syncRecipientName ? "bg-muted text-muted-foreground" : undefined}
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
                  setPhoneTouched(true);
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
            {products.length > 0 ? (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="productSelect">상품</Label>
                <Select value={selectedProductId} onValueChange={handleProductSelect}>
                  <SelectTrigger id="productSelect" className="w-full">
                    <SelectValue placeholder="상품을 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CUSTOM_PRODUCT_VALUE}>직접 입력</SelectItem>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name} ({product.unit_price.toLocaleString("ko-KR")}원)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <input type="hidden" name="productId" value={isCustomProduct ? "" : selectedProductId} />
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="productName">
                상품명 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="productName"
                name="productName"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                readOnly={!isCustomProduct}
                className={!isCustomProduct ? "bg-muted text-muted-foreground" : undefined}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unitPrice">단가</Label>
              <Input
                id="unitPrice"
                name="unitPrice"
                type="number"
                min={0}
                value={unitPrice}
                onChange={(e) => setUnitPrice(Math.max(0, Number(e.target.value) || 0))}
                readOnly={!isCustomProduct}
                className={!isCustomProduct ? "bg-muted text-muted-foreground" : undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="optionName">옵션</Label>
              <Input id="optionName" name="optionName" placeholder="예: 대/2인분" />
            </div>
            <div className="space-y-2 sm:col-span-2">
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
