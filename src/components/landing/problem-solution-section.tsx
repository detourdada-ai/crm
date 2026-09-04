import { ArrowDown } from "lucide-react";

/**
 * LANDING v3 — 문제 섹션은 카드 나열을 버리고 **시각화**로 간다. 채널이
 * 흩어져 들어오는 모습 자체가 메시지이므로, 체크리스트 5개를 세로로
 * 늘어놓지 않고 한 화면에서 "여러 입구 → 각각 따로 관리"가 보이게 한다.
 */
const CHANNELS = ["스마트스토어 주문", "전화 주문", "메시지 주문", "엑셀 주문"];

export function ProblemSolutionSection() {
  return (
    <section id="service" className="bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
          {CHANNELS.map((channel) => (
            <span
              key={channel}
              className="rounded-full border border-border bg-surface px-3.5 py-2 text-sm font-medium text-muted-foreground sm:px-5 sm:text-base"
            >
              {channel}
            </span>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-center gap-3 text-xs text-muted-foreground sm:text-sm">
          <ArrowDown className="size-4" />
          각각 따로 확인하고, 따로 정리하고, 따로 전달
          <ArrowDown className="size-4" />
        </div>

        <p className="mt-10 text-center text-[1.75rem] leading-snug font-bold text-text-strong sm:text-[2.75rem]">
          주문이 늘어난 게 아니라,
          <br />
          <span className="text-primary">관리할 곳이 늘어나고 있습니다.</span>
        </p>
      </div>
    </section>
  );
}
