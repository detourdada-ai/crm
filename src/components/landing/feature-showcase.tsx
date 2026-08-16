"use client";

import { useState, type ReactNode } from "react";
import { Store, Phone, MessageCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ProductPreview, PreviewStat, PreviewFlowRow, PreviewTable, PointBadge, type PreviewTableRow } from "./product-preview";

const ORDER_ROWS: PreviewTableRow[] = [
  { order: "20260814-0031", customer: "김민수", item: "상품 A 외 1건", deliveryDate: "08.14(금)", status: "신규", statusTone: "primary", highlighted: true },
  { order: "20260814-0030", customer: "박지현", item: "상품 B", deliveryDate: "08.14(금)", status: "배송준비", statusTone: "success" },
  { order: "20260813-0029", customer: "이수진", item: "상품 C 외 2건", deliveryDate: "08.15(토)", status: "처리중", statusTone: "neutral" },
];

/** STEP 1 실제 화면 — 주문번호/고객/배송일/상태에 각각 번호 배지를 붙여 옆 포인트 목록과 1:1로 대응시킨다. */
function OrdersPreview() {
  return (
    <ProductPreview screen="주문관리" showPreviewLabel>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-primary px-3 py-1.5 font-medium text-primary-foreground">전체</span>
        <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">신규</span>
        <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">처리중</span>
      </div>
      <div className="mt-4">
        <PreviewTable
          rows={ORDER_ROWS}
          highlightColumns={[
            { column: "customer", number: 1 },
            { column: "deliveryDate", number: 1 },
            { column: "status", number: 2 },
          ]}
        />
      </div>
    </ProductPreview>
  );
}

const DRIVERS = ["홍길동", "김철수", "이영희"];

/** STEP 2 실제 화면 — 고객/상품 요약, 기사 배정, 가방 상태를 한 카드 안에서 번호로 짚어준다. */
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
        <p className="text-xs font-medium text-muted-foreground">
          <PointBadge n={1} />
          김민수 · 상품 A 외 1건
        </p>
        <p className="mt-2 text-sm text-text-strong">
          <PointBadge n={2} />
          배송기사: <span className="font-semibold text-primary">{driver}</span>
        </p>
        <p className="mt-2 text-sm text-text-strong">
          <PointBadge n={3} />
          가방: <span className="font-semibold text-primary">미회수</span>
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

/** STEP 3 실제 화면 — 고객 정보 / 최근 주문 / 구매 금액 / 주문 이력을 번호로 짚어준다. */
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
      <p className="mt-4 text-sm font-semibold text-text-strong">
        <PointBadge n={1} />
        {customer.name}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl border-2 border-primary/30 bg-primary-soft/30 px-4 py-3.5">
          <p className="text-xs text-muted-foreground">
            <PointBadge n={2} />
            최근 주문
          </p>
          <p className="mt-1 text-2xl font-bold text-primary">{customer.orders}</p>
        </div>
        <div className="rounded-xl border-2 border-primary/30 bg-primary-soft/30 px-4 py-3.5">
          <p className="text-xs text-muted-foreground">
            <PointBadge n={3} />
            누적 구매
          </p>
          <p className="mt-1 text-2xl font-bold text-primary">{customer.total}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">최근 주문 · {customer.lastOrder}</p>
      <Button size="sm" variant="outline" className="mt-3 h-8 w-full">
        <PointBadge n={4} />
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

