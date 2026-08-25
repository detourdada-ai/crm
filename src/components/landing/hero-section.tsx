import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * 랜딩 전면 개편(구조안 B, 2026-08): Hero의 역할은 "5초 안에 무엇인지
 * 이해시키기"로, 브랜드 메인 카피("복잡한 주문, 한 장으로.")를 처음으로
 * 실제 H1에 반영한다 — 예전 H1("주문이 들어온 다음, 일이 쉬워집니다.")은
 * 제거하고, 그 의미는 서브카피 톤에 녹여둔다. 흐름 다이어그램은 바로 다음
 * Before/After 섹션이 전담하므로 Hero에서는 다시 그리지 않는다(같은 내용을
 * 두 번 보여주면 "요약 후 설명"이 아니라 "같은 얘기 반복"으로 읽힌다).
 * 서브카피는 "자동으로 모아준다"는 인상을 주지 않도록 "정리 + 연결"만
 * 명시한다(§CPO 원칙).
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
          전화, 카카오톡, 스마트스토어, 엑셀 등 다양한 방식으로 들어오는 주문을
          <br />
          한 곳에서 정리하고, 배송까지 연결하세요.
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
