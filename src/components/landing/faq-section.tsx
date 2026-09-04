"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// STEP12-5(CPO 작업지시, 2026-08-31) — STEP12-4에서 12개→5개로 줄인 것은
// 스크롤을 줄이려던 목적이 고객의 실제 궁금증까지 삭제하는 결과로 이어졌다는
// CPO 2차 검수 지적을 반영해 10개로 복구한다(주문/고객/배송/도입 4개 축).
// 구현되지 않은 자동 연동/자동화를 암시하는 답변은 넣지 않는다(카카오톡
// 자동 연동 없음, 자동 고객 병합 없음, 실시간 GPS 추적 없음).
//
// STEP12-6(CPO 작업지시, 2026-08-31) — 질문 내용(10개)은 그대로 유지하되,
// 첫 화면에는 가장 자주 묻는 6개만 보이고 나머지는 "더 많은 질문 보기"로
// 펼치게 한다(첫 화면 스크롤 길이 축소 목적, 질문 삭제 아님).
const FAQS = [
  {
    q: "어떤 주문을 등록할 수 있나요?",
    a: "스마트스토어 주문 엑셀, 자체 엑셀 양식, 전화·문자로 받은 수동 주문을 모두 등록해 한 화면에서 관리할 수 있습니다. 채널마다 따로 관리하지 않고 하나의 주문 구조로 정리됩니다.",
  },
  {
    q: "스마트스토어 주문은 어떻게 가져오나요?",
    a: "스마트스토어에서 내려받은 주문 엑셀을 그대로 업로드하면 됩니다. 이미 등록된 주문은 중복으로 다시 등록되지 않도록 확인해드립니다. 스마트스토어와 자동으로 연동되는 기능은 아직 없습니다.",
  },
  {
    q: "엑셀로 주문을 등록할 수 있나요?",
    a: "네, 스마트스토어 양식이 아니어도 됩니다. 처음 한 번 컬럼을 맞춰두면 다음 업로드부터는 그 설정을 그대로 재사용합니다.",
  },
  {
    q: "배송기사를 관리할 수 있나요?",
    a: "네, 기사를 등록하고 배송건마다 담당 기사와 배송 순서를 지정할 수 있습니다. 기사는 모바일 기사 앱에서 오늘 배송을 순서대로 확인하고 배송완료를 처리합니다.",
  },
  {
    q: "무료로 사용할 수 있나요?",
    a: "현재 베타 기간에는 무료로 사용하실 수 있습니다. Google 계정으로 가입하면 바로 시작할 수 있고, 이용 기간이 끝나기 전에 안내드립니다.",
  },
  {
    q: "같은 고객이 여러 번 주문하면 어떻게 관리되나요?",
    a: "이름·전화번호·주소가 정확히 일치하면 같은 고객으로 연결되어 주문 이력이 쌓입니다. 비슷하지만 확실하지 않으면 동일인 후보로 알려드리고, 확인 후 합치거나 되돌릴 수 있습니다.",
  },
  {
    q: "가까운 배송지를 묶어서 배정할 수 있나요?",
    a: "네, 가까운 배송지는 배송그룹으로 묶여 표시되고 그룹 단위로 기사를 한 번에 배정할 수 있습니다. 그룹 안에서 특정 건만 다른 기사로 지정하는 것도 가능합니다.",
  },
  {
    q: "배송 진행 상황을 확인할 수 있나요?",
    a: "배송 대기·배송중·완료 현황을 확인할 수 있고, 운행 중인 기사의 위치와 마지막 업데이트 시간도 함께 볼 수 있습니다.",
  },
  {
    q: "배송이 끝난 뒤 정산도 관리되나요?",
    a: "네, 기사별 배송 건수를 기준으로 정산 금액을 확인하고 지급 확정과 이력을 관리할 수 있습니다.",
  },
  {
    q: "우리 업종에도 사용할 수 있나요?",
    a: "반찬, 도시락, 꽃·화환, 케이크, 식품 등 주문 이후 배송 업무가 발생하는 사업자를 우선 검증하고 있습니다. 다른 업종이어도 운영 방식이 비슷하다면 문의해주세요.",
  },
];

const INITIAL_VISIBLE_COUNT = 5;

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
  const [showAll, setShowAll] = useState(false);
  const visibleFaqs = showAll ? FAQS : FAQS.slice(0, INITIAL_VISIBLE_COUNT);
  const hiddenCount = FAQS.length - INITIAL_VISIBLE_COUNT;

  return (
    <section className="bg-secondary/30 py-20">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <h2 className="text-center text-2xl font-bold text-text-strong sm:text-3xl">자주 묻는 질문</h2>
        <div className="mt-10 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          {visibleFaqs.map((faq) => (
            <FaqRow key={faq.q} q={faq.q} a={faq.a} />
          ))}
        </div>
        {hiddenCount > 0 ? (
          <div className="mt-4 text-center">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "질문 접기" : `더 많은 질문 보기 (${hiddenCount})`}
              <ChevronDown className={cn("size-3.5 transition-transform duration-200", showAll && "rotate-180")} />
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
