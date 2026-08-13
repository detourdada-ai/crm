import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProductPreview, PreviewAction, PreviewFlowRow } from "./product-preview";

export function HeroSection() {
  return (
    <section id="product" className="mx-auto max-w-5xl px-4 pt-20 pb-24 text-center sm:px-6 sm:pt-28">
      <h1 className="text-4xl font-bold tracking-tight text-text-strong sm:text-5xl md:text-6xl">
        주문이 들어오면,
        <br />
        배송부터 정산까지 한곳에서.
      </h1>
      <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
        포스기 없이 주문을 관리하는 작은 가게부터
        <br />
        온라인 판매자까지, 복잡한 판매 업무를 간단하게.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg" className="gap-2">
          <Link href="/login">무료로 시작하기</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <a href="#features">제품 살펴보기</a>
        </Button>
      </div>
      <Badge variant="outline" className="mt-6">
        현재 Beta 서비스로 무료로 이용할 수 있습니다
      </Badge>

      <div className="mx-auto mt-16 max-w-5xl">
        <ProductPreview title="Ordify 대시보드" withSidebar>
          <p className="text-left text-sm font-semibold text-text-strong">오늘의 업무</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <PreviewAction label="주문 확인" value="12건" cta="확인하기" />
            <PreviewAction label="배송 준비" value="8건" cta="확인하기" />
            <PreviewAction label="정산 확인" value="5건" cta="확인하기" />
          </div>
          <p className="mt-6 text-left text-xs font-medium text-muted-foreground">최근 주문</p>
          <div className="mt-1">
            <PreviewFlowRow
              primary="김민수 · 반찬 3종 세트"
              secondary="ORD-1023"
              steps={["주문접수", "배송준비", "배송중"]}
              activeIndex={1}
            />
            <PreviewFlowRow
              primary="박지현 · 국물요리 세트"
              secondary="ORD-1022"
              steps={["주문접수", "배송준비", "배송중"]}
              activeIndex={2}
            />
            <PreviewFlowRow
              primary="이수진 · 밑반찬 모음"
              secondary="ORD-1021"
              steps={["배송중", "배송완료"]}
              activeIndex={1}
            />
          </div>
        </ProductPreview>
      </div>
    </section>
  );
}
