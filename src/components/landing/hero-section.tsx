import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProductPreview, PreviewStat, PreviewRow } from "./product-preview";

export function HeroSection() {
  return (
    <section id="product" className="mx-auto max-w-6xl px-4 pt-16 pb-20 sm:px-6 sm:pt-24">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <span className="text-xs font-semibold tracking-wide text-primary uppercase">Order Operations Platform</span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-text-strong sm:text-5xl">
            주문부터 배송·정산까지
            <br />
            복잡한 운영을 한곳에서.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            엑셀 주문 등록부터 배송 배정, 고객 관리와 기사 정산까지 — 매일 반복되는 주문 업무를 간편하게 관리하세요.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="gap-2">
              <Link href="/login">무료로 시작하기</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/login">로그인</Link>
            </Button>
          </div>
          <Badge variant="outline" className="mt-5">
            현재 Beta 서비스로 무료로 이용할 수 있습니다
          </Badge>
        </div>

        <ProductPreview title="Ordify — 대시보드">
          <div className="grid grid-cols-3 gap-2">
            <PreviewStat label="배송대기" value="42건" />
            <PreviewStat label="배송중" value="18건" />
            <PreviewStat label="배송완료" value="76건" />
          </div>
          <p className="mt-4 text-xs font-medium text-muted-foreground">오늘 배송</p>
          <div className="mt-1">
            <PreviewRow primary="김민수" secondary="12건" badge="배송중" badgeTone="primary" />
            <PreviewRow primary="이영희" secondary="8건" badge="배송대기" />
            <PreviewRow primary="박철수" secondary="15건" badge="배송완료" badgeTone="success" />
          </div>
        </ProductPreview>
      </div>
    </section>
  );
}
