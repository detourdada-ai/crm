import { ArrowDown } from "lucide-react";

/**
 * LANDING v3 — 업무 변화. v2는 좌우 카드 두 개를 같은 형태로 놓아 "얌전한
 * 비교표"가 됐다. v3는 **정보 구조 자체를 다르게** 만든다 — 왼쪽은 단계가
 * 흩어져 있고(들쭉날쭉한 정렬, 끊긴 연결), 오른쪽은 하나의 선으로 이어진다.
 */
const BEFORE = [
  { step: "주문 확인", offset: "ml-0" },
  { step: "엑셀 정리", offset: "ml-6" },
  { step: "고객 다시 확인", offset: "ml-2" },
  { step: "배송 따로 정리", offset: "ml-10" },
  { step: "기사에게 따로 전달", offset: "ml-4" },
  { step: "변경사항 다시 확인", offset: "ml-8" },
];

const AFTER = ["주문 접수", "고객과 연결", "배송 단위로 정리", "기사에게 전달"];

export function WorkChangeSection() {
  return (
    <section className="bg-background py-14 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <h2 className="max-w-2xl text-[1.75rem] leading-snug font-bold text-text-strong sm:text-[2.75rem]">
          같은 주문을 처리하는 데
          <br />
          <span className="text-primary">해야 할 일이 줄어듭니다.</span>
        </h2>

        <div className="mt-12 grid gap-10 md:grid-cols-2 md:gap-16">
          <div>
            <p className="text-sm font-bold text-muted-foreground">지금</p>
            <ul className="mt-5 space-y-2.5">
              {BEFORE.map((item) => (
                <li key={item.step} className={`${item.offset} text-sm text-muted-foreground sm:text-base`}>
                  {item.step}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-xs text-muted-foreground">단계마다 다른 도구를 열어야 합니다.</p>
          </div>

          <div className="relative">
            <p className="text-sm font-bold text-primary">주문:한장</p>
            <div className="mt-5 border-l-2 border-primary/40 pl-5">
              {AFTER.map((step, i) => (
                <div key={step} className={i > 0 ? "mt-5" : undefined}>
                  <p className="text-lg font-bold text-text-strong sm:text-xl">{step}</p>
                  {i < AFTER.length - 1 ? <ArrowDown className="mt-1.5 size-4 text-primary/50" /> : null}
                </div>
              ))}
            </div>
            <p className="mt-6 text-xs text-muted-foreground">한 화면에서 다음 단계로 이어집니다.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
