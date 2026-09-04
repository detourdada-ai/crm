/**
 * LANDING REPOSITIONING v1(CPO 작업지시, 2026-09-04) — 문제 섹션.
 *
 * 예전에는 문제를 4줄짜리 불릿으로만 던져서 "그래서 뭐가 문제인데?"가 남았다.
 * 이번에는 **업무가 여러 곳으로 흩어지는 구조 자체**를 보여주고, 마지막에
 * 핵심 메시지로 정리한다 — "주문이 늘어서 일이 많아지는 게 아니라, 주문을
 * 관리하는 곳이 늘어나서 복잡해진다".
 */
const SCATTERED = [
  { where: "주문", detail: "스마트스토어 · 엑셀 · 전화" },
  { where: "고객 정보", detail: "주문마다 다시 확인" },
  { where: "배송 목록", detail: "따로 정리한 표" },
  { where: "기사 전달", detail: "메시지로 다시 안내" },
];

export function ProblemSolutionSection() {
  return (
    <section id="service" className="border-y border-border bg-secondary/40 py-14 sm:py-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl leading-snug font-bold text-text-strong sm:text-4xl">
            주문이 늘어날수록
            <br />
            관리해야 할 곳도 늘어나고 있나요?
          </h2>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 sm:gap-4">
          {SCATTERED.map((item) => (
            <div key={item.where} className="rounded-xl border border-dashed border-border bg-surface/70 px-5 py-4 text-left">
              <p className="text-sm font-semibold text-text-strong sm:text-base">{item.where}</p>
              <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-12 max-w-2xl text-center text-lg leading-relaxed font-semibold text-text-strong sm:text-xl">
          주문이 늘어나서 일이 많아지는 것이 아니라,
          <br className="hidden sm:block" />
          주문을 <span className="text-primary">관리하는 곳이 늘어나서</span> 일이 복잡해지고 있습니다.
        </p>
      </div>
    </section>
  );
}
