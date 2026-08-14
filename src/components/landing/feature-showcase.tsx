"use client";

import { useState } from "react";
import { Store, Phone, MessageCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ProductPreview, PreviewStat, PreviewFlowRow, PreviewTable, type PreviewTableRow } from "./product-preview";

const ORDER_ROWS: PreviewTableRow[] = [
  { order: "20260814-0031", customer: "김민수", item: "상품 A 외 1건", deliveryDate: "08.14(금)", status: "신규", statusTone: "primary", highlighted: true },
  { order: "20260814-0030", customer: "박지현", item: "상품 B", deliveryDate: "08.14(금)", status: "배송준비", statusTone: "success" },
  { order: "20260813-0029", customer: "이수진", item: "상품 C 외 2건", deliveryDate: "08.15(토)", status: "처리중", statusTone: "neutral" },
];

/** Section 4-A: 전체 화면 대신 주문번호/고객/상품/배송일/상태가 보이는 테이블 자체를 보여준다. */
function OrdersPreview() {
  return (
    <ProductPreview screen="주문관리" showPreviewLabel>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-primary px-3 py-1.5 font-medium text-primary-foreground">전체</span>
        <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">신규</span>
        <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">처리중</span>
      </div>
      <div className="mt-4">
        <PreviewTable rows={ORDER_ROWS} highlightColumns={["customer", "deliveryDate", "status"]} />
      </div>
    </ProductPreview>
  );
}

const DRIVERS = ["홍길동", "김철수", "이영희"];

/** 주문을 기사에게 배정하는 동작이 주문:한장 배송관리의 핵심 — 배정 UI를 직접 보여준다. */
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
      <div className="relative mt-4 rounded-xl border-2 border-primary/30 bg-primary-soft/30 p-4">
        <p className="text-xs font-medium text-muted-foreground">김민수 주문</p>
        <p className="mt-1 text-sm text-text-strong">
          배송기사: <span className="font-semibold text-primary">{driver}</span>
        </p>
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
        <div className="rounded-xl border-2 border-primary/30 bg-primary-soft/30 px-4 py-3.5">
          <p className="text-xs text-muted-foreground">최근 주문</p>
          <p className="mt-1 text-2xl font-bold text-primary">{customer.orders}</p>
        </div>
        <div className="rounded-xl border-2 border-primary/30 bg-primary-soft/30 px-4 py-3.5">
          <p className="text-xs text-muted-foreground">누적 구매</p>
          <p className="mt-1 text-2xl font-bold text-primary">{customer.total}</p>
        </div>
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

// Section 3/5: 각 화면마다 상황 → 문제 → (화면) → 강조 → 결과 순서로 붙인다.
// "화면"은 preview 컴포넌트, "강조"는 highlights(이미지 아래 캡션), "결과"는 result(한 문장).
const FEATURES = [
  {
    step: "STEP 2",
    situation: "주문을 한곳에서 확인합니다",
    problem: "스마트스토어, 전화, 카카오톡으로 들어온 주문을 각각 따로 확인해야 했습니다.",
    eyebrow: "주문관리",
    headline: "들어온 주문을 표로 한눈에",
    description: "어디서 들어온 주문이든 고객, 상품, 배송일, 상태를 표준 주문 데이터로 정리합니다.",
    highlights: ["고객명", "배송일", "상태"],
    result: "여러 곳에서 들어온 주문도 한 화면에서 확인할 수 있습니다.",
    preview: OrdersPreview,
  },
  {
    step: "STEP 3",
    situation: "오늘 배송할 일을 정리합니다",
    problem: "기사에게 어떤 주문을 배정했는지 따로 기록하고 카톡으로 전달해야 했습니다.",
    eyebrow: "배송관리",
    headline: "담당 기사를 바로 배정",
    description: "배송 대기부터 완료까지, 오늘 누가 어디를 배송하는지 한눈에 관리합니다.",
    highlights: ["담당 기사", "배송 상태"],
    result: "누가 어디를 배송하는지 한 화면에서 확인할 수 있습니다.",
    preview: DeliveryPreview,
  },
  {
    step: "STEP 4",
    situation: "고객 기록이 쌓입니다",
    problem: "누가 자주 주문하는 단골인지 기억이나 메모에 의존해야 했습니다.",
    eyebrow: "고객관리",
    headline: "주문할수록 쌓이는 고객 기록",
    description: "주문이 들어올 때마다 고객별 주문 횟수와 누적 금액이 자동으로 정리됩니다.",
    highlights: ["최근 주문 횟수", "누적 구매액"],
    result: "고객별 주문 이력을 따로 정리하지 않아도 됩니다.",
    preview: CustomersPreview,
  },
  {
    step: "STEP 5",
    situation: "판매와 정산을 확인합니다",
    problem: "기사별 배송 건수와 정산 금액을 따로 계산해야 했습니다.",
    eyebrow: "정산관리",
    headline: "배송 완료가 정산으로 연결",
    description: "배송완료 → 정산대상 → 정산완료로 이어지는 흐름을 그대로 관리합니다.",
    highlights: ["기사별 정산 금액", "정산 진행 단계"],
    result: "배송이 끝나면 정산까지 자동으로 이어집니다.",
    preview: SettlementPreview,
  },
];

