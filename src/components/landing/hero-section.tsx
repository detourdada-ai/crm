import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * LANDING REPOSITIONING v1(CPO 작업지시, 2026-09-04) — Hero는 5초 안에
 * "누구를 위한 / 어떤 문제를 / 무엇을 할 수 있는" 서비스인지 전달한다.
 *
 * 예전 Hero는 브랜드 슬로건("복잡한 주문, 한 장으로.")만 크게 세우고 서비스의
 * 실체는 다음 섹션들에 미뤘다. 그 결과 첫 화면만 보면 배송 관리 서비스처럼
 * 보였다. 이번에는 슬로건을 유지하되 **주문 → 고객 → 배송 → 기사**라는 핵심
 * 연결 구조를 Hero에서 바로 보여준다.
 *
 * CTA는 실제 가입 구조에 맞춘다 — `/login`에서 Google로 시작하면 처음 오는
 * 계정은 `/signup`(워크스페이스 이름 입력)으로 이어지고 베타 접근이 부여된다
 * (auth/callback/route.ts, actions/signup.ts). 그래서 "무료로 시작하기"는
 * 과장이 아니라 실제로 지금 가능한 행동이다.
 */
const FLOW_STEPS = ["주문", "고객", "배송", "기사관리"];

export function HeroSection() {
  return (
    <section id="product" className="relative overflow-hidden bg-gradient-to-b from-primary-soft/70 via-primary-soft/20 to-background">
      <div className="mx-auto max-w-4xl px-4 pt-14 pb-16 text-center sm:px-6 sm:pt-28 sm:pb-24">
        <p className="text-sm font-semibold text-primary sm:text-base">여러 곳에서 들어오는 주문을 한곳에서</p>

        <h1 className="mt-4 text-[2.5rem] leading-[1.15] font-bold tracking-tight text-text-strong sm:text-6xl md:text-7xl">
          주문은 여러 곳에서
          <br />
          들어오는데,
          <br className="sm:hidden" />
          <span className="text-primary"> 관리는 한곳에서.</span>
        </h1>

        <p className="mx-auto mt-7 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          스마트스토어, 엑셀, 전화 주문까지.
          <br />
          흩어진 주문을 모으고 고객과 연결해 배송까지 관리하세요.
        </p>

        {/* 핵심 흐름 — 기능 나열이 아니라 "연결"을 보여준다. */}
        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2">
          {FLOW_STEPS.map((step, i) => (
            <span key={step} className="flex items-center gap-1.5">
              <span className="rounded-full border border-primary/25 bg-surface/80 px-3.5 py-1.5 text-sm font-semibold text-text-strong sm:px-4 sm:text-base">
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
            <a href="#flow">어떻게 관리되는지 보기</a>
          </Button>
        </div>

        <p className="mt-5 text-xs text-muted-foreground">
          Google 계정으로 시작합니다 · 현재 베타 기간 동안 무료로 사용하실 수 있습니다
        </p>
      </div>
    </section>
  );
}
