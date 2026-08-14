"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  ListChecks,
  ListOrdered,
  Phone,
  StickyNote,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

// 실제 확보된 고객 후기가 아직 없으므로 "후기"가 아니라 Ordify가 해결하려는
// 판매자의 실제 사용 상황/시나리오로 표현한다 — 이름/상호/사진/별점 없음.
// 향후 실제 고객 리뷰가 확보되면 동일한 슬라이더에 데이터만 교체해 넣는다.
const SCENARIOS = [
  {
    tag: "소규모 매장",
    title: "작은 매장도\n주문은 많으니까",
    body: "POS 없이 전화와 문자로 주문을 받다 보면 오늘 처리해야 할 주문을 놓치기 쉽습니다.",
    solution: "전화 주문도 한곳에서 확인하세요.",
    icon: Phone,
  },
  {
    tag: "전화 주문",
    title: "전화로 받은 주문,\n어디에 적어두셨나요?",
    body: "메모장, 종이, 카카오톡에 흩어진 주문을 한곳에서 관리할 수 있습니다.",
    solution: "받은 주문을 한곳에서 확인하세요.",
    icon: StickyNote,
  },
  {
    tag: "온라인 판매",
    title: "온라인 판매를 시작했는데\n일이 더 많아졌다면",
    body: "주문이 늘어날수록 확인하고 정리해야 할 일도 늘어납니다.",
    solution: "온라인 주문도 한곳에서 관리하세요.",
    icon: ListOrdered,
  },
  {
    tag: "엑셀 관리",
    title: "아직도 주문을\n엑셀로 정리하고 있다면",
    body: "주문을 정리하는 데 시간을 쓰기보다 들어온 주문을 바로 확인하고 처리하세요.",
    solution: "엑셀 대신 한 화면에서 확인하세요.",
    icon: FileSpreadsheet,
  },
  {
    tag: "배송 관리",
    title: "오늘 배송할 주문이\n몇 개인지 바로 알고 싶다면",
    body: "배송할 주문과 진행 상태를 한눈에 확인하고 오늘 해야 할 일을 먼저 처리하세요.",
    solution: "오늘 배송할 주문만 바로 확인하세요.",
    icon: Truck,
  },
  {
    tag: "고객 관리",
    title: "“지난번에\n뭐 주문하셨죠?”",
    body: "고객별 주문 이력을 확인하고 다시 찾아오는 고객의 주문을 쉽게 관리하세요.",
    solution: "고객별 주문 이력을 바로 확인하세요.",
    icon: Users,
  },
  {
    tag: "정산 관리",
    title: "주문은 늘었는데\n정산은 복잡하다면",
    body: "주문과 정산 내역을 함께 확인해 이번 달 판매 금액을 쉽게 파악하세요.",
    solution: "정산 금액을 자동으로 확인하세요.",
    icon: Wallet,
  },
  {
    tag: "1인 운영",
    title: "주문부터 배송까지\n혼자 하고 있다면",
    body: "오늘 해야 할 주문을 한곳에서 확인하고 하나씩 처리해보세요.",
    solution: "오늘 할 일을 한곳에서 처리하세요.",
    icon: ListChecks,
  },
];

function useItemsPerView() {
  const [items, setItems] = useState(1);
  useEffect(() => {
    const mqDesktop = window.matchMedia("(min-width: 1024px)");
    const mqTablet = window.matchMedia("(min-width: 640px)");
    const update = () => setItems(mqDesktop.matches ? 3 : mqTablet.matches ? 2 : 1);
    update();
    mqDesktop.addEventListener("change", update);
    mqTablet.addEventListener("change", update);
    return () => {
      mqDesktop.removeEventListener("change", update);
      mqTablet.removeEventListener("change", update);
    };
  }, []);
  return items;
}

export function SellerScenarios() {
  const itemsPerView = useItemsPerView();
  const maxStart = SCENARIOS.length - itemsPerView;
  const [rawIndex, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotionRef = useRef(false);
  const index = Math.min(rawIndex, maxStart);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (reducedMotionRef.current || paused) return;
    const timer = setInterval(() => {
      setIndex((i) => (Math.min(i, maxStart) >= maxStart ? 0 : Math.min(i, maxStart) + 1));
    }, 4000);
    return () => clearInterval(timer);
  }, [paused, maxStart]);

  const goTo = (i: number) => setIndex(Math.max(0, Math.min(i, maxStart)));
  const activeDot = index;

  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <div className="text-center">
        <span className="text-xs font-semibold tracking-wide text-primary uppercase">주문:한장이 필요한 순간</span>
        <h2 className="mt-2 text-2xl font-bold text-text-strong sm:text-3xl">이런 판매자를 위해 만들었습니다</h2>
        <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
          주문이 많아져서 복잡해진 것이 아니라,
          <br />
          주문을 관리하는 일이 너무 많아진 판매자를 위해 만들었습니다.
        </p>
      </div>

      <div
        className="relative mt-12"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={() => setPaused(true)}
        onTouchEnd={() => setPaused(false)}
      >
        <div className="overflow-hidden">
          <div
            className="flex transition-transform duration-500 ease-out"
            style={{ transform: `translateX(-${index * (100 / itemsPerView)}%)` }}
          >
            {SCENARIOS.map((scenario) => (
              <div key={scenario.tag} className="shrink-0 px-2" style={{ width: `${100 / itemsPerView}%` }}>
                <div className="flex h-full flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <span className="w-fit rounded-full bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary">{scenario.tag}</span>
                  <p className="whitespace-pre-line text-lg leading-snug font-bold text-text-strong">{scenario.title}</p>
                  <p className="text-sm text-muted-foreground">{scenario.body}</p>
                  <div className="mt-auto space-y-3">
                    <div className="flex items-center justify-center rounded-xl border border-border bg-secondary/50 py-6 text-muted-foreground/70">
                      <scenario.icon className="size-8" />
                    </div>
                    <p className="border-t border-border pt-3 text-sm">
                      <span className="font-semibold text-primary">주문:한장 · </span>
                      <span className="text-text-strong">{scenario.solution}</span>
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          aria-label="이전 카드"
          onClick={() => goTo(index - 1)}
          className="absolute top-1/2 left-0 hidden -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface p-2 shadow-md hover:bg-secondary lg:flex"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          aria-label="다음 카드"
          onClick={() => goTo(index + 1)}
          className="absolute top-1/2 right-0 hidden translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface p-2 shadow-md hover:bg-secondary lg:flex"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="mt-6 flex items-center justify-center gap-2">
        {SCENARIOS.map((scenario, i) => (
          <button
            key={scenario.tag}
            type="button"
            aria-label={`${i + 1}번째 카드로 이동`}
            onClick={() => goTo(i)}
            className={cn("size-2 rounded-full transition-colors", i === activeDot ? "bg-primary" : "bg-border-strong")}
          />
        ))}
      </div>
    </section>
  );
}
