import { Check } from "lucide-react";

/**
 * LANDING v2(CPO 전략 보정, 2026-09-04) — 이 섹션의 역할은 "설명"이 아니라
 * **타깃 필터**다. 방문자가 자기 상황을 하나라도 체크하면 그 순간 "내 얘기네"가
 * 되고, 아니면 자연스럽게 걸러진다. v1의 추상적인 문제 나열("고객 정보는 주문마다
 * 다시 확인")을 실제 행동 단위로 다시 썼다.
 */
const CHECKS = [
  "주문이 여러 곳에서 들어온다",
  "주문을 엑셀로 다시 정리한다",
  "같은 고객인지 매번 확인한다",
  "배송할 주문을 따로 골라낸다",
  "기사에게 메시지로 다시 전달한다",
];

export function ProblemSolutionSection() {
  return (
    <section id="service" className="border-y border-border bg-secondary/40 py-14 sm:py-20">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl leading-snug font-bold text-text-strong sm:text-4xl">혹시 이렇게 운영하고 계신가요?</h2>
        </div>

        <ul className="mt-8 space-y-2.5">
          {CHECKS.map((item) => (
            <li key={item} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-5 py-3.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded border border-muted-foreground/30 text-muted-foreground">
                <Check className="size-3.5" />
              </span>
              <span className="text-sm font-medium text-text-strong sm:text-base">{item}</span>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-center text-base font-semibold text-text-strong sm:text-lg">
          하나라도 해당된다면, <span className="text-primary">주문:한장이 맞을 수 있습니다.</span>
        </p>
      </div>
    </section>
  );
}
