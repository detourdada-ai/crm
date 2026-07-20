"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DELIVERY_STATUS_OPTIONS } from "@/lib/constants/delivery-status";

const STATUS_ALL = "all";
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

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value && value !== STATUS_ALL) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
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

  const bagNotReturned = searchParams.get("bagReturned") === "false";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="orderDateFrom" className="text-xs text-muted-foreground">
          주문일 시작
        </Label>
        <Input
          id="orderDateFrom"
          type="date"
          className="w-40"
          defaultValue={searchParams.get("orderDateFrom") ?? ""}
          onChange={(e) => updateParam("orderDateFrom", e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="orderDateTo" className="text-xs text-muted-foreground">
          주문일 종료
        </Label>
        <Input
          id="orderDateTo"
          type="date"
          className="w-40"
          defaultValue={searchParams.get("orderDateTo") ?? ""}
          onChange={(e) => updateParam("orderDateTo", e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="deliveryDate" className="text-xs text-muted-foreground">
          배송일
        </Label>
        <Input
          id="deliveryDate"
          type="date"
          className="w-40"
          defaultValue={searchParams.get("deliveryDate") ?? ""}
          onChange={(e) => updateParam("deliveryDate", e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">상태</Label>
        <Select
          value={searchParams.get("deliveryStatus") ?? STATUS_ALL}
          onValueChange={(v) => updateParam("deliveryStatus", v)}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STATUS_ALL}>전체</SelectItem>
            {DELIVERY_STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <Checkbox
          checked={bagNotReturned}
          onCheckedChange={(checked) => updateParam("bagReturned", checked === true ? "false" : "")}
        />
        가방 미회수
      </label>

      <div className="ml-auto flex items-end gap-3">
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
    </div>
  );
}
