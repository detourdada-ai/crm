"use client";

import { useState, type ReactNode, type TouchEvent } from "react";
import { CheckCircle2, Navigation, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ProductPreview, PreviewStat, PreviewTable, type PreviewTableRow } from "./product-preview";

const ORDER_ROWS: PreviewTableRow[] = [
  { order: "20260814-0031", customer: "김민수", item: "상품 A 외 1건", deliveryDate: "08.14(금)", status: "신규", statusTone: "primary", highlighted: true },
  { order: "20260814-0030", customer: "박지현", item: "상품 B", deliveryDate: "08.14(금)", status: "배송준비", statusTone: "success" },
  { order: "20260813-0029", customer: "이수진", item: "상품 C 외 2건", deliveryDate: "08.15(토)", status: "처리중", statusTone: "neutral" },
];

/** 실제 화면 1 — 주문관리. */
function OrdersPreview() {
  return (
    <ProductPreview screen="주문관리" showPreviewLabel>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-primary px-3 py-1.5 font-medium text-primary-foreground">전체</span>
        <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">신규</span>
        <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">처리중</span>
      </div>
      <div className="mt-4">
        <PreviewTable rows={ORDER_ROWS} />
      </div>
    </ProductPreview>
  );
}

const DRIVERS = ["홍길동", "김철수", "이영희"];

/** 실제 화면 2 — 배송관리(고객/상품 요약 + 기사 배정 + 가방 상태). */
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
        <p className="text-xs font-medium text-muted-foreground">김민수 · 상품 A 외 1건</p>
        <p className="mt-2 text-sm text-text-strong">
          배송기사: <span className="font-semibold text-primary">{driver}</span>
        </p>
        <p className="mt-2 text-sm text-text-strong">
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
 * 실제 화면 3 — 기사 앱(현재/다음 배송 카드 + 배송완료 버튼 + 운행 시작/종료).
 * 실제 고객 개인정보는 절대 사용하지 않고, 다른 화면과 동일하게 가상값만 쓴다.
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
        <p className="text-xs font-semibold text-primary">현재 배송</p>
        <p className="mt-2 text-sm font-medium text-text-strong">김민수 · 상품 A 외 1건</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Navigation className="size-3" />
          서울시 강남구 ○○로 12
        </p>
        <Button size="sm" className="mt-3 h-8 w-full">
          배송완료
        </Button>
      </div>

      <div className="mt-2 rounded-xl border border-border bg-surface p-4">
        <p className="text-xs font-semibold text-muted-foreground">다음 배송</p>
        <p className="mt-2 text-sm font-medium text-text-strong">박지현 · 상품 B</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Navigation className="size-3" />
          서울시 강남구 ○○로 45
        </p>
      </div>
    </ProductPreview>
  );
}

interface WorkflowGroup {
  label: string;
  headline: string;
  description: string;
  eyebrow: string;
  screen: ReactNode;
}

/**
 * STEP12-4(CPO 작업지시, 2026-08-31) — 6개 STEP(주문/고객/배송/기사앱/배송현황/
 * 정산)을 각각 세로로 길게 나열하던 구조를 3개의 업무 흐름으로 압축한다.
 * 방문자가 처음 10초 안에 "주문이 들어오면 어떻게 처리되는지"를 이해하는 게
 * 목적이므로, 개별 기능 설명 대신 업무가 흘러가는 3단계(주문→배송→기사)만
 * 보여준다. 배송현황·정산은 별도 STEP으로 나열하지 않고 "기사는 바로
 * 배송한다" 흐름의 결과로 한 줄에 녹인다(CPO 지시 원문).
 */
const WORKFLOW_GROUPS: WorkflowGroup[] = [
  {
    label: "주문이 모인다",
    headline: "스마트스토어, 전화, 문자, 수동 주문 등",
    description: "여러 채널로 들어오는 주문과 고객 정보를 한곳에서 정리합니다.",
    eyebrow: "주문 접수 + 고객 관리",
    screen: <OrdersPreview />,
  },
  {
    label: "배송이 정리된다",
    headline: "오늘 배송할 주문을 한눈에 보고",
    description: "기사와 가방 상태를 한 화면에서 한 번에 관리합니다.",
    eyebrow: "배송 관리",
    screen: <DeliveryPreview />,
  },
  {
    label: "기사는 바로 배송한다",
    headline: "기사 앱에서 배송 확인 → 완료",
    description: "사장님은 진행 상황과 정산까지 이어서 확인합니다.",
    eyebrow: "기사 앱 + 배송 현황 + 정산",
    screen: <DriverAppPreview />,
  },
];

