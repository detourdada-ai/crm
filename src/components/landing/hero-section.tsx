import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * LANDING v2(CPO 전략 보정, 2026-09-04) — v1 Hero는 "무엇을 하는 서비스인지"는
 * 전달했지만 "왜 지금 바꿔야 하는지"가 없었다. 메인 카피를 **비용 프레임**으로
 * 바꾼다: 주문이 늘어나는 건 좋은 일인데, 그때 같이 늘어나는 "관리하는 곳"이
 * 문제라는 점을 첫 문장에서 찌른다.
 *
 * 채널 표기는 자동 연동을 암시하지 않도록 "전화·메시지로 받은 주문까지"로
 * 쓴다(카카오톡 자동 연동은 없다 — FAQ에서도 명시).
 */
const FLOW_STEPS = ["주문", "고객", "배송", "기사"];

export function HeroSection() {
  return (
    <section id="product" className="relative overflow-hidden bg-gradient-to-b from-primary-soft/70 via-primary-soft/20 to-background">
      <div className="mx-auto max-w-4xl px-4 pt-14 pb-16 text-center sm:px-6 sm:pt-28 sm:pb-24">
        <p className="text-sm font-semibold text-primary sm:text-base">주문이 여러 곳에서 들어오는 사업자를 위한 운영 도구</p>

        <h1 className="mt-4 text-[2.5rem] leading-[1.15] font-bold tracking-tight text-text-strong sm:text-6xl md:text-7xl">
          주문이 늘어도,
          <br />
          <span className="text-primary">관리하는 곳까지</span>
          <br className="sm:hidden" />
          <span className="text-primary"> 늘릴 필요는 없습니다.</span>
        </h1>

        <p className="mx-auto mt-7 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          스마트스토어, 엑셀, 전화·메시지로 받은 주문까지.
          <br />
          어디서 받았든 한곳에 모아 고객과 연결하고 배송까지 이어서 처리하세요.
        </p>

        {/* 우리 제품의 핵심은 기능이 아니라 이 연결 구조 자체다. */}
        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2">
          {FLOW_STEPS.map((step, i) => (
            <span key={step} className="flex items-center gap-1.5">
              <span className="rounded-full border border-primary/25 bg-surface/80 px-4 py-1.5 text-sm font-semibold text-text-strong sm:px-5 sm:text-base">
                {step}
              </span>
              {i < FLOW_STEPS.length - 1 ? <ArrowRight className="size-4 shrink-0 text-primary/60" /> : null}
            </span>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="w-full gap-2 sm:w-auto">
            <Link href="/login">
              무료로 시작하기
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
            <a href="#flow">어떻게 달라지는지 보기</a>
          </Button>
        </div>

        <p className="mt-5 text-xs text-muted-foreground">Google 계정으로 시작합니다 · 현재 베타 기간 동안 무료로 사용하실 수 있습니다</p>
      </div>
    </section>
  );
}
