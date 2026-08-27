import { RecruitForm } from "./recruit-form";

/**
 * STEP10-6(2026-08-28 CPO 작업지시) — 마지막 CTA의 톤을 "지금 먼저 써보세요"
 * (제품 사용 유도)에서 "우리 운영 방식에도 사용할 수 있을까요?"(도입 상담
 * 유도)로 바꾼다. 방문자의 마지막 질문은 "이게 우리한테 맞을까?"이므로,
 * 헤드라인이 그 질문을 그대로 던지고 서브카피가 "함께 검토해드린다"는
 * 상담 프레임으로 답한다. 실제 진입 경로(RecruitForm 제출 → 담당자 확인
 * 후 연락)는 그대로 유지 — 새 폼을 만들지 않는다.
 */
export function FinalCtaSection() {
  return (
    <section id="recruit" className="bg-gradient-to-b from-background to-primary-soft/30 py-20">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-text-strong sm:text-3xl">우리 운영 방식에도 사용할 수 있을까요?</h2>
          <p className="mt-4 text-muted-foreground">
            현재 주문을 어떻게 받고, 어떻게 배송하고 있는지 알려주세요.
            <br />
            주문:한장이 지금 운영 방식에 맞는지 함께 검토해드립니다.
          </p>
        </div>

        <div className="mt-10">
          <RecruitForm />
        </div>
      </div>
    </section>
  );
}
