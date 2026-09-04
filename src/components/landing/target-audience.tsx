/**
 * LANDING v3 — 타깃 필터. 카드 5개를 세로로 늘어놓던 구조를 한 문단 수준으로
 * 압축한다(§10 "타깃 체크는 짧고 강하게").
 */
const CRITERIA = ["자체 배송을 운영", "배송기사를 직접 관리", "주문이 여러 채널에서 유입", "엑셀·메시지로 주문 정리", "주문이 늘면서 관리가 복잡"];

export function TargetAudience() {
  return (
    <section className="border-y border-border bg-secondary/25 py-14 sm:py-20">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        <h2 className="text-xl leading-snug font-bold text-text-strong sm:text-3xl">이런 사업자에게 맞습니다</h2>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {CRITERIA.map((item) => (
            <span key={item} className="rounded-full border border-border bg-surface px-3.5 py-2 text-sm text-text-strong">
              {item}
            </span>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted-foreground">반찬·도시락, 꽃·화환, 케이크·답례품 등 자체 배송을 하는 사장님들과 함께 검증하고 있습니다.</p>
      </div>
    </section>
  );
}
