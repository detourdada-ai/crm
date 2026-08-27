import { ArrowRight, CheckCircle2 } from "lucide-react";

const PROBLEMS = [
  "주문이 전화, 문자, 쇼핑몰 등 여러 곳에서 들어옵니다",
  "주문과 고객 정보를 따로 정리해야 합니다",
  "배송할 주문을 다시 정리하고 기사에게 전달해야 합니다",
  "배송이 끝난 뒤 정산을 다시 계산해야 합니다",
];

/**
 * STEP10-6(2026-08-28 CPO 작업지시) — 기존 ComparisonSection(문제→해결
 * 5단계 비교)과 WhatOrdifyDoes(주문→고객→배송→기사→완료 5-pillar)를
 * 하나로 통합한다. 둘 다 같은 5단계 라벨을 다른 톤으로 반복해 방문자에게
 * "같은 그림을 두 번 보여준다"는 인상을 줬기 때문이다(STEP10-5 조사에서
 * 확인). 이 섹션의 역할은 "문제 → 해결"을 짧게 직관적으로 보여주는 것
 * 뿐이며, 5단계 업무 흐름을 다시 길게 나열하지 않는다 — 상세 기능/실제
 * 화면은 바로 다음 FeatureShowcase가 담당한다. 헤더 nav의 "서비스 소개"
 * (#service) 앵커도 이 섹션으로 옮겨온다(기존에는 WhatOrdifyDoes가 갖고
 * 있었음).
 */
export function ProblemSolutionSection() {
  return (
    <section id="service" className="border-y border-border bg-gradient-to-b from-secondary/50 to-primary-soft/25 py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="text-center">
          <span className="text-xs font-semibold tracking-wide text-primary uppercase">지금 vs 주문:한장</span>
          <h2 className="mt-2 text-2xl font-bold text-text-strong sm:text-3xl">흩어진 주문이, 하나의 흐름이 됩니다.</h2>
        </div>

        <div className="mt-10 rounded-2xl border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-8">
          <p className="text-sm font-semibold text-muted-foreground">지금은</p>
          <ul className="mt-4 space-y-2.5">
            {PROBLEMS.map((problem) => (
              <li key={problem} className="flex items-start gap-2.5 text-sm text-text-strong">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                {problem}
              </li>
            ))}
          </ul>

          <div className="my-6 flex items-center justify-center">
            <ArrowRight className="size-5 rotate-90 text-primary/40" />
          </div>

          <p className="text-sm font-semibold text-primary">주문:한장에서는</p>
          <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-primary-soft px-4 py-3.5 text-sm font-medium text-primary">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            주문 접수부터 배송 완료, 정산까지 하나의 흐름으로 관리합니다.
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">각 단계의 실제 화면은 아래에서 바로 확인할 수 있습니다.</p>
        </div>
      </div>
    </section>
  );
}