/** STEP 4 실제 화면 — 배송완료/정산대상/정산완료 흐름과 정산 금액을 번호로 짚어준다. */
function SettlementPreview() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <ProductPreview screen="정산관리" showPreviewLabel>
      <p className="text-xs font-medium text-muted-foreground">
        <PointBadge n={4} />
        정산 금액
      </p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <PreviewStat label="정산 대기" value="₩1,240,000" />
        <PreviewStat label="정산 완료" value="₩3,820,000" />
      </div>
      <div className="mt-4">
        {SETTLEMENTS.map((row) => (
          <div key={row.key}>
            <button type="button" onClick={() => setSelected(row.key === selected ? null : row.key)} className="block w-full text-left">
              <div className="flex items-center gap-2 pt-2 text-[10px] text-muted-foreground">
                {row.steps.map((step, i) => (
                  <span key={step} className="flex items-center gap-0.5">
                    <PointBadge n={i + 1} />
                    {step}
                  </span>
                ))}
              </div>
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

interface StepPoint {
  n: number;
  label: string;
}

interface StepData {
  step: string;
  category: string;
  headline: string;
  problem: string[];
  screenIntro: string;
  eyebrow: string;
  points: StepPoint[];
  result: string;
  screen: ReactNode;
}

// Section 1~4: STEP 1~4는 반드시 동일한 리듬 — 상황/문제 → (왜 이 화면인지) → 실제 화면 →
// 핵심 포인트(번호) → 결과 한 문장. 카피는 "기능 설명"이 아니라 "사장님이 얻는 결과" 중심으로
// 쓴다. "자동으로 다 모아준다"는 표현은 쓰지 않는다 — 수동/엑셀로 들어온 주문도 "같은 방식으로
// 관리"할 뿐이다.
const STEPS: StepData[] = [
  {
    step: "STEP 1",
    category: "주문 정리",
    headline: "흩어진 주문을 한곳에 모읍니다",
    problem: ["전화, 카카오톡, 스마트스토어 등 여러 경로로 들어오는 주문을", "따로 확인하고 다시 정리해야 했습니다."],
    screenIntro: "실제 주문관리 화면입니다 — 어디서 들어온 주문이든 이 화면에서 한 번에 확인합니다.",
    eyebrow: "주문관리",
    points: [
      { n: 1, label: "주문번호 · 고객 · 배송일을 한눈에" },
      { n: 2, label: "주문 상태를 바로 확인" },
      { n: 3, label: "수동으로 들어온 주문도 같은 방식으로 관리" },
    ],
    result: "들어온 주문을 한곳에서 확인하고, 처리할 주문을 놓치지 않습니다.",
    screen: <OrdersPreview />,
  },
  {
    step: "STEP 2",
    category: "배송 관리",
    headline: "오늘 보낼 주문을 바로 확인합니다",
    problem: ["주문이 쌓이면 누가 무엇을 배송해야 하는지", "다시 확인하고 전달해야 했습니다."],
    screenIntro: "실제 배송관리 화면입니다 — 오늘 배송할 주문과 담당자를 이 화면에서 정리합니다.",
    eyebrow: "배송관리",
    points: [
      { n: 1, label: "고객 · 상품 요약" },
      { n: 2, label: "담당 기사 배정" },
      { n: 3, label: "가방 상태" },
    ],
    result: "오늘 배송할 주문과 담당 내용을 한 화면에서 확인합니다.",
    screen: <DeliveryPreview />,
  },
  {
    step: "STEP 3",
    category: "고객 관리",
    headline: "주문이 쌓이면 고객 기록도 쌓입니다",
    problem: ["기존 고객이 무엇을 주문했는지", "다시 찾아봐야 했습니다."],
    screenIntro: "실제 고객관리 화면입니다 — 주문할 때마다 고객 정보와 이력이 자동으로 정리됩니다.",
    eyebrow: "고객관리",
    points: [
      { n: 1, label: "고객 정보" },
      { n: 2, label: "최근 주문" },
      { n: 3, label: "구매 금액" },
      { n: 4, label: "주문 이력" },
    ],
    result: "주문할 때마다 고객 기록이 쌓여, 다음 주문을 더 쉽게 관리할 수 있습니다.",
    screen: <CustomersPreview />,
  },
  {
    step: "STEP 4",
    category: "정산",
    headline: "배송이 끝나면 정산까지 연결됩니다",
    problem: ["배송이 끝난 뒤 실제 완료된 주문과 금액을", "다시 맞춰봐야 했습니다."],
    screenIntro: "실제 정산관리 화면입니다 — 배송완료부터 정산대상, 금액까지 이 화면에서 확인합니다.",
    eyebrow: "정산관리",
    points: [
      { n: 1, label: "배송 완료" },
      { n: 2, label: "정산 대상" },
      { n: 3, label: "정산 완료 여부" },
      { n: 4, label: "정산 금액" },
    ],
    result: "배송 완료된 주문이 정산으로 이어져, 따로 다시 계산할 일을 줄입니다.",
    screen: <SettlementPreview />,
  },
];

const ORDER_CHANNELS = [
  { icon: Store, label: "스마트스토어" },
  { icon: Phone, label: "전화" },
  { icon: MessageCircle, label: "카카오톡" },
];

const FLOW_STEPS = ["주문", "정리", "배송", "고객", "정산"];

/** STEP 1~4 전부 동일하게 재사용하는 블록 — 시각적 리듬이 다르면 "각각 다른 기능 소개"처럼 읽히기 때문에 레이아웃을 절대 바꾸지 않는다. */
function StepBlock({ data }: { data: StepData }) {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-surface px-6 py-8 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_32px_-16px_rgba(15,23,42,0.15)] sm:px-10 sm:py-10">
      <div className="text-center">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {data.step} · {data.category}
        </span>
        <h3 className="mt-2 text-xl font-bold text-text-strong sm:text-2xl">{data.headline}</h3>
        <div className="mx-auto mt-3 max-w-md space-y-1 text-sm text-muted-foreground">
          {data.problem.map((line) => (
            <p key={line}>→ {line}</p>
          ))}
        </div>
      </div>

      <p className="mx-auto mt-6 max-w-md text-center text-sm font-medium text-text-strong">{data.screenIntro}</p>

      <div className="relative mt-4">
        <div aria-hidden className="absolute inset-6 -z-10 rounded-full bg-primary/10 blur-3xl" />
        {data.screen}
      </div>

      <div className="mt-6">
        <span className="text-xs font-semibold tracking-wide text-primary uppercase">{data.eyebrow} · 화면에서 보이는 것</span>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {data.points.map((point) => (
            <li key={point.n} className="flex items-start gap-2 text-sm text-text-strong">
              <PointBadge n={point.n} />
              {point.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 flex items-start gap-2 rounded-lg bg-primary-soft px-3.5 py-2.5 text-sm font-medium text-primary">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        {data.result}
      </div>
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

        {/* 누구를 위한 서비스인지 — 서비스 소개 흐름 시작 직전에 한 번 더 명확히 한다. */}
        <div className="mx-auto mt-10 max-w-2xl rounded-xl border border-dashed border-primary/30 bg-primary-soft/30 px-6 py-5 text-center">
          <p className="text-sm font-semibold text-text-strong">주문이 여러 곳에서 들어오는 사장님이라면</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            스마트스토어, 전화, 카카오톡 등 주문이 여러 경로로 들어오고
            <br className="hidden sm:block" />
            엑셀이나 메모로 따로 정리하고 있다면 주문:한장이 도움이 될 수 있습니다.
          </p>
        </div>

        {/* STEP 1의 "상황/문제"는 화면 없이 먼저 눈에 보이는 현실부터 짚는다. */}
        <div className="mx-auto mt-10 flex max-w-2xl flex-wrap items-center justify-center gap-3">
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

        <div className="mt-10 space-y-16">
          {STEPS.map((data) => (
            <StepBlock key={data.step} data={data} />
          ))}
        </div>

        {/* STEP 5: 새 기능이 아니라 앞의 4단계를 하나로 묶어주는 클로징. */}
        <div className="mx-auto mt-16 max-w-2xl rounded-2xl border border-primary/30 bg-gradient-to-b from-primary-soft/60 to-surface px-6 py-10 text-center sm:px-10">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">STEP 5 · 업무 흐름</span>
          <h3 className="mt-2 text-xl font-bold text-text-strong sm:text-2xl">주문부터 정산까지, 한 흐름으로 이어집니다</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            주문을 따로 기록하고, 배송을 다시 확인하고, 정산을 다시 계산하는 일을 줄입니다.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-3">
            {FLOW_STEPS.map((step, i) => (
              <span key={step} className="flex items-center gap-2">
                <span className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground">{step}</span>
                {i < FLOW_STEPS.length - 1 ? <ArrowRight className="size-3.5 text-primary/40" /> : null}
              </span>
            ))}
          </div>
          <div className="mx-auto mt-6 flex max-w-md items-start gap-2 rounded-lg bg-surface px-3.5 py-2.5 text-left text-sm font-medium text-primary shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            사장님은 주문을 관리하고, 주문:한장이 업무 흐름을 정리합니다.
          </div>
          <Button asChild size="lg" className="mt-6 gap-2">
            <a href="#recruit">사장님 모집에 참여하기</a>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">우리 가게에도 맞을지 직접 이야기해보세요.</p>
        </div>
      </div>
    </section>
  );
}