const ORDER_CHANNELS = [
  { icon: Store, label: "스마트스토어" },
  { icon: Phone, label: "전화" },
  { icon: MessageCircle, label: "카카오톡" },
];

function HighlightCaption({ items }: { items: string[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      <span className="font-semibold text-primary">여기를 보세요 →</span>
      {items.map((item) => (
        <span key={item} className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden />
          {item}
        </span>
      ))}
    </div>
  );
}

export function FeatureShowcase() {
  return (
    <section id="features" className="bg-gradient-to-b from-background via-secondary/30 to-background py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center">
          <span className="text-xs font-semibold tracking-wide text-primary uppercase">제품 살펴보기</span>
          <h2 className="mt-2 text-2xl font-bold text-text-strong sm:text-3xl">주문을 받고 → 정리하고 → 배송하고 → 정산까지</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            설명을 읽지 않아도, 화면만 보면 사장님의 하루 업무가 그대로 보입니다.
          </p>
        </div>

        {/* STEP 1: 화면이 아니라 "문제 상황"을 먼저 보여준다 — 여러 채널에서 따로 들어오는 주문. */}
        <div className="mx-auto mt-14 max-w-2xl rounded-2xl border border-dashed border-border bg-surface/60 px-6 py-8 text-center">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">STEP 1</span>
          <p className="mt-2 text-lg font-bold text-text-strong">주문이 여러 곳에서 들어옵니다</p>
          <p className="mt-2 text-sm text-muted-foreground">
            스마트스토어, 전화, 카카오톡으로 들어온 주문을 각각 따로 확인해야 했습니다.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {ORDER_CHANNELS.map((channel, i) => (
              <div key={channel.label} className="flex items-center gap-3">
                <span className="flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-2 text-xs font-medium text-muted-foreground">
                  <channel.icon className="size-3.5" />
                  {channel.label}
                </span>
                {i < ORDER_CHANNELS.length - 1 ? <span className="text-muted-foreground/40">+</span> : null}
              </div>
            ))}
          </div>
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
                <span className="text-xs font-semibold tracking-wide text-muted-foreground">{feature.step}</span>
                <p className="mt-1 text-sm font-medium text-text-strong">{feature.situation}</p>
                <p className="mt-1 text-sm text-muted-foreground">{feature.problem}</p>
                <span className="mt-3 inline-block text-xs font-semibold tracking-wide text-primary uppercase">{feature.eyebrow}</span>
                <h3 className="mt-2 text-2xl font-bold text-text-strong sm:text-3xl">{feature.headline}</h3>
                <p className="mt-3 text-muted-foreground">{feature.description}</p>
                <div
                  className={cn(
                    "mt-5 flex items-start gap-2 rounded-lg bg-primary-soft px-3.5 py-2.5 text-sm font-medium text-primary",
                    i % 2 === 0 ? "lg:flex-row" : "lg:flex-row-reverse lg:text-right"
                  )}
                >
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  {feature.result}
                </div>
              </div>
              <div className="relative">
                <div aria-hidden className="absolute inset-8 -z-10 rounded-full bg-primary/10 blur-3xl" />
                <feature.preview />
                <HighlightCaption items={feature.highlights} />
              </div>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-16 flex max-w-3xl flex-wrap items-center justify-center gap-x-2 gap-y-3 text-xs font-medium text-muted-foreground">
          {["주문", "정리", "배송", "고객", "정산"].map((step, i, arr) => (
            <span key={step} className="flex items-center gap-2">
              <span className="rounded-full bg-primary-soft px-3 py-1.5 text-primary">{step}</span>
              {i < arr.length - 1 ? <ArrowRight className="size-3.5 text-muted-foreground/40" /> : null}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
