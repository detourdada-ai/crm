import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecruitForm } from "./recruit-form";

/**
 * LANDING REPOSITIONING v1(CPO 작업지시, 2026-09-04) — 마지막 CTA.
 *
 * 예전에는 마지막 행동이 "베타 신청 폼 작성" 하나뿐이었다. 실제로는 Google
 * 계정으로 바로 시작할 수 있으므로(auth/callback → /signup → 워크스페이스
 * 생성), **시작하기를 1순위**로 두고 상담 폼은 "먼저 물어보고 싶은 분"을 위한
 * 보조 경로로 내린다. 랜딩 전체에서 1순위 CTA 문구는 "무료로 시작하기"로
 * 통일한다.
 */
export function FinalCtaSection() {
  return (
    <section id="start" className="bg-gradient-to-b from-background to-primary-soft/40 py-14 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl leading-snug font-bold text-text-strong sm:text-4xl">
            흩어진 주문을
            <br />
            한곳에서 관리해보세요.
          </h2>
          <p className="mt-5 text-base text-muted-foreground sm:text-lg">
            Google 계정으로 시작하면 바로 주문을 등록할 수 있습니다.
          </p>
          <div className="mt-8 flex justify-center">
            <Button asChild size="lg" className="w-full gap-2 sm:w-auto">
              <Link href="/login">
                무료로 시작하기
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">현재 베타 기간 동안 무료로 사용하실 수 있습니다</p>
        </div>

        <div id="recruit" className="mt-16 border-t border-border pt-14">
          <div className="text-center">
            <h3 className="text-xl font-bold text-text-strong sm:text-2xl">먼저 물어보고 싶으신가요?</h3>
            <p className="mt-3 text-sm text-muted-foreground sm:text-base">
              지금 주문을 어떻게 받고 어떻게 배송하고 있는지 알려주시면,
              <br className="hidden sm:block" />
              운영 방식에 맞는지 함께 검토해드립니다.
            </p>
          </div>
          <div className="mt-8">
            <RecruitForm />
          </div>
        </div>
      </div>
    </section>
  );
}
