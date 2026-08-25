import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const BEFORE_STEPS = ["주문이 여러 곳에서 들어옴", "주문 내용을 따로 정리", "고객·주문 정보가 흩어짐", "배송할 주문을 다시 정리", "기사에게 전달할 정보를 다시 작성"];
const AFTER_STEPS = ["주문 접수", "고객/주문 정리", "배송 관리", "기사 배송", "배송 완료"];

function StepColumn({ label, tone, steps }: { label: string; tone: "muted" | "primary"; steps: string[] }) {
  return (
    <div
      className={cn(
        "flex-1 rounded-2xl border p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5",
        tone === "primary"
          ? "border-primary/30 bg-gradient-to-b from-primary-soft/60 to-surface hover:shadow-[0_16px_32px_-16px_rgba(5,150,105,0.35)]"
          : "border-border bg-surface hover:shadow-[0_12px_24px_-14px_rgba(15,23,42,0.12)]"
      )}
    >
      <p className={tone === "primary" ? "text-sm font-bold text-primary" : "text-sm font-semibold text-muted-foreground"}>
        {label}
      </p>
      <div className="mt-5 flex flex-col items-center gap-1.5">
        {steps.map((step, i) => (
          <div key={step} className="flex flex-col items-center gap-1.5">
            <span
              className={
                tone === "primary"
                  ? "rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  : "rounded-full bg-secondary px-4 py-2 text-sm text-muted-foreground"
              }
            >
              {step}
            </span>
            {i < steps.length - 1 ? <ArrowRight className="size-3.5 rotate-90 text-muted-foreground/40" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 랜딩 전면 개편(구조안 B): 기존에는 랜딩 후반부 "지금과 비교하면" 섹션이었으나,
 * 5초 안에 문제→해결을 이해시키는 것이 이번 개편의 핵심이라 Hero 바로 다음으로
 * 옮겼다 — 기능표 대신 실제 업무 절차 자체를 나란히 보여준다.
 */
export function ComparisonSection() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6">
      <div className="text-center">
        <span className="text-xs font-semibold tracking-wide text-primary uppercase">지금 vs 주문:한장</span>
        <h2 className="mt-2 text-2xl font-bold text-text-strong sm:text-3xl">흩어진 주문이, 하나의 흐름이 됩니다.</h2>
      </div>

      <div className="mt-10 flex flex-col gap-6 sm:flex-row">
        <StepColumn label="지금" tone="muted" steps={BEFORE_STEPS} />
        <StepColumn label="주문:한장" tone="primary" steps={AFTER_STEPS} />
      </div>
    </section>
  );
}
