/**
 * LANDING REPOSITIONING v1(CPO 작업지시, 2026-09-04) — 고객 데이터 가치 섹션.
 *
 * 랜딩이 "주문 → 배송"만 강조하면 배송 관리 서비스로 읽힌다. 주문:한장의
 * 장기 전략에서 고객 데이터는 자산이므로 그 존재감을 별도 섹션으로 남긴다.
 *
 * 단, **지금 구현된 범위를 넘는 CRM 기능(마케팅 발송·세그먼트·자동화 등)은
 * 약속하지 않는다.** 현재 제품이 실제로 하는 것만 적는다 — 주문 등록 시 기존
 * 고객 확인, 동일인 후보 안내, 고객별 주문 이력, 병합/병합취소.
 */
const SEQUENCE = [
  { when: "첫 주문", what: "고객이 만들어집니다" },
  { when: "두 번째 주문", what: "같은 고객인지 확인해 연결합니다" },
  { when: "주문이 쌓이면", what: "그 고객의 주문 이력이 남습니다" },
];

export function CustomerDataSection() {
  return (
    <section className="border-y border-border bg-secondary/40 py-14 sm:py-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl leading-snug font-bold text-text-strong sm:text-4xl">
            주문이 쌓일수록
            <br />
            <span className="text-primary">고객 정보도 함께 쌓입니다.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            매번 새로운 고객 정보를 다시 찾지 않아도 됩니다.
            <br className="hidden sm:block" />
            주문과 고객 정보를 연결해 이전 주문을 함께 확인하세요.
          </p>
        </div>

        <ol className="mx-auto mt-12 max-w-xl space-y-2.5">
          {SEQUENCE.map((item, i) => (
            <li key={item.when} className="flex items-center gap-4 rounded-xl border border-border bg-surface px-5 py-4">
              <span className="w-24 shrink-0 text-sm font-bold text-primary sm:w-28 sm:text-base">{item.when}</span>
              <span className="text-sm text-text-strong sm:text-base">{item.what}</span>
              {i === 0 ? null : null}
            </li>
          ))}
        </ol>
        <p className="mt-8 text-center text-sm text-muted-foreground sm:text-base">
          주문을 처리할수록 우리 가게의 고객 정보가 함께 쌓입니다.
        </p>
      </div>
    </section>
  );
}
