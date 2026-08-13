import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProductPreview, PreviewStat, PreviewRow } from "./product-preview";

export function HeroSection() {
  return (
    <section id="product" className="mx-auto max-w-5xl px-4 pt-20 pb-24 text-center sm:px-6 sm:pt-28">
      <h1 className="text-4xl font-bold tracking-tight text-text-strong sm:text-5xl md:text-6xl">
        주문 관리, 배송, 고객, 정산을
        <br />
        하나의 흐름으로.
      </h1>
      <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
        복잡한 주문 업무를 Ordify가 정리합니다.
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

      <div className="mx-auto mt-16 max-w-4xl">
        <ProductPreview path="/dashboard">
          <p className="text-sm text-muted-foreground">좋은 아침입니다 — 오늘 처리할 업무를 확인하세요.</p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <PreviewStat label="처리할 주문" value="12건" />
            <PreviewStat label="오늘 배송" value="38건" />
            <PreviewStat label="정산 대기" value="5건" />
          </div>
          <p className="mt-6 text-xs font-medium text-muted-foreground">오늘의 배송</p>
          <div className="mt-1">
            <PreviewRow primary="김민수" secondary="12건 · 강남구 일대" badge="배송중" badgeTone="primary" />
            <PreviewRow primary="이영희" secondary="8건 · 송파구 일대" badge="배송대기" />
            <PreviewRow primary="박철수" secondary="15건 · 마포구 일대" badge="완료" badgeTone="success" />
          </div>
        </ProductPreview>
      </div>
    </section>
  );
}
