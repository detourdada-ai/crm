import { ArrowDown } from "lucide-react";

/**
 * LANDING REPOSITIONING v1(CPO 작업지시, 2026-09-04) — 랜딩의 핵심 섹션.
 *
 * 예전 랜딩은 기능을 탭(주문/배송/기사)으로 나눠 보여줘서, 클릭하지 않으면
 * 연결 구조가 보이지 않았고 결과적으로 "배송 관리 서비스"처럼 읽혔다.
 * 여기서는 탭을 없애고 **① 주문을 모으고 → ② 고객과 연결하고 → ③ 배송을
 * 정리하고 → ④ 기사에게 전달합니다** 를 하나의 세로 흐름으로 보여준다.
 *
 * 각 단계에 적는 항목은 지금 제품에 실제로 있는 것만 쓴다(엑셀/스마트스토어
 * 업로드, 동일인 후보, 배송그룹, 기사 배정, 기사 앱의 배송 순서).
 */
interface FlowStep {
  no: string;
  title: string;
  items: string[];
}

const STEPS: FlowStep[] = [
  {
    no: "①",
    title: "주문을 모으고",
    items: ["스마트스토어 주문 엑셀", "자체 주문 엑셀 양식", "전화·수동 주문 직접 등록"],
  },
  {
    no: "②",
    title: "고객과 연결하고",
    items: ["기존 고객 자동 확인", "같은 고객으로 보이면 동일인 후보로 안내", "고객별 주문 이력 연결"],
  },
  {
    no: "③",
    title: "배송을 정리하고",
    items: ["오늘 보낼 배송건 정리", "가까운 배송지끼리 배송그룹", "기사 배정 · 배송 순서 지정"],
  },
  {
    no: "④",
    title: "기사에게 전달합니다",
    items: ["기사별 오늘 배송 목록", "정해진 순서 그대로 표시", "배송완료 처리"],
  },
];

export function OrderFlowSection() {
  return (
    <section id="flow" className="bg-background py-14 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl leading-snug font-bold text-text-strong sm:text-4xl">
            들어오는 주문은 달라도,
            <br />
            <span className="text-primary">관리는 하나면 됩니다.</span>
          </h2>
        </div>

        <ol className="mt-10 space-y-3 sm:mt-14">
          {STEPS.map((step, i) => (
            <li key={step.no}>
              <div className="rounded-2xl border border-border bg-surface px-6 py-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:px-8 sm:py-7">
                <div className="flex items-baseline gap-3">
                  <span className="text-lg font-bold text-primary sm:text-xl">{step.no}</span>
                  <h3 className="text-xl font-bold text-text-strong sm:text-2xl">{step.title}</h3>
                </div>
                <ul className="mt-4 space-y-2 pl-8">
                  {step.items.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground sm:text-base">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/40" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              {i < STEPS.length - 1 ? (
                <div className="flex justify-center py-2">
                  <ArrowDown className="size-5 text-primary/50" />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
