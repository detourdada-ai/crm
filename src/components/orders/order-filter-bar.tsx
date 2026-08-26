"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  QuickDateRange,
  ORDER_DATE_QUICK_OPTIONS,
  DELIVERY_DATE_QUICK_OPTIONS,
  type QuickDateFilterValue,
} from "@/components/common/quick-date-range";
import { DELIVERY_STATUS_OPTIONS } from "@/lib/constants/delivery-status";
import { ORDER_SOURCE_OPTIONS } from "@/lib/constants/order-source";
import { PAYMENT_STATUS_OPTIONS } from "@/lib/constants/payment";
import { kstTodayIso } from "@/lib/utils/kst-date";
import type { ProductSummaryEntry } from "@/lib/utils/product-summary";

const STATUS_ALL = "all";
const SOURCE_ALL = "all";
const PAYMENT_STATUS_ALL = "all";
/** Phase 2 §5(2026-08 CPO 작업지시): 결제상태가 null("확인 필요")인 주문만 따로 걸러볼 수 있게 하는 sentinel — 실제 PAYMENT_STATUS_OPTIONS 값과 겹치지 않는다. */
const PAYMENT_STATUS_UNKNOWN = "unknown";
const PRODUCT_ALL = "all";
const SORT_OPTIONS = [
  { value: "delivery_date:desc", label: "배송일 최신순" },
  { value: "delivery_date:asc", label: "배송일 오래된순" },
  { value: "order_date:desc", label: "주문일 최신순" },
  { value: "order_date:asc", label: "주문일 오래된순" },
  { value: "total_amount:desc", label: "금액 높은순" },
  { value: "total_amount:asc", label: "금액 낮은순" },
];

/**
 * Phase 4-B STEP3/STEP4: 주문일/배송일을 분리된 빠른 필터(오늘/이번주/이번달/
 * 기간선택)로 재구성하고, "필터 설정 → [조회] → 결과 갱신" 패턴으로 통일한다.
 * 배송일 기본값은 전체(필터 없음) — 엑셀 주문 중 배송일이 비어있는(옵션정보에
 * 날짜 패턴이 없는) 건도 기본 화면에서 조용히 사라지지 않도록 하는 것이 핵심.
 * 날짜 입력은 onChange마다 즉시 URL을 바꾸지 않고, [조회]를 눌러야 반영된다.
 */
