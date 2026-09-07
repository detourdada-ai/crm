import { ArrowRight } from "lucide-react";
import { CustomersScreen, DeliveryScreen, DriverPhone, ImportScreen } from "./product-screens";

/**
 * LANDING v3 → v4 — 랜딩의 본체.
 *
 * v3에서 "제품 흐름 설명"과 "실제 화면"을 하나로 합쳐 UI가 스토리를 진행하게
 * 했다. v4는 각 단계의 **출발점을 기능 설명에서 실제 운영 업무로** 바꾼다.
 * 섹션을 새로 추가하지 않고 기존 설명을 교체·흡수하는 방식이라 길이는 늘지
 * 않는다(작업지시 §9).
 *
 * v5(2026-09-07) — 설명을 읽어야 이해되던 구조를 줄였다. 각 단계의 첫 문장은
 * 이제 "무엇을 하는가"를 한 줄로 말하고, 본문은 2줄 이내다. 우리 제품은 기능이
 * 많아서, 길게 설명할수록 "뭔가 복잡한 프로그램"으로 읽힌다.
 *
 * **인용문 정책(중요, 작업지시 §5)** — 실제 사장님 인터뷰 원문이 아직 없다.
 * 그래서 여기 문장들은 전부 *운영 상황 서술*이며, 큰따옴표·화자 표기·별점을
 * 붙이지 않는다. 하지 않은 말을 "실제 사용자 후기"처럼 보이게 만들지 않는다.
 * 실제 인터뷰가 확보되면 각 STEP의 `quote`/`attribution`만 채우면 되고,
 * 값이 있을 때만 인용 블록이 렌더된다(구조는 이미 준비돼 있다).
 *
 * 단계마다 레이아웃을 다르게 둔다(좌/우/전면) — 같은 형태가 반복되는 순간
 * 다시 문서가 된다. 상단 메뉴(주문/고객/배송)가 각 단계의 id를 가리킨다.
 */
interface StoryStep {
  id: string;
  n: string;
  label: string;
  /** 실제 운영에서 반복되는 업무. 인용이 아니라 서술이다. */
  situation: string;
  body: string;
  /** 실제 인터뷰 확보 시에만 채운다. 없으면 인용 블록을 렌더하지 않는다. */
  quote?: string;
  attribution?: string;
}

const STEPS: Record<"orders" | "customers" | "delivery", StoryStep> = {
  orders: {
    id: "orders",
    n: "01",
    label: "주문 관리",
    situation: "여러 곳에서 들어온 주문을 한곳에.",
    body: "엑셀은 그대로 올리고, 전화 주문은 직접 등록합니다. 누적 파일에서 오늘 주문만 골라 받고, 이미 등록된 주문은 다시 등록되지 않습니다.",
  },
  customers: {
    id: "customers",
    n: "02",
    label: "고객 관리",
    situation: "누가 주문했는지 다시 찾지 않게.",
    body: "같은 사람으로 보이는 주문은 후보로 알려주고, 연결할지는 사장님이 정합니다. 고객마다 지금까지의 주문이 그대로 남습니다.",
  },
  delivery: {
    id: "delivery",
    n: "03",
    label: "배송 관리 · 기사",
    situation: "오늘 배송할 주문만 기사에게.",
    body: "가까운 배송지는 묶어서 보여주고, 기사 배정과 가방번호를 한 번에 저장합니다. 저장한 순서 그대로 기사 화면에 나타나고, 배송완료는 사장님 화면에 바로 반영됩니다.",
  },
};

function StepHead({ step }: { step: StoryStep }) {
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold text-primary/25 sm:text-4xl">{step.n}</span>
        <span className="text-sm font-semibold text-primary">{step.label}</span>
      </div>
      <p className="mt-3 text-xl leading-snug font-bold break-keep text-text-strong sm:text-2xl">{step.situation}</p>
      {step.quote ? (
        <blockquote className="mt-4 border-l-2 border-primary/40 pl-4 text-sm leading-relaxed text-text-strong sm:text-base">
          {step.quote}
          {step.attribution ? <footer className="mt-1.5 text-xs text-muted-foreground">— {step.attribution}</footer> : null}
        </blockquote>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed break-keep text-muted-foreground sm:text-base">{step.body}</p>
    </div>
  );
}

export function ProductStorySection() {
  return (
    <section id="flow" className="overflow-hidden border-y border-border bg-secondary/25 py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* 2줄 구성은 의도한 것이다(작업지시 §3) — 화면 폭에 따라 "끝." 한 조각만
            떨어지는 일이 없도록 줄바꿈 지점을 직접 잡고, 나머지는 break-keep으로
            단어 중간에서 끊기지 않게 한다. nowrap으로 강제하지 않는다. */}
        <h2 className="max-w-2xl text-[1.75rem] leading-snug font-bold break-keep text-text-strong sm:text-[2.75rem]">
          주문이 들어오면 <span className="text-primary">받고</span>
          <br />
          <span className="text-primary">· 확인하고 · 보내고</span>, 끝.
        </h2>

        {/* 01 주문 — 화면 좌 / 설명 우 */}
        <div id={STEPS.orders.id} className="mt-12 grid scroll-mt-20 items-center gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:gap-14">
          <ImportScreen />
          <StepHead step={STEPS.orders} />
        </div>

        {/* 02 고객 — 설명 좌 / 화면 우 */}
        <div
          id={STEPS.customers.id}
          className="mt-16 grid scroll-mt-20 items-center gap-8 lg:mt-24 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-14"
        >
          <div className="lg:order-1">
            <StepHead step={STEPS.customers} />
          </div>
          <div className="lg:order-2">
            <CustomersScreen />
          </div>
        </div>

        {/* 03 배송 + 기사 — 전면 배치. 기사 화면은 별도 섹션이 아니라
            배송관리의 "결과"로 겹쳐 놓는다. */}
        <div id={STEPS.delivery.id} className="mt-16 scroll-mt-20 lg:mt-24">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:items-end lg:gap-14">
            <div>
              <StepHead step={STEPS.delivery} />
              {/* v5.1: 좁은 폭에서 "기사 앱"만 다음 줄로 떨어지지 않게 flex-wrap 대신
                  한 덩어리로 감싸고, 넘칠 때는 묶음 단위로 줄바꿈되게 한다. */}
              <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-primary">
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  배송그룹 <ArrowRight className="size-3.5" /> 기사 배정
                </span>
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <ArrowRight className="size-3.5" /> 기사 앱
                </span>
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
