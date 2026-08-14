import { ShoppingCart, PackageCheck, UserCheck, Truck, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const HERO_FLOW = [
  { icon: ShoppingCart, label: "주문" },
  { icon: PackageCheck, label: "배송/작업 준비" },
  { icon: UserCheck, label: "담당자 배정" },
  { icon: Truck, label: "처리/배송" },
  { icon: CheckCircle2, label: "완료" },
];

/**
 * Beta 고객 모집 전환: Hero의 목적이 "가입 유도"에서 "우리 사업과 비슷한지
 * 5초 안에 판단하게 하기"로 바뀌었다 — 기능 나열 대신 핵심 운영 흐름
 * (주문→담당자→처리→완료)을 크게 보여주고, Primary CTA는 사장님 모집
 * 참여로, Secondary CTA는 서비스 설명 섹션(#service)으로 보낸다.
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
          주문이 들어온 다음,
          <br />
          일이 쉬워집니다.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          주문접수부터 담당자 배정, 배송, 완료까지
          <br />
          주문 이후의 복잡한 업무를 한 곳에서 관리하세요.
        </p>

        <div className="mx-auto mt-12 flex max-w-3xl flex-wrap items-center justify-center gap-2 sm:flex-nowrap">
          {HERO_FLOW.map((step, i) => (
            <div key={step.label} className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-2">
                <div className="flex size-12 items-center justify-center rounded-full bg-surface text-primary shadow-[0_1px_2px_rgba(15,23,42,0.06),0_4px_10px_-2px_rgba(5,150,105,0.15)]">
                  <step.icon className="size-5" />
                </div>
                <span className="w-20 text-xs font-medium text-text-strong">{step.label}</span>
              </div>
              {i < HERO_FLOW.length - 1 ? <ArrowRight className="mb-6 size-4 shrink-0 text-muted-foreground/50" /> : null}
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="gap-2">
            <a href="#recruit">사장님 모집에 참여하기</a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#service">서비스가 궁금하신가요?</a>
          </Button>
        </div>
        <Badge variant="outline" className="mt-6 bg-surface/70">
          지금은 서비스 판매가 아니라 사장님들의 이야기를 듣는 단계입니다
        </Badge>
      </div>
    </section>
  );
}
