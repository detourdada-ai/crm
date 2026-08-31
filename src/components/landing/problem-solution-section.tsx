const PROBLEMS = [
  "주문이 전화, 문자, 쇼핑몰 등 여러 곳에서 들어옵니다",
  "주문과 고객 정보를 따로 정리해야 합니다",
  "배송할 주문을 다시 정리하고 기사에게 전달해야 합니다",
  "배송이 끝난 뒤 정산을 다시 계산해야 합니다",
];

/**
 * STEP12-4(CPO 작업지시, 2026-08-31) — "지금 vs 주문:한장" 비교와 해결
 * 캡슐을 한 섹션에 같이 담았던 이전 구조는 바로 다음 FeatureShowcase의
 * "주문:한장은 이렇게 정리합니다" 인트로와 내용이 겹쳤다. 이 섹션은 이제
 * "지금 이런 방식으로 운영하고 있나요?"라는 문제 공감 하나만 짧게 던지고,
 * 해결책 제시는 다음 섹션(FeatureShowcase)에 전담시킨다.
 */
export function ProblemSolutionSection() {
  return (
    <section id="service" className="border-y border-border bg-gradient-to-b from-secondary/50 to-primary-soft/25 py-16">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-text-strong sm:text-3xl">지금 이런 방식으로 운영하고 있나요?</h2>
        </div>

        <ul className="mx-auto mt-8 max-w-md space-y-2.5">
          {PROBLEMS.map((problem) => (
            <li key={problem} className="flex items-start gap-2.5 text-sm text-text-strong">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
              {problem}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
