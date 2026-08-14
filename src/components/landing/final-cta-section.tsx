import { RecruitForm } from "./recruit-form";

/** Section 13+14 — Landing 후반부의 핵심 CTA. 서비스 판매가 아니라 실제 사업자의 이야기를 듣는 모집 폼. */
export function FinalCtaSection() {
  return (
    <section id="recruit" className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-text-strong sm:text-3xl">
          우리 사업에 맞는 서비스인지
          <br />
          먼저 이야기해보세요.
        </h2>
        <p className="mt-4 text-muted-foreground">
          서비스 판매보다 먼저,
          <br />
          실제 사장님들의 주문 이후 업무를 이해하고 있습니다.
        </p>
      </div>

      <div className="mt-10">
        <RecruitForm />
      </div>
    </section>
  );
}
