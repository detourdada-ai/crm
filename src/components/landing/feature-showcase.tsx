"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ProductPreview, PreviewStat, PreviewRow, PreviewFlowRow } from "./product-preview";

const ORDER_ROWS = [
  { key: "a", primary: "김민수 · 상품 A", secondary: "신규 주문", badge: "신규", badgeTone: "primary" as const, detail: "서울시 강남구 ..." },
  { key: "b", primary: "박지현 · 상품 B", secondary: "배송 준비 중", badge: "처리중", badgeTone: "neutral" as const, detail: "서울시 마포구 ..." },
  { key: "c", primary: "이수진 · 상품 C", secondary: "배송 준비 완료", badge: "배송준비", badgeTone: "success" as const, detail: "경기도 성남시 ..." },
];

/** 주문 목록에서 하나를 선택하면 상세 팝업이 뜬다는 것 — Ordify의 대표적인 주문 처리 동작. */
function OrdersPreview() {
  const [selected, setSelected] = useState<string | null>("a");
  const active = ORDER_ROWS.find((row) => row.key === selected);

  return (
    <ProductPreview screen="주문관리" showPreviewLabel>
      <div className="relative">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-primary px-3 py-1.5 font-medium text-primary-foreground">전체</span>
          <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">신규</span>
          <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">처리중</span>
        </div>
        <div className="mt-4">
          {ORDER_ROWS.map((row) => (
            <button key={row.key} type="button" onClick={() => setSelected(row.key === selected ? null : row.key)} className="block w-full text-left">
              <PreviewRow primary={row.primary} secondary={row.secondary} badge={row.badge} badgeTone={row.badgeTone} />
            </button>
          ))}
        </div>

        {active ? (
          <div
            key={active.key}
            className="animate-in fade-in-0 slide-in-from-bottom-2 absolute right-0 bottom-0 w-48 rounded-xl border border-border bg-surface p-3 text-left shadow-lg duration-300 sm:right-2 sm:bottom-2"
          >
            <p className="text-xs font-semibold text-text-strong">주문 상세</p>
            <p className="mt-2 text-xs text-muted-foreground">{active.primary}</p>
            <p className="text-xs text-muted-foreground">{active.detail}</p>
            <Button size="sm" className="mt-2 h-7 w-full text-xs">
              배송 준비
            </Button>
          </div>
        ) : null}
      </div>
    </ProductPreview>
  );
}

const DRIVERS = ["홍길동", "김철수", "이영희"];

