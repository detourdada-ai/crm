import { ArrowRight } from "lucide-react";

const BEFORE_STEPS = ["주문 확인", "엑셀 정리", "기사별 목록 작성", "카톡 전달", "배송 확인", "완료 체크", "고객 문의 대응"];
const AFTER_STEPS = ["주문", "담당자 배정", "업무 진행", "완료"];

function StepColumn({ label, tone, steps }: { label: string; tone: "muted" | "primary"; steps: string[] }) {
  return (
    <div className="flex-1 rounded-2xl border border-border bg-surface p-6">
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

/** Section 11 — 기능표 대신 실제 업무 절차 자체를 나란히 보여준다. */
export function ComparisonSection() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6">
      <div className="text-center">
        <span className="text-xs font-semibold tracking-wide text-primary uppercase">지금과 비교하면</span>
        <h2 className="mt-2 text-2xl font-bold text-text-strong sm:text-3xl">한 화면에서 업무가 이어집니다.</h2>
      </div>

      <div className="mt-10 flex flex-col gap-6 sm:flex-row">
        <StepColumn label="지금" tone="muted" steps={BEFORE_STEPS} />
        <StepColumn label="주문:한장" tone="primary" steps={AFTER_STEPS} />
      </div>
    </section>
  );
}
