import { RecruitForm } from "./recruit-form";

/**
 * §CPO 랜딩 전면 개편 STEP9+10 — Landing 후반부의 핵심 CTA(Beta CTA 블록).
 * 이전에는 "서비스 판매보다 먼저, 이야기를 듣습니다"처럼 제품 완성도에
 * 대한 불안감을 줄 수 있는 톤이었으나, "지금 먼저 써볼 수 있다"는 방향으로
 * 바꿨다(예전 RecruitIntro 섹션의 메시지를 이 자리로 병합 — 헤더가
 * 두 번 반복되지 않도록 별도 섹션 대신 이 컴포넌트의 헤더로 흡수했다).
 * 실제 진입 경로는 여전히 모집 폼 제출 → 담당자 확인 후 연락이므로, 문구가
 * "즉시 가입"처럼 읽히지 않게 주의한다.
 */
export function FinalCtaSection() {
  return (
    <section id="recruit" className="bg-gradient-to-b from-background to-primary-soft/30 py-20">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-text-strong sm:text-3xl">지금, 먼저 써보세요.</h2>
          <p className="mt-4 text-muted-foreground">
            주문한장은 실제 주문과 배송 업무를 더 간단하게 만들기 위해 만들어지고 있습니다.
            <br />
            베타 기간 동안 실제 운영에 맞춰 서비스를 함께 개선하고 있습니다.
          </p>
        </div>

        <div className="mt-10">
          <RecruitForm />
        </div>
      </div>
    </section>
  );
}