/** 주문을 기사에게 배정하는 동작이 Ordify 배송관리의 핵심 — 배정 UI를 직접 보여준다. */
function DeliveryPreview() {
  const [assignOpen, setAssignOpen] = useState(false);
  const [driver, setDriver] = useState("홍길동");

  return (
    <ProductPreview screen="배송관리" showPreviewLabel>
      <div className="grid grid-cols-3 gap-2 text-center">
        <PreviewStat label="배송 대기" value="8" />
        <PreviewStat label="배송중" value="5" />
        <PreviewStat label="완료" value="21" />
      </div>
      <div className="relative mt-4 rounded-xl border border-border bg-surface p-4">
        <p className="text-xs font-medium text-muted-foreground">김민수 주문</p>
        <p className="mt-1 text-sm text-text-strong">배송기사: {driver}</p>
        <Button size="sm" variant="outline" className="mt-3 h-8 w-full" onClick={() => setAssignOpen((v) => !v)}>
          배송 배정
        </Button>

        {assignOpen ? (
          <div className="animate-in fade-in-0 slide-in-from-top-1 absolute inset-x-4 top-full z-10 mt-1 rounded-xl border border-border bg-surface p-2 shadow-lg duration-200">
            {DRIVERS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setDriver(name);
                  setAssignOpen(false);
                }}
                className={cn(
                  "block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary",
                  name === driver ? "font-semibold text-primary" : "text-text-strong"
                )}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </ProductPreview>
  );
}

const CUSTOMERS = [
  { name: "김민수", orders: "8회", total: "324,000원", lastOrder: "2026.08.12" },
  { name: "박지현", orders: "3회", total: "112,000원", lastOrder: "2026.08.09" },
];

/** 고객이 단순 주소록이 아니라 "주문 이력과 연결된 사람"이라는 것을 보여준다. */
function CustomersPreview() {
  const [selected, setSelected] = useState(0);
  const customer = CUSTOMERS[selected];

  return (
    <ProductPreview screen="고객관리" showPreviewLabel>
      <div className="flex gap-2">
        {CUSTOMERS.map((c, i) => (
          <button
            key={c.name}
            type="button"
            onClick={() => setSelected(i)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium",
              i === selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}
          >
            {c.name}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm font-semibold text-text-strong">{customer.name}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <PreviewStat label="최근 주문" value={customer.orders} />
        <PreviewStat label="누적 구매" value={customer.total} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">최근 주문 · {customer.lastOrder}</p>
      <Button size="sm" variant="outline" className="mt-3 h-8 w-full">
        주문 이력 보기
      </Button>
    </ProductPreview>
  );
}

const SETTLEMENTS = [
  {
    key: "a",
    primary: "김기사 · 배송 42건",
    secondary: "이번 달 정산",
    steps: ["배송완료", "정산대상", "정산완료"],
    activeIndex: 2,
    amount: "₩1,260,000",
  },
  {
    key: "b",
    primary: "이기사 · 배송 31건",
    secondary: "이번 달 정산",
    steps: ["배송완료", "정산대상", "정산완료"],
    activeIndex: 1,
    amount: "₩930,000",
  },
];

/** 배송완료 → 정산대상 → 정산완료로 이어지는 흐름 자체를 보여준다. */
function SettlementPreview() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <ProductPreview screen="정산관리" showPreviewLabel>
      <div className="grid grid-cols-2 gap-3">
        <PreviewStat label="정산 대기" value="₩1,240,000" />
        <PreviewStat label="정산 완료" value="₩3,820,000" />
      </div>
      <div className="mt-4">
        {SETTLEMENTS.map((row) => (
          <div key={row.key}>
            <button type="button" onClick={() => setSelected(row.key === selected ? null : row.key)} className="block w-full text-left">
              <PreviewFlowRow primary={row.primary} secondary={row.secondary} steps={row.steps} activeIndex={row.activeIndex} />
            </button>
            {selected === row.key ? (
              <div className="animate-in fade-in-0 slide-in-from-top-1 mb-2 rounded-xl border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground duration-200">
                이번 달 정산 금액 · <span className="font-semibold text-text-strong">{row.amount}</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </ProductPreview>
  );
}

const FEATURES = [
  {
    eyebrow: "주문 관리",
    headline: "들어온 주문을 한곳에서",
    description: "받은 주문을 한곳에서 확인하고 처리하세요.",
    preview: OrdersPreview,
  },
  {
    eyebrow: "배송 관리",
    headline: "오늘 배송할 일을 한눈에",
    description: "누가 어디로 배송할지 한눈에 관리하세요.",
    preview: DeliveryPreview,
  },
  {
    eyebrow: "고객 관리",
    headline: "주문이 고객 기록으로 이어집니다",
    description: "고객별 주문 이력을 한눈에 확인하세요.",
    preview: CustomersPreview,
  },
  {
    eyebrow: "기사 정산",
    headline: "판매 금액을 쉽게 확인합니다",
    description: "복잡한 정산 금액도 쉽게 확인하세요.",
    preview: SettlementPreview,
  },
];

export function FeatureShowcase() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="text-center">
        <span className="text-xs font-semibold tracking-wide text-primary uppercase">제품 살펴보기</span>
        <h2 className="mt-2 text-2xl font-bold text-text-strong sm:text-3xl">실제 화면은 이렇게 동작합니다</h2>
      </div>
      <div className="mt-16 space-y-28">
        {FEATURES.map((feature, i) => (
          <div
            key={feature.headline}
            className={cn(
              "grid items-center gap-10 lg:gap-16",
              i % 2 === 0 ? "lg:grid-cols-[35fr_65fr]" : "lg:grid-cols-[65fr_35fr] lg:[&>*:first-child]:order-2"
            )}
          >
            <div className={cn(i % 2 === 0 ? "lg:text-left" : "lg:text-right")}>
              <span className="text-xs font-semibold tracking-wide text-primary uppercase">{feature.eyebrow}</span>
              <h3 className="mt-2 text-2xl font-bold text-text-strong sm:text-3xl">{feature.headline}</h3>
              <p className="mt-3 text-muted-foreground">{feature.description}</p>
            </div>
            <feature.preview />
          </div>
        ))}
      </div>
    </section>
  );
}
