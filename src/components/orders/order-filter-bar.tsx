"use client";

import { useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const BAG_ALL = "all";
const SORT_OPTIONS = [
  { value: "delivery_date:desc", label: "배송일 최신순" },
  { value: "delivery_date:asc", label: "배송일 오래된순" },
  { value: "order_date:desc", label: "주문일 최신순" },
  { value: "order_date:asc", label: "주문일 오래된순" },
  { value: "total_amount:desc", label: "금액 높은순" },
  { value: "total_amount:asc", label: "금액 낮은순" },
];

export function OrderFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value && value !== BAG_ALL) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  function updateParamDebounced(key: string, value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParam(key, value), 300);
  }

  const sortBy = searchParams.get("sort") ?? "delivery_date";
  const sortDir = searchParams.get("dir") ?? "desc";
  const sortValue = `${sortBy}:${sortDir}`;

  function handleSortChange(value: string) {
    const [field, dir] = value.split(":");
    const params = new URLSearchParams(searchParams);
    params.set("sort", field);
    params.set("dir", dir);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleReset() {
    router.push(pathname);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="deliveryFrom" className="text-xs text-muted-foreground">
          배송일 시작
        </Label>
        <Input
          id="deliveryFrom"
          type="date"
          className="w-40"
          defaultValue={searchParams.get("deliveryFrom") ?? ""}
          onChange={(e) => updateParam("deliveryFrom", e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="deliveryTo" className="text-xs text-muted-foreground">
          배송일 종료
        </Label>
        <Input
          id="deliveryTo"
          type="date"
          className="w-40"
          defaultValue={searchParams.get("deliveryTo") ?? ""}
          onChange={(e) => updateParam("deliveryTo", e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="status" className="text-xs text-muted-foreground">
          상태
        </Label>
        <Input
          id="status"
          className="w-32"
          placeholder="예: 배송중"
          defaultValue={searchParams.get("status") ?? ""}
          onChange={(e) => updateParamDebounced("status", e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">가방 회수</Label>
        <Select value={searchParams.get("bagReturned") ?? BAG_ALL} onValueChange={(v) => updateParam("bagReturned", v)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={BAG_ALL}>전체</SelectItem>
            <SelectItem value="false">미회수</SelectItem>
            <SelectItem value="true">회수완료</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">정렬</Label>
        <Select value={sortValue} onValueChange={handleSortChange}>
          <SelectTrigger className="w-40">
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
      <Button variant="ghost" size="sm" onClick={handleReset}>
        필터 초기화
      </Button>
    </div>
  );
}