const SWIPE_THRESHOLD_PX = 40;

export function FeatureShowcase() {
  const [active, setActive] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const current = WORKFLOW_GROUPS[active];

  function handleTouchStart(e: TouchEvent<HTMLDivElement>) {
    setTouchStartX(e.touches[0].clientX);
  }

  function handleTouchEnd(e: TouchEvent<HTMLDivElement>) {
    if (touchStartX === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(delta) > SWIPE_THRESHOLD_PX) {
      if (delta < 0 && active < WORKFLOW_GROUPS.length - 1) setActive(active + 1);
      if (delta > 0 && active > 0) setActive(active - 1);
    }
    setTouchStartX(null);
  }

  return (
    <section id="features" className="bg-gradient-to-b from-background via-secondary/30 to-background py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="text-center">
          <span className="text-xs font-semibold tracking-wide text-primary uppercase">제품 살펴보기</span>
          <h2 className="mt-2 text-2xl font-bold text-text-strong sm:text-3xl">주문:한장은 이렇게 정리합니다</h2>
        </div>

        {/* 모바일: 상단 pill 탭(탭+스와이프 겸용) */}
        <div className="mt-8 flex justify-center gap-2 sm:hidden">
          {WORKFLOW_GROUPS.map((group, i) => (
            <button
              key={group.label}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                "rounded-full px-3.5 py-2 text-xs font-semibold transition-colors",
                i === active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}
            >
              {group.label}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-8 sm:mt-10 sm:grid-cols-[280px_1fr] sm:gap-10">
          {/* 데스크톱: 왼쪽 라벨 목록 */}
          <div className="hidden flex-col gap-3 sm:flex">
            {WORKFLOW_GROUPS.map((group, i) => (
              <button
                key={group.label}
                type="button"
                onClick={() => setActive(i)}
                className={cn(
                  "rounded-2xl border px-5 py-4 text-left transition-colors",
                  i === active
                    ? "border-primary/40 bg-primary-soft/60 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                    : "border-border bg-surface hover:bg-secondary/40"
                )}
              >
                <p className={cn("text-base font-bold", i === active ? "text-primary" : "text-text-strong")}>{group.label}</p>
                <p className="mt-1.5 text-xs text-muted-foreground">{group.headline}</p>
              </button>
            ))}
          </div>

          {/* 오른쪽(모바일은 전체 폭): 선택된 실제 화면 */}
          <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            <div className="text-center sm:text-left">
              <span className="text-xs font-semibold tracking-wide text-primary uppercase">{current.eyebrow}</span>
              <p className="mt-1 text-sm font-medium text-text-strong">{current.description}</p>
            </div>
            <div className="relative mt-4">
              <div aria-hidden className="absolute inset-6 -z-10 rounded-full bg-primary/10 blur-3xl" />
              {current.screen}
            </div>
            <div className="mt-4 flex justify-center gap-1.5 sm:hidden">
              {WORKFLOW_GROUPS.map((group, i) => (
                <span
                  key={group.label}
                  aria-hidden
                  className={cn("size-1.5 rounded-full transition-colors", i === active ? "bg-primary" : "bg-border-strong")}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mx-auto mt-16 max-w-2xl text-center">
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-primary">
            <CheckCircle2 className="size-4 shrink-0" />
            주문 접수부터 배송 완료, 정산까지 하나의 흐름으로 이어집니다.
          </div>
          <Button asChild size="lg" className="mt-6 gap-2">
            <a href="#recruit">베타 신청하고 먼저 써보기</a>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">우리 가게에도 맞을지 직접 이야기해보세요.</p>
        </div>
      </div>
    </section>
  );
}
