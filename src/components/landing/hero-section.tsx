import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrdersScreen } from "./product-screens";

/**
 * LANDING v3(CPO 작업지시, 2026-09-05) — Hero의 주인공을 카피에서 **제품**으로
 * 옮긴다. v2 Hero는 칩·버튼 중심이라 브랜딩 페이지처럼 읽혔다.
 *
 * 데스크톱은 좌 카피 / 우 실제 앱 화면 2단이고, 화면은 오른쪽 가장자리에서
 * 살짝 잘리게 둔다 — 액자에 담긴 예시가 아니라 "계속 이어지는 실제 화면"으로
 * 보이게 하려는 의도다. 모바일에서는 축소판 대신 모바일 제품 뷰가 나온다.
 */
export function HeroSection() {
  return (
    <section id="product" className="overflow-hidden border-b border-border bg-gradient-to-b from-primary-soft/40 to-background">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pt-12 pb-14 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-12 lg:pt-20 lg:pb-20">
        <div>
          <p className="text-sm font-semibold text-primary">여러 곳의 주문을 하나의 운영 흐름으로</p>
          <h1 className="mt-3 text-[2.25rem] leading-[1.12] font-bold tracking-tight text-text-strong sm:text-[2.75rem] xl:text-[3.25rem]">
            주문은 어디서 받든,
            <br />
            <span className="text-primary">운영은 한곳에서</span> 끝내세요.
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
            스마트스토어 엑셀, 전화·메시지로 받은 주문까지 한곳에 모아 고객을 확인하고, 배송을 정리해 기사에게 그대로 전달합니다.
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
          <p className="mt-4 text-xs text-muted-foreground">Google 계정으로 시작합니다 · 베타 기간 동안 무료</p>
        </div>

        <div className="lg:-mr-24 xl:-mr-32">
          <OrdersScreen />
        </div>
      </div>
    </section>
  );
}
