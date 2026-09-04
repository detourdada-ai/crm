import { DriverAppPreview } from "./product-previews";

/**
 * LANDING REPOSITIONING v1(CPO 작업지시, 2026-09-04) — 배송 운영 섹션.
 *
 * 배송은 현재 제품의 강점이라 흐름 섹션(order-flow)과 화면 섹션에서 이미 크게
 * 다뤘다. 여기서는 "정리한 배송이 기사에게 그대로 이어진다"는 마지막 연결만
 * 짧게 못박는다 — 기사 앱 화면 1개 + 문장 3개. 배송현황/정산은 실제로 있는
 * 기능이지만 여기서 화면까지 늘어놓으면 다시 기능 나열이 되므로 문장으로만
 * 언급한다.
 */
const POINTS = [
  "기사에게는 오늘 배송만, 정해진 순서 그대로 보입니다.",
  "기사가 배송완료를 처리하면 사장님 화면에도 반영됩니다.",
  "기사별 운행 상태와 배송 완료 후 정산까지 이어서 관리합니다.",
];

export function DeliveryOperationSection() {
  return (
    <section className="bg-background py-14 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="grid items-center gap-10 md:grid-cols-2 md:gap-14">
          <div>
            <p className="text-sm font-semibold text-primary">④ 기사에게 전달</p>
            <h2 className="mt-3 text-2xl leading-snug font-bold text-text-strong sm:text-4xl">
              정리한 배송이
              <br />
              기사에게 그대로 갑니다.
            </h2>
            <ul className="mt-7 space-y-3">
              {POINTS.map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/50" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <div className="mx-auto w-full max-w-sm md:max-w-none">
            <DriverAppPreview />
          </div>
        </div>
      </div>
    </section>
  );
}
