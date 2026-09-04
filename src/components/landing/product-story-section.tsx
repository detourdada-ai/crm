import { ArrowRight } from "lucide-react";
import { CustomersScreen, DeliveryScreen, DriverPhone, ImportScreen } from "./product-screens";

/**
 * LANDING v3 — 랜딩의 본체. v2는 "제품 흐름 설명 섹션"과 "실제 화면 섹션"이
 * 따로 있었는데, 같은 화면을 두 번 보여주는 꼴이라 오히려 카드 나열처럼
 * 읽혔다. v3는 하나로 합쳐 **UI가 스토리를 진행하게** 한다.
 *
 * 단계마다 레이아웃을 다르게 둔다(좌/우/전면) — 같은 형태가 반복되는 순간
 * 다시 문서가 된다. 설명은 각 단계 3~4줄로 제한한다.
 */
function StepLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-3xl font-bold text-primary/25 sm:text-4xl">{n}</span>
      <span className="text-sm font-semibold text-primary">{title}</span>
    </div>
  );
}

export function ProductStorySection() {
  return (
    <section id="flow" className="overflow-hidden border-y border-border bg-secondary/25 py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <h2 className="max-w-2xl text-[1.75rem] leading-snug font-bold text-text-strong sm:text-[2.75rem]">
          주문 하나가 <span className="text-primary">고객·배송·기사까지</span> 그대로 이어집니다.
        </h2>

        {/* 01 주문 — 화면 좌 / 설명 우 */}
        <div className="mt-12 grid items-center gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:gap-14">
          <ImportScreen />
          <div>
            <StepLabel n="01" title="주문" />
            <p className="mt-3 text-xl leading-snug font-bold text-text-strong sm:text-2xl">
              어디서 들어온 주문이든 같은 목록으로
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              스마트스토어 엑셀을 그대로 올리고, 전화로 받은 주문은 직접 등록합니다. 매일 올리는 누적 파일에서 오늘 주문만 골라
              받을 수 있고, 이미 등록된 주문은 다시 등록되지 않습니다.
            </p>
          </div>
        </div>

        {/* 02 고객 — 설명 좌 / 화면 우 */}
        <div className="mt-16 grid items-center gap-8 lg:mt-24 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-14">
          <div className="lg:order-1">
            <StepLabel n="02" title="고객" />
            <p className="mt-3 text-xl leading-snug font-bold text-text-strong sm:text-2xl">주문이 쌓일수록 고객이 정확해집니다</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              주문이 들어오면 기존 고객인지 확인해 연결합니다. 같은 사람으로 보이는 주문은 후보로 알려주고, 연결할지는 사장님이
              결정합니다. 고객마다 지금까지의 주문이 그대로 남습니다.
            </p>
          </div>
          <div className="lg:order-2">
            <CustomersScreen />
          </div>
        </div>

        {/* 03 배송 + 04 기사 — 전면 배치. 기사 화면은 별도 섹션이 아니라
            배송관리의 "결과"로 겹쳐 놓는다. */}
        <div className="mt-16 lg:mt-24">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:items-end lg:gap-14">
            <div>
              <StepLabel n="03" title="배송 · 기사" />
              <p className="mt-3 text-xl leading-snug font-bold text-text-strong sm:text-2xl">
                오늘 배송을 정리하면, 기사 화면까지 그대로
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                가까운 배송지는 묶어서 보여주고, 기사 배정과 가방번호를 함께 입력해 한 번에 저장합니다. 저장한 순서 그대로 기사
                화면에 나타나고, 기사가 배송완료를 누르면 사장님 화면에도 반영됩니다.
              </p>
              <p className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary">
                배송그룹 <ArrowRight className="size-3.5" /> 기사 배정 <ArrowRight className="size-3.5" /> 기사 앱
              </p>
            </div>
            <div className="relative">
              <DeliveryScreen />
              <div className="mt-4 flex justify-center lg:absolute lg:-right-4 lg:-bottom-12 lg:mt-0 xl:-right-10">
                <DriverPhone />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
