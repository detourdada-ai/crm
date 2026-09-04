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
    step: "①·② 주문과 고객",
    title: "들어온 주문을 한 화면에서 확인합니다",
    body: "주문 상태와 상품, 배송일을 한 줄로 봅니다. 주문이 등록되면 고객 정보도 함께 정리됩니다.",
    node: <OrdersPreview />,
  },
  {
    step: "② 고객",
    title: "주문이 쌓일수록 고객 정보도 쌓입니다",
    body: "같은 고객의 이전 주문을 다시 찾지 않아도 됩니다. 고객별 주문 이력이 그대로 남습니다.",
    node: <CustomersPreview />,
  },
  {
    step: "③ 배송",
    title: "오늘 보낼 배송을 정리하고 기사에게 넘깁니다",
    body: "가까운 배송지는 그룹으로 묶이고, 기사 배정과 가방번호를 함께 입력한 뒤 한 번에 저장합니다.",
    node: <DeliveryPreview />,
  },
];

export function ProductScreensSection() {
  return (
    <section id="screens" className="border-y border-border bg-secondary/30 py-14 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl leading-snug font-bold text-text-strong sm:text-4xl">실제 사용하는 화면입니다</h2>
          <p className="mt-4 text-base text-muted-foreground sm:text-lg">지금 주문:한장에서 그대로 쓰고 있는 화면을 그대로 보여드립니다.</p>
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
