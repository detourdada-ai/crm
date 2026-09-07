import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductShowcase } from "./product-showcase";

/**
 * LANDING v3 → v5(CEO 승인 개선, 2026-09-07) — Hero의 주인공은 카피가 아니라
 * **제품**이다. 데스크톱은 좌 카피 / 우 실제 앱 화면 2단이고, 화면은 오른쪽
 * 가장자리에서 살짝 잘리게 둔다 — 액자에 담긴 예시가 아니라 "계속 이어지는
 * 실제 화면"으로 보이게 하려는 의도다.
 *
 * v5에서 오른쪽을 **4장 슬라이드**로 바꿨다(주문/고객/배송/기사). 한 장만
 * 보여주면 첫 화면만 본 사람에게 "주문 목록 도구"로 읽힌다. 카피도 함께
 * 줄였다 — 설명이 길수록 "뭔가 많은 걸 하는 프로그램"처럼 보이는데, 그건
 * "복잡한 주문, 한 장으로"라는 방향과 반대다.
 */
export function HeroSection() {
  return (
    <section id="product" className="overflow-hidden border-b border-border bg-gradient-to-b from-primary-soft/40 to-background">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pt-12 pb-14 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-12 lg:pt-20 lg:pb-20">
        <div>
          <p className="text-sm font-semibold text-primary">여러 곳의 주문을 하나의 운영 흐름으로</p>
          <h1 className="mt-3 text-[2.25rem] leading-[1.12] font-bold tracking-tight break-keep text-text-strong sm:text-[2.75rem] xl:text-[3.25rem]">
            주문은 어디서 받든,
            <br />
            <span className="text-primary">운영은 한곳에서</span> 끝내세요.
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed break-keep text-muted-foreground sm:text-lg">
            받고 → 확인하고 → 보내고. 주문부터 배송까지 한 화면에서 끝납니다.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="w-full gap-2 sm:w-auto">
              <Link href="/login">
                무료로 시작하기
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <a href="#flow">어떻게 운영되는지 보기</a>
            </Button>
          </div>
          <p className="mt-4 text-xs break-keep text-muted-foreground">Google 계정으로 시작합니다 · 베타 기간 동안 무료</p>
        </div>

        <div className="lg:-mr-24 xl:-mr-32">
          <ProductShowcase />
        </div>
      </div>
    </section>
  );
}
