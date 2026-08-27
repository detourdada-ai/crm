import { Check } from "lucide-react";

// STEP10-6(2026-08-28 CPO 작업지시) — 기존 TargetAudience(체크리스트 +
// 업종 배지)와 IndustryScenarios(업종 탭 6개 + 업종별 하루 flow)를 통합한다.
// 두 섹션 모두 반찬/도시락/꽃·화환/케이크/식품 같은 같은 업종 라벨을
// 반복하고 있었다(STEP10-5 조사에서 확인). 이번 개편의 핵심은 "업종
// 나열"이 아니라 "우리도 이런 상황인데?"라는 공감이므로, 업종 탭+흐름
// 인터랙션은 제거하고 운영 방식 중심 체크리스트를 앞에 배치, 업종은
// 참고용 예시 배지로 가볍게 아래에만 둔다.
const OPERATION_CRITERIA = [
  "주문이 여러 방식으로 들어온다",
  "전화나 메시지로 받은 주문도 직접 관리해야 한다",
  "주문과 배송을 따로 정리하고 있다",
  "여러 명의 배송기사를 관리한다",
  "배송 완료 이후 정산까지 관리해야 한다",
];

const INDUSTRY_EXAMPLES = ["반찬·도시락", "꽃·화환", "케이크·답례품", "식품", "자체배송 사업자"];

export function TargetAudience() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6">
      <div className="text-center">
        <span className="text-xs font-semibold tracking-wide text-primary uppercase">이런 사장님에게 적합합니다</span>
        <h2 className="mt-2 text-2xl font-bold text-text-strong sm:text-3xl">이런 운영을 하고 계신가요?</h2>
      </div>

      <ul className="mx-auto mt-10 grid max-w-2xl gap-3 rounded-2xl border border-border bg-secondary/30 p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:grid-cols-2 sm:p-8">
        {OPERATION_CRITERIA.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-sm text-text-strong">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Check className="size-3.5" />
            </span>
            {item}
          </li>
        ))}
      </ul>

      <div className="mt-8 text-center">
        <p className="text-xs text-muted-foreground">주로 이런 업종의 사장님들과 검증하고 있습니다</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {INDUSTRY_EXAMPLES.map((example) => (
            <span key={example} className="rounded-full bg-primary-soft px-4 py-1.5 text-sm font-medium text-primary">
              {example}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
