"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CustomersScreen, DeliveryScreen, DriverPhone, OrdersScreen } from "./product-screens";
import { cn } from "@/lib/utils";

/**
 * LANDING v5(CEO 승인 개선, 2026-09-07) — Hero의 제품 화면을 1장에서
 * **4장 슬라이드**로 바꾼다.
 *
 * v3~v4 Hero는 주문관리 화면 하나만 보여줘서, 첫 화면만 본 사람에게는 "주문
 * 목록을 보여주는 도구"로 읽혔다. 실제로는 주문→고객→배송→기사까지 이어지는
 * 제품인데 그걸 알려면 스크롤을 해야 했다.
 *
 * 원칙: **마케팅용 이미지를 새로 만들지 않는다.** 아래 네 장은 전부 실제 제품
 * 화면을 그대로 재현한 기존 컴포넌트(product-screens.tsx)이고, 이름은 예외 없이
 * `성○이름`으로 마스킹돼 있다. 우리 제품의 가장 강한 신뢰 요소는 "실제로 이런
 * 프로그램이구나"이므로 없는 기능을 그려 넣지 않는다.
 *
 * v5.1(2026-09-07) — 두 가지를 고친다.
 *
 * ① **표시 프레임을 고정한다.** 네 화면은 실제 컴포넌트라 콘텐츠 높이가 서로
 *    다르고, 그대로 두면 슬라이드가 바뀔 때마다 컨테이너 높이가 출렁여
 *    아래 문단까지 밀린다(layout shift). 화면을 다시 디자인하는 대신 **모든
 *    슬라이드를 같은 높이의 프레임 안에 절대배치**하고, 넘치는 부분은 위쪽
 *    정렬로 잘라 "계속 이어지는 실제 화면"처럼 보이게 한다. 높이가 상수이므로
 *    전환 중 점프가 구조적으로 생기지 않는다.
 * ② **기사관리는 기사 화면만 보여주지 않는다.** 사장님 입장에서 필요한 건
 *    "기사에게 넘어간 뒤 어떻게 관리되는가"이므로, 뒤에 실제 배송관리 화면을
 *    두고 그 앞에 기사 휴대폰 화면을 겹친다(사장님이 순서를 정리 → 기사가
 *    자기 배송을 확인). 가짜 지도 그래픽은 만들지 않는다.
 *
 * 자동 전환은 하되 ① 탭을 누르면 자동 전환을 멈추고(사용자 의도 우선)
 * ② `prefers-reduced-motion`이면 처음부터 자동 전환하지 않는다.
 */

const SLIDES = [
  { key: "orders", tab: "주문관리", caption: "스마트스토어·엑셀·전화 주문을 한곳에", render: () => <OrdersScreen /> },
  { key: "customers", tab: "고객관리", caption: "같은 고객의 주문을 한눈에", render: () => <CustomersScreen /> },
  { key: "delivery", tab: "배송관리", caption: "오늘 배송할 주문만 모아서", render: () => <DeliveryScreen /> },
  {
    key: "driver",
    tab: "기사관리",
    caption: "사장님이 순서를 정리하면, 기사 화면에 그대로",
    render: () => (
      // 배경 = 사장님의 배송관리 화면, 전경 = 기사 휴대폰. 둘의 관계가 한 장에 보이게 한다.
      <div className="relative">
        <DeliveryScreen />
        <div className="absolute right-2 -bottom-1 sm:right-4 sm:bottom-2">
          <DriverPhone className="w-[150px] sm:w-[180px]" />
        </div>
      </div>
    ),
  },
] as const;

const INTERVAL_MS = 5000;

export function ProductShowcase() {
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    setAuto(false);
    if (timer.current) clearInterval(timer.current);
  }, []);

  useEffect(() => {
    if (!auto) return;
    // 모션을 줄이도록 설정한 사용자에게는 화면이 저절로 바뀌지 않게 한다.
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    timer.current = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), INTERVAL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [auto]);

  return (
    <div>
      {/* 고정 높이 프레임 — 어떤 슬라이드가 와도 이 박스 크기는 변하지 않는다. */}
      <div className="relative h-[380px] overflow-hidden sm:h-[460px] lg:h-[500px]">
        {SLIDES.map((slide, i) => (
          <div
            key={slide.key}
            aria-hidden={i !== index}
            className={cn(
              "absolute inset-x-0 top-0 transition-opacity duration-500",
              i === index ? "opacity-100" : "pointer-events-none opacity-0"
            )}
          >
            {slide.render()}
          </div>
        ))}
      </div>

      <div className="mt-5 lg:mr-24 xl:mr-32">
        <p className="text-center text-sm font-medium break-keep text-text-strong lg:text-left">{SLIDES[index].caption}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5 lg:justify-start">
          {SLIDES.map((slide, i) => (
            <button
              key={slide.key}
              type="button"
              onClick={() => {
                setIndex(i);
                stop();
              }}
              aria-current={i === index}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm",
                i === index ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-text-strong"
              )}
            >
              {slide.tab}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
