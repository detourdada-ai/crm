import { ShoppingCart, UserCheck, ListChecks, CheckCircle2, ArrowRight } from "lucide-react";

const STEPS = [
  {
    icon: ShoppingCart,
    number: "01",
    label: "주문",
    headline: "주문을 한 곳에서 확인",
    description: "스마트스토어 / 전화 / 문자 등 다양한 주문을 최종적으로 표준 주문 데이터로 관리합니다.",
    bullets: ["주문 목록", "주문 상태", "주문 상세"],
  },
  {
    icon: UserCheck,
    number: "02",
    label: "담당자",
    headline: "담당자를 정한다",
    description: "직원이나 기사에게 주문을 배정합니다.",
    bullets: ["담당자 배정", "기사 배정", "재배정"],
  },
  {
    icon: ListChecks,
    number: "03",
    label: "처리",
    headline: "처리한다",
    description: "준비 → 작업중 → 배송중 등 실제 업무 상태를 관리합니다.",
    bullets: ["준비", "작업중", "배송중"],
  },
  {
    icon: CheckCircle2,
    number: "04",
    label: "완료",
    headline: "완료한다",
    description: "완료 여부를 기록하고 필요하면 고객에게 상태를 안내합니다.",
    bullets: ["완료 기록", "고객 안내"],
  },
];

/** Section 9 "서비스 설명" — 주문→담당자→처리→완료를 제품의 Core로 보여준다. */
export function FlowSection() {
  return (
    <section id="service" className="border-y border-border bg-gradient-to-b from-secondary/50 to-primary-soft/25 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-center text-xs font-semibold tracking-wide text-primary uppercase">주문이 들어오면</p>
        <h2 className="mt-2 text-center text-2xl font-bold text-text-strong sm:text-3xl">
          주문 → 담당자 → 처리 → 완료
        </h2>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <div key={step.number} className="relative flex flex-col gap-4">
              <div className="flex h-full flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_16px_32px_-16px_rgba(5,150,105,0.35)]">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_10px_-2px_rgba(5,150,105,0.4)]">
                    <step.icon className="size-5" />
                  </div>
                  <span className="text-xs font-bold tracking-wide text-primary">{step.number}</span>
                </div>
                <div>
                  <p className="text-lg font-bold text-text-strong">{step.headline}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
                </div>
                <ul className="mt-auto flex flex-wrap gap-1.5 pt-2">
                  {step.bullets.map((bullet) => (
                    <li
                      key={bullet}
                      className="rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-xs text-muted-foreground"
                    >
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
              {i < STEPS.length - 1 ? (
                <ArrowRight className="absolute top-1/2 -right-4 z-10 hidden size-6 -translate-y-1/2 rounded-full bg-background p-1 text-primary/60 lg:block" />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