export function OrderFilterBar({
  orderDateFilter,
  orderDateFrom,
  orderDateTo,
  deliveryDateFilter,
  deliveryDateFrom,
  deliveryDateTo,
  bagManagementEnabled = false,
  productOptions = [],
}: {
  orderDateFilter: QuickDateFilterValue;
  orderDateFrom: string;
  orderDateTo: string;
  deliveryDateFilter: QuickDateFilterValue;
  deliveryDateFrom: string;
  deliveryDateTo: string;
  /** Phase 10: 가방 관리 미사용 사업장에서는 "가방 미회수" 필터도 숨긴다. */
  bagManagementEnabled?: boolean;
  /** 주문관리 UX 정리: 상품 집계를 별도 박스가 아니라 이 필터 select로 흡수한다 — 현재 검색결과(페이지네이션 전 전체) 기준 상품 목록. */
  productOptions?: ProductSummaryEntry[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [orderFilter, setOrderFilter] = useState<QuickDateFilterValue>(orderDateFilter);
  const [orderFrom, setOrderFrom] = useState(orderDateFrom);
  const [orderTo, setOrderTo] = useState(orderDateTo);
  const [deliveryFilter, setDeliveryFilter] = useState<QuickDateFilterValue>(deliveryDateFilter);
  const [deliveryFrom, setDeliveryFrom] = useState(deliveryDateFrom);
  const [deliveryTo, setDeliveryTo] = useState(deliveryDateTo);
  const [status, setStatus] = useState(searchParams.get("deliveryStatus") ?? STATUS_ALL);
  const [source, setSource] = useState(searchParams.get("orderSource") ?? SOURCE_ALL);
  const [paymentStatus, setPaymentStatus] = useState(searchParams.get("paymentStatus") ?? PAYMENT_STATUS_ALL);
  const [product, setProduct] = useState(searchParams.get("product") ?? PRODUCT_ALL);
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [bagNotReturned, setBagNotReturned] = useState(searchParams.get("bagReturned") === "false");

  const sortBy = searchParams.get("sort") ?? "delivery_date";
  const sortDir = searchParams.get("dir") ?? "desc";
  const sortValue = `${sortBy}:${sortDir}`;

  function handleSortChange(value: string) {
    const [field, dir] = value.split(":");
    const params = new URLSearchParams(searchParams);
    params.set("sort", field);
    params.set("dir", dir);
    params.delete("page");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function buildParamsFromState(): URLSearchParams {
    const params = new URLSearchParams();
    params.set("orderDateFilter", orderFilter);
    if (orderFilter === "custom") {
      if (orderFrom) params.set("orderDateFrom", orderFrom);
      if (orderTo) params.set("orderDateTo", orderTo);
    }
    params.set("deliveryDateFilter", deliveryFilter);
    if (deliveryFilter === "custom") {
      if (deliveryFrom) params.set("deliveryDateFrom", deliveryFrom);
      if (deliveryTo) params.set("deliveryDateTo", deliveryTo);
    }
    if (status !== STATUS_ALL) params.set("deliveryStatus", status);
    if (source !== SOURCE_ALL) params.set("orderSource", source);
    if (paymentStatus !== PAYMENT_STATUS_ALL) params.set("paymentStatus", paymentStatus);
    if (product !== PRODUCT_ALL) params.set("product", product);
    if (query.trim()) params.set("q", query.trim());
    if (bagNotReturned) params.set("bagReturned", "false");
    if (searchParams.get("sort")) params.set("sort", searchParams.get("sort")!);
    if (searchParams.get("dir")) params.set("dir", searchParams.get("dir")!);
    return params;
  }

  function handleApply() {
    const params = buildParamsFromState();
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function handleReset() {
    const today = kstTodayIso();
    setOrderFilter("all");
    setOrderFrom("");
    setOrderTo("");
    setDeliveryFilter("today");
    setDeliveryFrom(today);
    setDeliveryTo(today);
    setStatus(STATUS_ALL);
    setSource(SOURCE_ALL);
    setPaymentStatus(PAYMENT_STATUS_ALL);
    setProduct(PRODUCT_ALL);
    setQuery("");
    setBagNotReturned(false);
    startTransition(() => router.push(pathname));
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start gap-6">
        <QuickDateRange
          label="배송일"
          options={DELIVERY_DATE_QUICK_OPTIONS}
          filter={deliveryFilter}
          onFilterChange={setDeliveryFilter}
          customFrom={deliveryFrom}
          customTo={deliveryTo}
          onCustomFromChange={setDeliveryFrom}
          onCustomToChange={setDeliveryTo}
        />
        <QuickDateRange
          label="주문일"
          options={ORDER_DATE_QUICK_OPTIONS}
          filter={orderFilter}
          onFilterChange={setOrderFilter}
          customFrom={orderFrom}
          customTo={orderTo}
          onCustomFromChange={setOrderFrom}
          onCustomToChange={setOrderTo}
        />
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">상태</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={STATUS_ALL}>전체</SelectItem>
              {DELIVERY_STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">주문 출처</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SOURCE_ALL}>전체</SelectItem>
              {ORDER_SOURCE_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">결제상태</Label>
          <Select value={paymentStatus} onValueChange={setPaymentStatus}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PAYMENT_STATUS_ALL}>전체</SelectItem>
              {PAYMENT_STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
              <SelectItem value={PAYMENT_STATUS_UNKNOWN}>확인 필요</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">상품명</Label>
          <div className="flex items-center gap-2">
            <Select value={product} onValueChange={setProduct}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PRODUCT_ALL}>전체</SelectItem>
                {productOptions.map((p) => (
                  <SelectItem key={p.productName} value={p.productName} className="max-w-64">
                    <span className="truncate">{p.productName}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {product !== PRODUCT_ALL ? (
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {productOptions.find((p) => p.productName === product)?.orderCount ?? 0}건
              </span>
            ) : null}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">검색</Label>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="고객명·전화번호·주문번호"
            className="w-44"
          />
        </div>
        {bagManagementEnabled ? (
          <label className="flex items-center gap-2 pt-6 pb-2 text-sm">
            <Checkbox checked={bagNotReturned} onCheckedChange={(checked) => setBagNotReturned(checked === true)} />
            가방 미회수
          </label>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={isPending} onClick={handleApply} className="gap-1.5">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            조회
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleReset}>
            초기화
          </Button>
        </div>
        <Select value={sortValue} onValueChange={handleSortChange}>
          <SelectTrigger className="w-40" aria-label="정렬">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
