import { ShoppingCart, Truck, Users, Wallet, ArrowRight, ArrowDown } from "lucide-react";

const STEPS = [
  { icon: ShoppingCart, number: "01", label: "주문", description: "주문을 한 곳에서 모으고" },
  { icon: Truck, number: "02", label: "배송", description: "배송할 주문을 정리하고" },
  { icon: Users, number: "03", label: "고객", description: "구매 고객을 자동으로 관리하고" },
  { icon: Wallet, number: "04", label: "정산", description: "배송 완료 기준으로 정산까지" },
];

/** Ordify의 핵심 가치인 주문→배송→고객→정산 흐름을 Landing의 독립 섹션으로 크게 보여준다. */
export function FlowSection() {
  return (
    <section id="flow" className="border-y border-border bg-secondary/40 py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-center text-2xl font-bold text-text-strong sm:text-3xl">
          하나씩 처리하던 업무를,
          <br />
          하나의 흐름으로.
        </h2>

        <div className="mt-14 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:gap-3">
          {STEPS.map((step, i) => (
            <div key={step.number} className="flex flex-1 flex-col items-center gap-4 sm:flex-row">
              <div className="flex w-full flex-col items-center gap-3 rounded-2xl border border-border bg-surface px-6 py-8 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:min-h-[220px] sm:justify-center">
                <span className="text-sm font-bold tracking-wide text-primary">{step.number}</span>
                <div className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <step.icon className="size-7" />
                </div>
                <p className="text-xl font-bold text-text-strong">{step.label}</p>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </div>
              {i < STEPS.length - 1 ? (
                <>
                  <ArrowDown className="size-6 shrink-0 text-border-strong sm:hidden" />
                  <ArrowRight className="hidden size-6 shrink-0 text-border-strong sm:block" />
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
