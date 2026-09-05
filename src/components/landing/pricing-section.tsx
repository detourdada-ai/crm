import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * LANDING v4(CPO 작업지시, 2026-09-05) — 요금제 섹션.
 *
 * "무료인가? 나중에 유료인가?"라는 SaaS 기본 질문에 답하되, **확정되지 않은
 * 가격 정책을 만들어내지 않는다.** Basic/Pro/Business 카드, 월·연 결제 토글,
 * 기능 제한표, 할인율, 정식 출시일은 전부 만들지 않는다 — 지금 사실은
 * "베타 운영 중이고 요금제는 준비 중"이며, 그 이상은 거짓말이 된다.
 */
export function PricingSection() {
  return (
    <section id="pricing" className="bg-background py-14 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 className="text-center text-[1.75rem] leading-snug font-bold text-text-strong sm:text-4xl">
          지금은 베타로 먼저 사용해보세요.
        </h2>

        <div className="mt-10 rounded-2xl border-2 border-primary/35 bg-primary-soft/20 px-6 py-7 text-center sm:px-10 sm:py-9">
          <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold tracking-wide text-primary-foreground">BETA</span>
          <p className="mt-5 text-lg font-bold text-text-strong sm:text-xl">현재 베타 운영 중</p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
            주문을 받고, 고객과 연결하고, 배송까지 관리하는 실제 운영 환경을 초기 사용자와 함께 검증하고 있습니다. 베타 기간에는
            비용 없이 사용하실 수 있습니다.
          </p>
          <Button asChild size="lg" className="mt-7 w-full sm:w-auto">
            <Link href="/login">무료로 시작하기</Link>
          </Button>
        </div>

        <p className="mt-6 text-center text-sm leading-relaxed text-muted-foreground">
          정식 요금제는 실제 주문량과 운영 방식에 맞춰 준비 중입니다.
          <br className="hidden sm:block" />
          베타 사용자에게는 정식 서비스 전 정책을 별도로 안내합니다.
        </p>
      </div>
    </section>
  );
}
