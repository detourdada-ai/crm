"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// STEP10-6(2026-08-28 CPO 작업지시) — FAQ는 기능 목록 반복이 아니라
// "문의 직전에 남는 실제 불안/의문"을 없애는 역할이다. STEP10-5에서
// 확인된 오류(전화 주문 FAQ가 이미 되는 걸 "확장 예정"으로 축소 서술)를
// 정정했고, 구현되지 않은 자동 연동/자동화를 암시하는 답변은 넣지 않는다
// (카카오톡 자동 연동 없음, 자동 고객 병합 없음, 실시간 GPS 추적 없음).
const FAQS = [
  {
    q: "전화 주문도 관리할 수 있나요?",
    a: "네, 수동 주문 등록으로 전화 주문도 바로 등록해 관리할 수 있습니다.",
  },
  {
    q: "카카오톡이나 메시지로 받은 주문도 등록할 수 있나요?",
    a: "네, 카카오톡·문자로 받은 주문도 수동 주문 등록으로 관리할 수 있습니다. 다만 카카오톡과 자동으로 연동되는 기능은 아직 없습니다.",
  },
  {
    q: "스마트스토어 주문만 사용할 수 있나요?",
    a: "아니요. 스마트스토어 주문 엑셀뿐 아니라 표준 엑셀 양식도 업로드해서 관리할 수 있습니다. 스마트스토어를 대체하지 않고, 주문 이후의 업무를 관리하기 위한 서비스입니다.",
  },
  {
    q: "엑셀 양식이 달라도 등록할 수 있나요?",
    a: "네, 스마트스토어 전용 양식이 아닌 임의의 엑셀 양식도 컬럼을 매핑해 등록할 수 있고, 한 번 설정한 매핑은 다음에도 그대로 재사용됩니다.",
  },
  {
    q: "같은 고객이 여러 번 주문하면 어떻게 관리되나요?",
    a: "이름·전화번호·주소가 정확히 일치하면 자동으로 같은 고객으로 연결되어 주문 이력이 쌓입니다.",
  },
  {
    q: "고객 정보가 중복되면 어떻게 하나요?",
    a: "정보가 정확히 일치하지 않아 별도 고객으로 등록된 경우, 동일인으로 보이는 후보를 알려드리고 확인 후 병합할 수 있습니다. 자동으로 병합되지는 않습니다.",
  },
  {
    q: "배송기사는 어떻게 주문을 확인하나요?",
    a: "기사는 모바일 기사 앱에서 오늘 배정된 배송을 순서대로 확인하고, 배송완료 처리를 바로 합니다.",
  },
  {
    q: "여러 명의 기사를 관리할 수 있나요?",
    a: "네, 여러 명의 기사를 등록하고 배송건마다 담당 기사를 지정해 관리할 수 있습니다.",
  },
  {
    q: "배송 진행 상황과 기사 위치를 확인할 수 있나요?",
    a: "배송 대기·배송중·완료 현황을 확인할 수 있고, 운행 중인 기사의 위치와 마지막 업데이트 시간도 함께 볼 수 있습니다.",
  },
  {
    q: "자체 배송과 택배 배송을 함께 관리할 수 있나요?",
    a: "자체 배송 기사 배정과 배송 진행 관리가 핵심 기능입니다. 택배로 발송하는 주문도 주문 목록에서 함께 확인할 수 있지만, 택배사 운송장 자동 발급 같은 연동 기능은 제공하지 않습니다.",
  },
  {
    q: "우리 업종에도 사용할 수 있나요?",
    a: "반찬, 도시락, 꽃·화환, 케이크, 식품 등 주문 이후 배송·정산 업무가 발생하는 사업자를 우선 검증하고 있습니다. 다른 업종이어도 운영 방식이 비슷하다면 문의해주세요.",
  },
  {
    q: "도입 전에 우리 운영 방식에 맞는지 상담할 수 있나요?",
    a: "네, 현재 주문을 어떻게 받고 배송하고 있는지 알려주시면 담당자가 확인 후 맞는 방식인지 함께 검토해드립니다.",
  },
];

function FaqRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center justify-between gap-3 px-5 py-4 text-left text-sm font-semibold transition-colors hover:bg-secondary/50",
            open ? "bg-secondary/40 text-primary" : "text-text-strong"
          )}
        >
          <span>Q. {q}</span>
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180 text-primary")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="px-5 pb-4 text-sm text-muted-foreground">{a}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function FaqSection() {
  return (
    <section className="bg-secondary/30 py-20">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <h2 className="text-center text-2xl font-bold text-text-strong sm:text-3xl">자주 묻는 질문</h2>
        <div className="mt-10 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          {FAQS.map((faq) => (
            <FaqRow key={faq.q} q={faq.q} a={faq.a} />
          ))}
        </div>
      </div>
    </section>
  );
}
