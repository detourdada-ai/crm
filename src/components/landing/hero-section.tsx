import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * STEP10-6(2026-08-28 CPO 작업지시) — Hero의 역할은 "5초 안에 무엇인지
 * 이해시키기"로, 브랜드 메인 카피("복잡한 주문, 한 장으로.")를 그대로
 * 유지한다. 서브카피는 STEP10-5에서 지적된 "전화/카카오톡/스마트스토어/
 * 엑셀"의 나열식 표현(자동 연동 서비스처럼 오해될 수 있음)을 걷어내고,
 * "여러 방식으로 들어오는 주문을 정리 + 배송/기사 관리로 연결"이라는
 * 결과 중심 문장으로 교체한다. 채널별 상세 설명과 흐름 다이어그램은 바로
 * 다음 문제공감 섹션과 FeatureShowcase가 전담하므로 Hero에서는 반복하지
 * 않는다.
 */
export function HeroSection() {
  return (
    <section
      id="product"
      className="relative overflow-hidden bg-gradient-to-b from-primary-soft/70 via-primary-soft/15 to-background"
    >
      <div className="mx-auto max-w-5xl px-4 pt-20 pb-20 text-center sm:px-6 sm:pt-28">
        <p className="text-sm font-semibold text-primary">주문 이후의 운영을 관리하는 소규모 사업자용 SaaS</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-text-strong sm:text-5xl md:text-6xl">
          복잡한 주문,
          <br />
          한 장으로.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          여러 방식으로 들어오는 주문과 고객 정보를 정리하고,
          <br />
          배송부터 기사 관리까지 한 곳에서 관리하세요.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="gap-2">
            <a href="#recruit">베타 신청하기</a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#service">서비스가 궁금하신가요?</a>
          </Button>
        </div>
        <Badge variant="outline" className="mt-6 bg-surface/70">
          현재 베타로 사업자분들과 함께 서비스를 만들어가고 있습니다
        </Badge>
      </div>
    </section>
  );
}
