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
const POINTS = [
  { title: "다시 찾지 않아도 됩니다", body: "주문을 등록하면 기존 고객인지 먼저 확인합니다." },
  { title: "같은 고객으로 보이면 알려줍니다", body: "이름·연락처가 비슷하면 동일인 후보로 안내하고, 확인 후 합치거나 되돌릴 수 있습니다." },
  { title: "이력이 남습니다", body: "고객별로 지난 주문을 그대로 확인할 수 있습니다." },
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

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {POINTS.map((point) => (
            <div key={point.title} className="rounded-2xl border border-border bg-surface px-6 py-6">
              <p className="text-base font-bold text-text-strong sm:text-lg">{point.title}</p>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{point.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
