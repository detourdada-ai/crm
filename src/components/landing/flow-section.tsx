import { ShoppingCart, Truck, Users, Wallet } from "lucide-react";

const STEPS = [
  {
    icon: ShoppingCart,
    number: "01",
    label: "주문",
    headline: "들어온 주문을 한곳에서",
    description: "전화, 온라인, 수동 주문을 하나의 목록에서 확인합니다.",
    bullets: ["주문 목록", "주문 상태", "주문 상세 Popup"],
  },
  {
    icon: Truck,
    number: "02",
    label: "배송",
    headline: "오늘 배송할 일을 한눈에",
    description: "배송할 주문과 진행 상태를 한곳에서 확인합니다.",
    bullets: ["배송 예정", "기사 배정", "배송중", "완료"],
  },
  {
    icon: Users,
    number: "03",
    label: "고객",
    headline: "주문이 고객 기록으로 이어집니다",
    description: "주문 이력이 고객 정보와 함께 쌓입니다.",
    bullets: ["고객 목록", "최근 주문", "주문 횟수", "고객 상세"],
  },
  {
    icon: Wallet,
    number: "04",
    label: "정산",
    headline: "판매 금액을 쉽게 확인합니다",
    description: "주문과 함께 매출과 정산 내역을 확인합니다.",
    bullets: ["정산 예정", "정산 완료", "이번 달 금액"],
  },
];

/** Ordify의 핵심 가치인 주문→배송→고객→정산 흐름을 Landing의 독립 섹션으로 크게 보여준다. */
export function FlowSection() {
  return (
    <section id="flow" className="border-y border-border bg-secondary/40 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-center text-2xl font-bold text-text-strong sm:text-3xl">
          주문부터 정산까지,
          <br />
          하나의 흐름으로.
        </h2>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <div
              key={step.number}
              className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary">
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
          ))}
        </div>
      </div>
    </section>
  );
}
