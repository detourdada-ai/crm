import { ArrowDown } from "lucide-react";

/**
 * LANDING v2(CPO 전략 보정, 2026-09-04) — 랜딩의 **전환 핵심 섹션**.
 *
 * v1에서는 Before/After가 중간의 부가 섹션이었다. 하지만 사장님이 바꿔야 할 이유는
 * "기능이 있다"가 아니라 "지금 방식의 비용"이므로, 업무 흐름 비교를 가장 크게
 * 세운다. 오른쪽(주문:한장)에는 각 단계에서 실제로 무슨 일이 일어나는지
 * (동일인 후보, 배송그룹, 기사 배정)를 캡션으로 붙여 ①~④ 흐름을 흡수했다 —
 * 별도 설명 섹션을 하나 더 두면 다시 "설명형 랜딩"이 된다.
 */
const BEFORE = ["스마트스토어 확인", "전화·메시지 메모 확인", "엑셀 정리", "고객 찾기", "주소 확인", "배송 정리", "기사에게 전달"];

const AFTER = [
  { step: "주문", caption: "엑셀 업로드 · 전화 주문 직접 등록" },
  { step: "고객", caption: "기존 고객 확인 · 같아 보이면 동일인 후보로 안내" },
  { step: "배송", caption: "오늘 배송건 정리 · 가까운 배송지는 그룹으로" },
  { step: "기사", caption: "기사 배정 · 정해진 순서 그대로 전달" },
];

export function WorkChangeSection() {
  return (
    <section id="flow" className="bg-background py-16 sm:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-[1.75rem] leading-snug font-bold text-text-strong sm:text-5xl">
            주문을 정리하는 일이 아니라,
            <br />
            <span className="text-primary">주문이 다음 업무로 이어지게</span> 합니다.
          </h2>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2 md:gap-8">
          {/* 지금 — 단계가 많다는 것 자체가 메시지 */}
          <div className="rounded-2xl border border-border bg-secondary/40 px-6 py-7 sm:px-8">
            <p className="text-sm font-bold text-muted-foreground">지금</p>
            <p className="mt-1 text-xs text-muted-foreground">주문 1건마다 이만큼 확인합니다</p>
            <ol className="mt-6 space-y-1.5">
              {BEFORE.map((step, i) => (
                <li key={step}>
                  <p className="text-sm text-muted-foreground sm:text-base">{step}</p>
                  {i < BEFORE.length - 1 ? <ArrowDown className="mt-0.5 size-3.5 text-muted-foreground/40" /> : null}
                </li>
              ))}
            </ol>
          </div>

          {/* 주문:한장 — 단계가 줄고, 각 단계가 다음으로 이어진다 */}
          <div className="rounded-2xl border-2 border-primary/35 bg-primary-soft/30 px-6 py-7 sm:px-8">
            <p className="text-sm font-bold text-primary">주문:한장</p>
            <p className="mt-1 text-xs text-muted-foreground">한 번 들어온 주문이 그대로 이어집니다</p>
            <ol className="mt-6 space-y-3">
              {AFTER.map((item, i) => (
                <li key={item.step}>
                  <p className="text-lg font-bold text-text-strong sm:text-xl">{item.step}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">{item.caption}</p>
                  {i < AFTER.length - 1 ? <ArrowDown className="mt-2 size-4 text-primary/60" /> : null}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
