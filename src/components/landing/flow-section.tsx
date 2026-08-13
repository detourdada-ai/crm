import { ClipboardList, Truck, Users, Wallet, ArrowRight, ArrowDown } from "lucide-react";

const STEPS = [
  { icon: ClipboardList, title: "주문 등록", description: "엑셀로 한 번에, 또는 전화 주문은 직접 등록" },
  { icon: Truck, title: "배송 관리", description: "배송일별로 분류하고 기사에게 배정" },
  { icon: Users, title: "고객 관리", description: "반복 고객을 자동으로 연결하고 이력 관리" },
  { icon: Wallet, title: "기사 정산", description: "배송 완료 건수 기준으로 자동 집계" },
];

export function FlowSection() {
  return (
    <section id="flow" className="border-y border-border bg-secondary/40">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="text-2xl font-bold text-text-strong sm:text-3xl">복잡한 주문 업무를 하나의 흐름으로</h2>
          <p className="mt-3 text-muted-foreground">
            주문이 들어오면 배송하고, 고객을 관리하고, 정산까지 — Ordify 안에서 끊기지 않고 이어집니다.
          </p>
        </div>

        <div className="mt-12 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          {STEPS.map((step, i) => (
            <div key={step.title} className="flex flex-1 flex-col items-center gap-3 sm:flex-row">
              <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-border bg-surface p-5 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <div className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <step.icon className="size-5" />
                </div>
                <p className="text-sm font-semibold text-text-strong">
                  {String(i + 1).padStart(2, "0")}. {step.title}
                </p>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
              {i < STEPS.length - 1 ? (
                <>
                  <ArrowDown className="size-5 shrink-0 text-border-strong sm:hidden" />
                  <ArrowRight className="hidden size-5 shrink-0 text-border-strong sm:block" />
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
