import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HeroPreviewDemo } from "./hero-preview-demo";

export function HeroSection() {
  return (
    <section id="product" className="mx-auto max-w-5xl px-4 pt-20 pb-24 text-center sm:px-6 sm:pt-28">
      <p className="text-sm font-semibold text-primary">작은 가게와 온라인 판매자를 위한 주문 관리</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight text-text-strong sm:text-5xl md:text-6xl">
        주문부터 배송, 고객, 정산까지
        <br />
        한곳에서 깔끔하게 관리하세요.
      </h1>
      <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
        전화로 받은 주문도, 온라인 주문도
        <br />
        주문:한장에 모아 관리할 수 있습니다.
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
        <HeroPreviewDemo />
      </div>
    </section>
  );
}
