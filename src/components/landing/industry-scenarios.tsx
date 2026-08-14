"use client";

import { useState } from "react";
import { ArrowRight, Salad, UtensilsCrossed, Flower2, Cake, Package, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

// 업종별 "이거 우리 가게랑 똑같은데?" 반응을 만드는 게 목적 — 기능 설명이
// 아니라 각 업종에서 실제로 벌어지는 주문→담당자→처리→완료 흐름을 그대로
// 보여준다. 배송은 첫 진입점일 뿐, 제품의 본질은 이 공통 운영 구조다.
const INDUSTRIES = [
  { key: "반찬", icon: Salad, flow: ["주문", "배송준비", "기사 배정", "배송", "완료"] },
  { key: "도시락", icon: UtensilsCrossed, flow: ["주문", "조리", "포장", "기사 배정", "완료"] },
  { key: "꽃·화환", icon: Flower2, flow: ["주문", "제작", "담당자 배정", "배송/설치", "완료"] },
  { key: "케이크·답례품", icon: Cake, flow: ["주문", "제작", "픽업/배송", "담당자 배정", "완료"] },
  { key: "식품", icon: Package, flow: ["주문", "포장", "담당자 배정", "배송", "완료"] },
  { key: "기타", icon: MoreHorizontal, flow: ["주문", "준비", "담당자 배정", "처리", "완료"] },
];

export function IndustryScenarios() {
  const [selected, setSelected] = useState(0);
  const active = INDUSTRIES[selected];

  return (
    <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6">
      <div className="text-center">
        <span className="text-xs font-semibold tracking-wide text-primary uppercase">업종별 시나리오</span>
        <h2 className="mt-2 text-2xl font-bold text-text-strong sm:text-3xl">어떤 사업을 운영하시나요?</h2>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-2.5">
        {INDUSTRIES.map((industry, i) => (
          <button
            key={industry.key}
            type="button"
            onClick={() => setSelected(i)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition-all",
              i === selected
                ? "border-primary bg-primary text-primary-foreground shadow-[0_4px_10px_-2px_rgba(5,150,105,0.35)]"
                : "border-border bg-surface text-muted-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:-translate-y-0.5 hover:border-primary/40 hover:text-foreground hover:shadow-[0_4px_10px_-2px_rgba(15,23,42,0.1)]"
            )}
          >
            <industry.icon className="size-4" />
            {industry.key}
          </button>
        ))}
      </div>

      <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-border bg-gradient-to-b from-surface to-secondary/30 p-8 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-14px_rgba(15,23,42,0.15)]">
        <p className="text-center text-sm font-semibold text-primary">{active.key} 사장님의 하루</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {active.flow.map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <span className="rounded-full bg-secondary px-3.5 py-2 text-sm font-medium text-text-strong">{step}</span>
              {i < active.flow.length - 1 ? <ArrowRight className="size-4 shrink-0 text-muted-foreground/50" /> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
