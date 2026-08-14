"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProductPreview, PreviewStat, PreviewTable, type PreviewTableRow } from "./product-preview";

const BASE_ROWS: PreviewTableRow[] = [
  { order: "#1024", customer: "김민수", item: "반찬 5종", deliveryDate: "8.13", status: "배송 준비" },
  { order: "#1023", customer: "이지은", item: "국 3종", deliveryDate: "8.13", status: "배송중", statusTone: "success" },
  { order: "#1022", customer: "박서준", item: "반찬 3종", deliveryDate: "8.14", status: "처리 필요", statusTone: "primary" },
];

// "주문 접수 → 상세 팝업 → 상태 변경 → 목록 반영"의 짧은 반복 애니메이션.
// 실제 서비스 기능은 호출하지 않는 Landing 전용 Mock Interaction.
const STEPS = ["idle", "popup", "changing", "updated"] as const;
type Step = (typeof STEPS)[number];

export function HeroPreviewDemo() {
  const [step, setStep] = useState<Step>("idle");

  useEffect(() => {
    let i = 0;
    const timer = setInterval(() => {
      i = (i + 1) % STEPS.length;
      setStep(STEPS[i]);
    }, 1300);
    return () => clearInterval(timer);
  }, []);

  const rows: PreviewTableRow[] = BASE_ROWS.map((row) =>
    row.order === "#1022" && step === "updated"
      ? { ...row, status: "배송 준비", statusTone: undefined, highlighted: true }
      : row
  );

  return (
    <ProductPreview screen="오늘의 주문" withSidebar showPreviewLabel>
      <div className="flex flex-wrap items-end justify-between gap-4 text-left">
        <div>
          <p className="text-sm font-semibold text-text-strong">오늘의 주문</p>
          <p className="mt-1 text-4xl font-bold text-text-strong">32건</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <PreviewStat label="처리 필요" value="8" />
          <PreviewStat label="배송 준비" value="12" />
          <PreviewStat label="배송 중" value="7" />
          <PreviewStat label="완료" value="5" />
        </div>
      </div>

      <div className="relative mt-6">
        <PreviewTable rows={rows} />

        {step === "popup" || step === "changing" ? (
          <div className="animate-in fade-in-0 slide-in-from-bottom-2 absolute right-2 bottom-2 w-56 rounded-xl border border-border bg-surface p-3 text-left shadow-lg duration-300">
            <p className="text-xs font-semibold text-text-strong">주문 상세 · #1022</p>
            <p className="mt-2 text-xs text-muted-foreground">박서준 · 반찬 3종</p>
            <p className="text-xs text-muted-foreground">서울시 강남구 ...</p>
            <Button size="sm" className="mt-3 h-7 w-full text-xs" disabled={step !== "changing"}>
              {step === "changing" ? "배송 준비로 변경 중..." : "배송 준비로 변경"}
            </Button>
          </div>
        ) : null}
      </div>
    </ProductPreview>
  );
}
