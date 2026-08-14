"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const FAQS = [
  {
    q: "스마트스토어를 쓰는데 필요한가요?",
    a: "스마트스토어를 대체하지 않습니다. 주문 이후의 업무를 관리하기 위한 서비스입니다.",
  },
  {
    q: "택배만 보내는데 필요한가요?",
    a: "현재는 필요성이 낮을 수 있습니다.",
  },
  {
    q: "자체배송을 하고 있는데요?",
    a: "주문:한장의 핵심 검증 대상입니다.",
  },
  {
    q: "전화 주문도 관리할 수 있나요?",
    a: "표준 주문 접수 방식으로 관리할 수 있도록 확장합니다.",
  },
  {
    q: "기사에게 매번 카톡으로 보내야 하나요?",
    a: "주문별 담당자를 지정하고 업무 상태를 관리하는 것이 핵심입니다.",
  },
  {
    q: "어떤 업종에서 사용할 수 있나요?",
    a: "반찬, 도시락, 꽃·화환, 케이크, 식품 등 주문 이후 별도 업무가 발생하는 사업자를 우선 검증합니다.",
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
