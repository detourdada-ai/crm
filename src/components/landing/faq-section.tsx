"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// STEP12-4(CPO 작업지시, 2026-08-31) — 베타 랜딩에서는 12개 질문 전부를
// 미리 답하지 않는다. 문의 직전에 남는 핵심 의문 5개만 남기고 나머지는
// 문의 과정에서 담당자가 직접 확인한다(CPO 지시 원문). 구현되지 않은
// 자동 연동/자동화를 암시하는 답변은 넣지 않는다(카카오톡 자동 연동 없음,
// 자동 고객 병합 없음, 실시간 GPS 추적 없음).
const FAQS = [
  {
    q: "어떤 주문을 등록할 수 있나요?",
    a: "전화, 문자, 카카오톡으로 받은 주문도 수동 등록으로 바로 관리할 수 있고, 스마트스토어 등 엑셀로 받은 주문도 함께 등록할 수 있습니다.",
  },
  {
    q: "기존 스마트스토어 주문도 사용할 수 있나요?",
    a: "네, 스마트스토어 주문 엑셀뿐 아니라 표준 엑셀 양식도 컬럼을 매핑해 등록할 수 있고, 한 번 설정한 매핑은 다음에도 그대로 재사용됩니다.",
  },
  {
    q: "배송기사는 어떻게 사용하나요?",
    a: "기사는 모바일 기사 앱에서 오늘 배정된 배송을 순서대로 확인하고, 배송완료 처리를 바로 합니다.",
  },
  {
    q: "여러 명의 기사를 관리할 수 있나요?",
    a: "네, 여러 명의 기사를 등록하고 배송건마다 담당 기사를 지정해 관리할 수 있습니다.",
  },
  {
    q: "우리 가게에 맞는지 먼저 상담할 수 있나요?",
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
