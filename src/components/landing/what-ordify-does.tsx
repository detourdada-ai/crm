import { ShoppingCart, Users, Truck, Smartphone, CheckCircle2, ArrowRight } from "lucide-react";

const PILLARS = [
  {
    icon: ShoppingCart,
    number: "01",
    label: "주문",
    headline: "어디서 온 주문이든, 같은 방식으로 정리합니다",
    description:
      "수동 입력, 표준 엑셀 업로드(스마트스토어 전용이 아닌 임의 양식)를 하나의 주문 목록으로 관리합니다. 매일 누적해서 올려도 이미 등록된 주문은 다시 등록되지 않고, 애매한 건은 사용자가 확인 후 등록합니다.",
  },
  {
    icon: Users,
    number: "02",
    label: "고객",
    headline: "주문할 때마다 고객 기록이 쌓입니다",
    description: "이름·전화번호·주소를 기준으로 고객을 자동으로 연결하고, 주문 이력과 구매 금액을 정리합니다.",
  },
  {
    icon: Truck,
    number: "03",
    label: "배송",
    headline: "오늘 보낼 주문과 담당자를 한 화면에서",
    description: "배정 필요/배송중/직접수령 상태를 나누고, 지역별로 묶어 담당 기사를 배정합니다.",
  },
  {
    icon: Smartphone,
    number: "04",
    label: "기사",
    headline: "사장님이 정리한 정보를 기사님이 바로 확인합니다",
    description: "기사는 모바일에서 오늘 배정된 배송을 순서대로 확인하고, 현재/다음 배송을 바로 처리합니다.",
  },
  {
    icon: CheckCircle2,
    number: "05",
    label: "완료",
    headline: "배송이 끝나면 정산까지 이어집니다",
    description: "배송완료 현황을 사장님이 실시간으로 확인하고, 완료된 배송은 기사별 정산으로 연결됩니다.",
  },
];

/**
 * 랜딩 전면 개편(구조안 B) STEP6 — 기존 FlowSection(주문→담당자→처리→완료,
 * 4단계 카드)을 대체한다. 기능 나열이 아니라 "복잡하게 들어오는 주문이
 * 어떻게 하나의 운영 흐름으로 바뀌는가"를 먼저 개념적으로 보여주는 자리이며,
 * 실제 화면 스크린샷은 바로 다음 섹션(FeatureShowcase)이 맡는다 — 여기서
 * 화면을 또 보여주면 같은 정보를 두 번 반복하게 된다. id="service"는 기존
 * Header/Footer/Hero 앵커(#service)가 계속 이 자리를 가리키도록 유지한다.
 */
export function WhatOrdifyDoes() {
  return (
    <section id="service" className="border-y border-border bg-gradient-to-b from-secondary/50 to-primary-soft/25 py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <p className="text-center text-xs font-semibold tracking-wide text-primary uppercase">주문한장이 하는 일</p>
        <h2 className="mt-2 text-center text-2xl font-bold text-text-strong sm:text-3xl">
          주문 → 고객 → 배송 → 기사 → 완료
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted-foreground">
          다양한 방식으로 들어온 주문을 표준화해서 관리하고, 배송과 기사까지 하나의 흐름으로 연결합니다.
        </p>

        <div className="mt-14 space-y-5">
          {PILLARS.map((pillar, i) => (
            <div key={pillar.number} className="relative flex gap-5 rounded-2xl border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex shrink-0 flex-col items-center gap-2">
                <div className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_10px_-2px_rgba(5,150,105,0.4)]">
                  <pillar.icon className="size-5" />
                </div>
                {i < PILLARS.length - 1 ? <ArrowRight className="size-4 rotate-90 text-primary/40" /> : null}
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold tracking-wide text-primary">{pillar.number} · {pillar.label}</span>
                <p className="mt-1 text-lg font-bold text-text-strong">{pillar.headline}</p>
                <p className="mt-1.5 text-sm text-muted-foreground">{pillar.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
