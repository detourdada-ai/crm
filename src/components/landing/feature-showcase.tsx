"use client";

import { useState, type ReactNode } from "react";
import { Navigation, CheckCircle2, Play } from "lucide-react";
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

/**
 * STEP10-6(2026-08-28 CPO 작업지시) — 기사 화면을 실제 Production UI(기사
 * 앱 — 현재/다음 배송 카드 + 배송완료 버튼 + 운행 시작/종료)를 기준으로
 * 재현한다. 실제 고객 개인정보는 절대 사용하지 않고, 다른 STEP들과 동일하게
 * 가상값만 쓴다("김민수"는 STEP1의 예시 주문과 같은 인물이라는 서사적
 * 연결을 위해 재사용 — 실제 데이터가 아니다).
 */
function DriverAppPreview() {
  const [running, setRunning] = useState(false);

  return (
    <ProductPreview screen="기사 앱" showPreviewLabel>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">오늘 배송 5건 · 남음 3건</p>
        <Button size="sm" variant={running ? "outline" : "default"} className="h-7 gap-1.5 text-xs" onClick={() => setRunning((v) => !v)}>
          <Play className="size-3" />
          {running ? "운행중" : "운행 시작"}
        </Button>
      </div>

      <div className="mt-3 rounded-xl border-2 border-primary/30 bg-primary-soft/30 p-4">
        <p className="text-xs font-semibold text-primary">
          <PointBadge n={1} />① 현재 배송
        </p>
        <p className="mt-2 text-sm font-medium text-text-strong">김민수 · 상품 A 외 1건</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Navigation className="size-3" />
          서울시 강남구 ○○로 12
        </p>
        <Button size="sm" className="mt-3 h-8 w-full">
          <PointBadge n={2} />
          배송완료
        </Button>
      </div>

      <div className="mt-2 rounded-xl border border-border bg-surface p-4">
        <p className="text-xs font-semibold text-muted-foreground">
          <PointBadge n={3} />② 다음 배송
        </p>
        <p className="mt-2 text-sm font-medium text-text-strong">박지현 · 상품 B</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Navigation className="size-3" />
          서울시 강남구 ○○로 45
        </p>
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

const DRIVER_LOCATIONS = [
  { name: "홍길동", status: "운행중", updated: "2분 전" },
  { name: "김철수", status: "운행중", updated: "5분 전" },
  { name: "이영희", status: "운행종료", updated: "32분 전" },
];

/**
 * STEP10-6(2026-08-28 CPO 작업지시) 신규 STEP5 — 실제 `/delivery/drivers`
 * 화면(60초 자동 갱신 + "운행중 · N분 전" 최신성 표시)을 기준으로 재현한다.
 * "실시간 관제/GPS 추적"이라는 표현은 절대 쓰지 않는다 — 실제로는 주기적
 * 갱신 + 마지막 갱신 시각 표시 구조이기 때문이다(§CPO 원칙, STEP10-5 조사
 * 결과 반영).
 */
function DeliveryStatusPreview() {
  return (
    <ProductPreview screen="배송 현황" showPreviewLabel>
      <div className="grid grid-cols-3 gap-2 text-center">
        <PreviewStat label="배송 대기" value="8" />
        <PreviewStat label="배송중" value="5" />
        <PreviewStat label="완료" value="21" />
      </div>
      <div className="mt-4 space-y-2">
        {DRIVER_LOCATIONS.map((d, i) => (
          <div key={d.name} className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3">
            <p className="text-sm font-medium text-text-strong">
              {i === 0 ? <PointBadge n={2} /> : null}
              {d.name}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {i === 0 ? <PointBadge n={3} /> : null}
              <span className={d.status === "운행중" ? "font-semibold text-primary" : ""}>{d.status}</span>
              <span>· {d.updated}</span>
            </p>
          </div>
        ))}
      </div>
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

/** STEP 6 실제 화면 — 배송완료/정산대상/정산완료 흐름과 정산 금액을 번호로 짚어준다. */
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
      <p className="mt-3 text-xs text-muted-foreground">
        <PointBadge n={5} />
        정산 완료 처리 시 정산일과 금액을 직접 확정하고, 기사별 일별 이력도 확인할 수 있습니다.
      </p>
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
  screenIntro: string;
  eyebrow: string;
  points: StepPoint[];
  result: string;
  screen: ReactNode;
}

// STEP10-6(2026-08-28 CPO 작업지시) — STEP10-5 조사에서 확인된 3중 반복
// (ComparisonSection/WhatOrdifyDoes/FeatureShowcase가 같은 "문제→해결"
// 흐름을 반복) 중 앞의 둘은 problem-solution-section.tsx로 통합했으므로,
// 여기서는 각 STEP의 "problem" 재진술과 도입부 채널 나열, 클로징 흐름
// 다이어그램을 전부 제거했다 — 문제 공감은 바로 위 섹션이 이미 전담했다.
// 대신 실제 화면과 "이 화면에서 무엇이 보이는지"에만 집중한다. STEP5
// (배송 현황·기사 위치)를 신규로 추가하고, STEP6(정산)에는 최근 추가된
// 지급 확정/기사별 이력을 반영했다.
const STEPS: StepData[] = [
  {
    step: "STEP 1",
    category: "주문 접수",
    headline: "흩어진 주문을 한곳에 모읍니다",
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
    category: "고객 관리",
    headline: "주문이 쌓이면 고객 기록도 쌓입니다",
    screenIntro: "실제 고객관리 화면입니다 — 주문할 때마다 고객 정보와 이력이 정리됩니다.",
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
    step: "STEP 3",
    category: "배송 관리",
    headline: "오늘 보낼 주문을 바로 확인합니다",
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
    step: "STEP 4",
    category: "기사 앱",
    headline: "정리된 배송정보를 기사님이 바로 확인합니다",
    screenIntro: "실제 기사 앱 화면입니다 — 배정된 배송을 모바일에서 순서대로 확인하고 처리합니다.",
    eyebrow: "기사 앱",
    points: [
      { n: 1, label: "현재 배송을 바로 확인" },
      { n: 2, label: "배송완료 처리" },
      { n: 3, label: "다음 배송 안내" },
    ],
    result: "사장님이 정리한 배송정보를 기사님이 다시 전달받지 않고 바로 확인합니다.",
    screen: <DriverAppPreview />,
  },
  {
    step: "STEP 5",
    category: "배송 현황 · 기사 위치",
    headline: "배송이 시작되면, 전체 진행 상황을 한눈에 확인하세요",
    screenIntro: "실제 배송 현황 화면입니다 — 배송 대기·배송중·완료 현황과 기사 위치를 확인합니다.",
    eyebrow: "배송 현황",
    points: [
      { n: 1, label: "배송 대기 · 배송중 · 완료 현황" },
      { n: 2, label: "운행 중인 기사 확인" },
      { n: 3, label: "기사 위치와 최근 업데이트 시간 확인" },
    ],
    result: "배송이 지금 어디까지 진행됐는지, 다시 전화하지 않아도 확인할 수 있습니다.",
    screen: <DeliveryStatusPreview />,
  },
  {
    step: "STEP 6",
    category: "정산 관리",
    headline: "배송이 끝나면 정산까지 이어집니다",
    screenIntro: "실제 정산관리 화면입니다 — 배송완료부터 정산대상, 지급 확정, 금액까지 이 화면에서 확인합니다.",
    eyebrow: "정산관리",
    points: [
      { n: 1, label: "배송 완료" },
      { n: 2, label: "정산 대상" },
      { n: 3, label: "정산 완료 여부" },
      { n: 4, label: "정산 금액" },
      { n: 5, label: "지급 확정 · 기사별 이력" },
    ],
    result: "정산 대상 확인부터 지급 확정과 이력 관리까지, 업무 흐름의 마지막을 완성합니다.",
    screen: <SettlementPreview />,
  },
];

/** STEP 1~6 전부 동일하게 재사용하는 블록 — 시각적 리듬이 다르면 "각각 다른 기능 소개"처럼 읽히기 때문에 레이아웃을 절대 바꾸지 않는다. */
function StepBlock({ data }: { data: StepData }) {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-surface px-6 py-8 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_32px_-16px_rgba(15,23,42,0.15)] sm:px-10 sm:py-10">
      <div className="text-center">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {data.step} · {data.category}
        </span>
        <h3 className="mt-2 text-xl font-bold text-text-strong sm:text-2xl">{data.headline}</h3>
      </div>

      <p className="mx-auto mt-4 max-w-md text-center text-sm font-medium text-text-strong">{data.screenIntro}</p>

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
          <h2 className="mt-2 text-2xl font-bold text-text-strong sm:text-3xl">주문 접수 → 고객 관리 → 배송 관리 → 기사 앱 → 배송 현황 → 정산</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            설명을 읽지 않아도, 화면만 보면 사장님의 하루 업무가 그대로 보입니다.
          </p>
        </div>

        <div className="mt-10 space-y-16">
          {STEPS.map((data) => (
            <StepBlock key={data.step} data={data} />
          ))}
        </div>

        <div className="mx-auto mt-16 max-w-2xl text-center">
          <Button asChild size="lg" className="gap-2">
            <a href="#recruit">베타 신청하고 먼저 써보기</a>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">우리 가게에도 맞을지 직접 이야기해보세요.</p>
        </div>
      </div>
    </section>
  );
}
