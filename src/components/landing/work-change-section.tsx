import { ArrowDown } from "lucide-react";

/**
 * LANDING REPOSITIONING v1(CPO 작업지시, 2026-09-04) — 업무 변화 섹션.
 *
 * "기능이 무엇인지"가 아니라 "일이 어떻게 줄어드는지"를 보여준다. 기능 카드
 * 나열 대신 지금(BEFORE)의 단계와 도입 후(AFTER)의 단계를 나란히 놓아,
 * 단계 수 자체가 줄어드는 것이 눈에 보이게 한다.
 */
const BEFORE = ["주문 확인", "엑셀 정리", "고객 찾기", "배송 주문 정리", "기사에게 전달"];
const AFTER = ["주문이 들어오면", "고객과 연결되고", "배송할 주문이 정리되고", "기사 배정까지 이어집니다"];

function Column({
  label,
  tone,
  steps,
}: {
  label: string;
  tone: "muted" | "primary";
  steps: string[];
}) {
  const isPrimary = tone === "primary";
  return (
    <div
      className={
        isPrimary
          ? "rounded-2xl border-2 border-primary/30 bg-primary-soft/30 px-6 py-7 sm:px-8"
          : "rounded-2xl border border-border bg-surface px-6 py-7 sm:px-8"
      }
    >
      <p className={isPrimary ? "text-sm font-bold text-primary" : "text-sm font-bold text-muted-foreground"}>{label}</p>
      <ol className="mt-5 space-y-2">
        {steps.map((step, i) => (
          <li key={step}>
            <p
              className={
                isPrimary
                  ? "text-base font-semibold text-text-strong sm:text-lg"
                  : "text-base text-muted-foreground sm:text-lg"
              }
            >
              {step}
            </p>
            {i < steps.length - 1 ? <ArrowDown className={isPrimary ? "mt-1 size-4 text-primary/50" : "mt-1 size-4 text-muted-foreground/40"} /> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function WorkChangeSection() {
  return (
    <section className="bg-background py-14 sm:py-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl leading-snug font-bold text-text-strong sm:text-4xl">
            같은 주문인데,
            <br />
            해야 할 일이 줄어듭니다.
          </h2>
        </div>

        <div className="mt-12 grid gap-4 sm:gap-6 md:grid-cols-2">
          <Column label="지금" tone="muted" steps={BEFORE} />
          <Column label="주문:한장" tone="primary" steps={AFTER} />
        </div>
      </div>
    </section>
  );
}
