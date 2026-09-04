import { OrdersPreview, CustomersPreview, DeliveryPreview } from "./product-previews";

/**
 * LANDING REPOSITIONING v1(CPO 작업지시, 2026-09-04) — 실제 제품 화면 섹션.
 *
 * 예전에는 6개 화면이 탭 안에 작게 들어가 있어서 "실제로 돌아가는 제품"이라는
 * 느낌이 약했다. 이번에는 흐름의 핵심인 **주문관리 / 고객관리 / 배송관리**
 * 세 화면만 골라 크게, 세로로 펼친다(기사 앱·배송현황·정산은 뒤쪽 섹션에서
 * 문장으로만 다룬다 — 화면을 다 늘어놓으면 다시 기능 나열이 된다).
 *
 * 화면은 product-previews.tsx의 기존 컴포넌트를 그대로 쓴다 — 랜딩용으로
 * 과장된 새 화면을 만들지 않는다.
 */
const SCREENS = [
  {
    step: "주문",
    title: "어디서 들어온 주문이든 한곳으로",
    body: "스마트스토어 엑셀도, 전화로 받은 주문도 같은 목록에서 봅니다. 채널마다 다른 표를 만들 필요가 없습니다.",
    node: <OrdersPreview />,
  },
  {
    step: "고객",
    title: "주문이 반복될수록 고객은 더 정확해집니다",
    body: "같은 고객인지 매번 확인하지 않아도 됩니다. 이전 주문이 그대로 붙어 있어 바로 확인할 수 있습니다.",
    node: <CustomersPreview />,
  },
  {
    step: "배송",
    title: "오늘 처리할 배송만 바로 정리",
    body: "가까운 배송지는 묶여서 보이고, 기사 배정과 가방번호를 함께 입력한 뒤 한 번에 저장합니다.",
    node: <DeliveryPreview />,
  },
];

export function ProductScreensSection() {
  return (
    <section id="screens" className="border-y border-border bg-secondary/30 py-16 sm:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-[1.75rem] leading-snug font-bold text-text-strong sm:text-5xl">실제로 이렇게 씁니다</h2>
          <p className="mt-4 text-base text-muted-foreground sm:text-lg">지금 주문:한장에서 쓰고 있는 화면 그대로입니다.</p>
        </div>

        <div className="mt-14 space-y-12 sm:space-y-20">
          {SCREENS.map((screen) => (
            <div key={screen.title} className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
              <div className="md:order-1">
                <p className="text-sm font-semibold text-primary">{screen.step}</p>
                <h3 className="mt-2 text-xl leading-snug font-bold text-text-strong sm:text-2xl md:text-3xl">{screen.title}</h3>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">{screen.body}</p>
              </div>
              <div className="md:order-2">{screen.node}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
