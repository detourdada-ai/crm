import { Check } from "lucide-react";

/**
 * LANDING REPOSITIONING v1(CPO 작업지시, 2026-09-04) — 타깃 고객 섹션.
 *
 * "모든 소상공인"으로 넓히지 않는다. 초기 타깃은 **여러 경로에서 주문을 받고,
 * 고객 정보를 관리하며, 자체 배송이나 배송 담당자를 운영하는 소규모 사업자**다.
 * 예전의 일반적인 운영 체크리스트를 이 정의에 맞춰 다시 썼고, 업종 배지는
 * 참고용으로만 남긴다(업종 나열이 주인공이 되면 다시 범용 SaaS처럼 보인다).
 */
const CRITERIA = [
  "자체 배송을 운영하는 사업자",
  "배송기사를 직접 관리하는 사업자",
  "주문이 여러 채널에서 들어오는 사업자",
  "엑셀과 메시지로 주문을 정리하는 사업자",
  "주문이 늘면서 관리가 복잡해진 사업자",
];

const INDUSTRY_EXAMPLES = ["반찬·도시락", "꽃·화환", "케이크·답례품", "식품", "자체배송 사업자"];

export function TargetAudience() {
  return (
    <section className="border-y border-border bg-secondary/40 py-14 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl leading-snug font-bold text-text-strong sm:text-4xl">
            이런 사업자에게 맞습니다
          </h2>
        </div>

        <ul className="mt-10 space-y-3">
          {CRITERIA.map((item) => (
            <li key={item} className="flex items-start gap-3 rounded-xl border border-border bg-surface px-5 py-4">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Check className="size-4" />
              </span>
              <span className="text-sm leading-relaxed font-medium text-text-strong sm:text-base">{item}</span>
            </li>
          ))}
        </ul>

        <div className="mt-10 text-center">
          <p className="text-xs text-muted-foreground">주로 이런 업종의 사장님들과 함께 검증하고 있습니다</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {INDUSTRY_EXAMPLES.map((example) => (
              <span key={example} className="rounded-full bg-primary-soft px-3.5 py-1.5 text-sm font-medium text-primary">
                {example}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
