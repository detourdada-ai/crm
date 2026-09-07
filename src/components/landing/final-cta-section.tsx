import { RecruitForm } from "./recruit-form";

/**
 * LANDING REPOSITIONING v1(CPO 작업지시, 2026-09-04) — 마지막 CTA.
 *
 * v5.1(CEO 지시, 2026-09-07) — **중복 CTA 하나를 없앤다.** 요금제 섹션의
 * "지금은 베타로 먼저 사용해보세요"와 여기의 "흩어진 주문을 한곳에서
 * 관리해보세요"가 같은 행동(무료로 시작하기)을 두 번 요구하고 있었다. 페이지의
 * 최종 행동은 하나여야 하므로 요금제 쪽을 남기고 이 블록을 제거했다.
 *
 * CTA 기능을 없앤 것이 아니다 — 상담 폼("먼저 물어보고 싶으신가요?")은 그대로
 * 두고, 헤더와 요금제 섹션의 "무료로 시작하기"가 시작 경로를 계속 담당한다.
 * `#start` 앵커도 유지한다(헤더/푸터 링크가 가리킨다).
 */
export function FinalCtaSection() {
  return (
    <section id="start" className="bg-gradient-to-b from-background to-primary-soft/40 py-14 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div id="recruit">
          <div className="text-center">
            <h3 className="text-xl font-bold break-keep text-text-strong sm:text-2xl">먼저 물어보고 싶으신가요?</h3>
            <p className="mt-3 text-sm break-keep text-muted-foreground sm:text-base">
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
