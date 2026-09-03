"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { extraDisplayEntries } from "@/lib/constants/order-extra";
import { cn } from "@/lib/utils";

/**
 * STEP12-16A: "더보기 (28)" 같은 원본 컬럼 개수 노출은 사장님에게 의미가
 *없어 제거한다 — 대신 상품이 여러 개인 주문(productName 전달)에서는 이
 * 섹션이 어느 상품의 원본 데이터인지 라벨로 구분해, 반복 렌더링이 중복처럼
 * 보이지 않게 한다.
 */
export function OrderItemRawData({ extra, productName }: { extra: Record<string, unknown>; productName?: string }) {
  const [open, setOpen] = useState(false);
  const entries = extraDisplayEntries(extra);

  if (entries.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {productName ? <p className="mb-1 text-xs font-medium text-muted-foreground">{productName}</p> : null}
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          {open ? "추가 원본 데이터 닫기" : "추가 원본 데이터 보기"}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 rounded-md bg-muted/40 p-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {entries.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="text-right font-medium break-all">{String(value)}</dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}
