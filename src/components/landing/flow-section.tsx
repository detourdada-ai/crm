import { ShoppingCart, Truck, Users, Wallet, ArrowRight } from "lucide-react";

const STEPS = [
  { icon: ShoppingCart, label: "주문" },
  { icon: Truck, label: "배송" },
  { icon: Users, label: "고객" },
  { icon: Wallet, label: "정산" },
];

/** 하나씩 처리하는 업무를 하나의 흐름으로 연결 — 텍스트보다 제품 화면이 주인공이어야 하므로 큰 카드 대신 짧은 한 줄 밴드로만 표현한다. */
export function FlowSection() {
  return (
    <div className="border-y border-border bg-secondary/40 py-8">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-4 px-4 sm:px-6">
        {STEPS.map((step, i) => (
          <div key={step.label} className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-text-strong">
              <div className="flex size-9 items-center justify-center rounded-full bg-primary-soft text-primary">
                <step.icon className="size-4" />
              </div>
              <span className="text-sm font-semibold">{step.label}</span>
            </div>
            {i < STEPS.length - 1 ? <ArrowRight className="size-4 text-border-strong" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
