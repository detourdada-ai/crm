"use client";

import { useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { searchCustomersForOrderAction } from "@/actions/customers";
import type { Customer } from "@/types/domain";

/**
 * F6/F10: "기존 고객 검색 → 선택" 또는 "신규 고객 등록" 중 하나를 사용자가
 * 명시적으로 고르게 한다 — 반복 주문마다 매번 신규 고객이 생기는 것을
 * 막는 장치이면서도, 이름/전화 일치로 뒤에서 자동 매칭·병합하지 않는다.
 */
export function OrderCustomerPicker({ onCustomerChange }: { onCustomerChange?: (customer: Customer | null) => void }) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSearch(value: string) {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    startTransition(async () => {
      const found = await searchCustomersForOrderAction(value);
      setResults(found);
    });
  }

  function selectCustomer(customer: Customer) {
    setSelected(customer);
    setResults([]);
    setQuery("");
    onCustomerChange?.(customer);
  }

  function clearSelection() {
    setSelected(null);
    onCustomerChange?.(null);
  }

  return (
    <div className="space-y-3 sm:col-span-2">
      <Tabs
        value={mode}
        onValueChange={(v) => {
          const next = v as "existing" | "new";
          setMode(next);
          clearSelection();
        }}
      >
        <TabsList>
          <TabsTrigger value="existing">기존 고객 검색</TabsTrigger>
          <TabsTrigger value="new">신규 고객 등록</TabsTrigger>
        </TabsList>

        <TabsContent value="existing" className="space-y-2 pt-2">
          {selected ? (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{selected.name}</span>
                {selected.phone ? <span className="ml-2 text-muted-foreground">{selected.phone}</span> : null}
                {selected.address ? (
                  <span className="block truncate text-xs text-muted-foreground">{selected.address}</span>
                ) : null}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={clearSelection} className="shrink-0 gap-1">
                <X className="size-3.5" />
                다시 선택
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="이름 또는 전화번호로 검색"
                  className="pl-8"
                />
              </div>
              {isPending ? <p className="text-xs text-muted-foreground">검색 중...</p> : null}
              {results.length > 0 ? (
                <div className="max-h-48 overflow-y-auto rounded-md border">
                  {results.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent/50"
                    >
                      <span className="flex w-full items-center justify-between">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-muted-foreground">{c.phone ?? "-"}</span>
                      </span>
                      {c.address ? <span className="truncate text-xs text-muted-foreground">{c.address}</span> : null}
                    </button>
                  ))}
                </div>
              ) : query.trim() && !isPending ? (
                <p className="text-xs text-muted-foreground">일치하는 고객이 없습니다. &ldquo;신규 고객 등록&rdquo;을 이용하세요.</p>
              ) : null}
            </>
          )}
          <input type="hidden" name="existingCustomerId" value={selected?.id ?? ""} />
        </TabsContent>

        <TabsContent value="new" className="grid gap-3 pt-2 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="newCustomerName">고객명</Label>
            <Input id="newCustomerName" name="newCustomerName" required={mode === "new"} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newCustomerPhone">연락처</Label>
            <Input id="newCustomerPhone" name="newCustomerPhone" placeholder="010-0000-0000" />
          </div>
        </TabsContent>
      </Tabs>
      <input type="hidden" name="customerMode" value={mode} />
    </div>
  );
}
