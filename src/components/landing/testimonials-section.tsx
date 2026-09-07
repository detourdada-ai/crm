"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { TESTIMONIALS, type Testimonial } from "@/lib/constants/testimonials";
import { cn } from "@/lib/utils";

/**
 * LANDING v5(CEO 승인 개선, 2026-09-07) — Q&A 바로 위 실사용 후기 카드 슬라이드.
 *
 * **가공된 후기를 만들지 않는다.** 사장님이 하지 않은 말을 "실사용 후기"처럼
 * 보여주는 순간, 우리가 이 랜딩 내내 지켜온 것(없는 기능을 그리지 않는다,
 * 성과 수치를 만들지 않는다)이 무너진다. 그래서 데이터가 비어 있으면 이
 * 섹션은 **아무것도 렌더하지 않고 사라진다** — "후기 준비 중" 같은 자리표시도
 * 두지 않는다(빈 약속처럼 보인다).
 *
 * UI는 완성돼 있으므로 실제 후기를 확보하면 `lib/constants/testimonials.ts`에
 * 항목만 추가하면 된다. 10장이든 3장이든 개수에 맞춰 동작한다.
 */

const AUTO_MS = 6000;

function Stars({ rating }: { rating?: number }) {
  if (!rating) return null;
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <div className="flex gap-0.5" aria-label={`별점 ${filled}점 (5점 만점)`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={cn("size-4", i < filled ? "fill-amber-400 text-amber-400" : "text-border")} aria-hidden />
      ))}
    </div>
  );
}

function Card({ item }: { item: Testimonial }) {
  return (
    <figure className="flex h-full flex-col rounded-xl border border-border bg-surface p-5 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.35)]">
      <Stars rating={item.rating} />
      <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-text-strong sm:text-base">{item.quote}</blockquote>
      <figcaption className="mt-4 text-xs text-muted-foreground">{item.author}</figcaption>
    </figure>
  );
}

export function TestimonialsSection() {
  const items = TESTIMONIALS;
  const [page, setPage] = useState(0);
  const [auto, setAuto] = useState(true);
  const [perPage, setPerPage] = useState(1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 카드 크기를 고정하지 않고 화면 폭에 맞춰 1/2/3장씩 보여준다.
  useEffect(() => {
    const apply = () => setPerPage(window.innerWidth >= 1024 ? 3 : window.innerWidth >= 640 ? 2 : 1);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  const pageCount = Math.max(1, Math.ceil(items.length / perPage));

  const go = useCallback(
    (next: number) => {
      setPage(((next % pageCount) + pageCount) % pageCount);
      setAuto(false);
      if (timer.current) clearInterval(timer.current);
    },
    [pageCount]
  );

  useEffect(() => {
    if (!auto || pageCount <= 1) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    timer.current = setInterval(() => setPage((p) => (p + 1) % pageCount), AUTO_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [auto, pageCount]);

  // 실제 후기가 없으면 섹션 자체가 없다. 만들어낸 후기는 넣지 않는다.
  if (items.length === 0) return null;

  // 화면이 좁아져 페이지 수가 줄면 현재 페이지가 범위를 넘을 수 있다. effect로
  // 되돌리지 않고 파생값으로 잡는다(렌더 중 setState를 만들지 않기 위해).
  const safePage = Math.min(page, pageCount - 1);

  const start = safePage * perPage;
  const visible = items.slice(start, start + perPage);

  return (
    <section id="reviews" className="border-t border-border bg-secondary/25 py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-[1.5rem] leading-snug font-bold text-text-strong sm:text-[2rem]">실제로 써 본 사장님들의 이야기</h2>
          {pageCount > 1 ? (
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => go(safePage - 1)}
                aria-label="이전 후기"
                className="rounded-full border border-border bg-surface p-2 text-muted-foreground transition-colors hover:text-text-strong"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => go(safePage + 1)}
                aria-label="다음 후기"
                className="rounded-full border border-border bg-surface p-2 text-muted-foreground transition-colors hover:text-text-strong"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item, i) => (
            <Card key={`${safePage}-${i}`} item={item} />
          ))}
        </div>

        {pageCount > 1 ? (
          <div className="mt-6 flex justify-center gap-1.5">
            {Array.from({ length: pageCount }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => go(i)}
                aria-label={`${i + 1}번째 후기 묶음`}
                aria-current={i === safePage}
                className={cn("h-1.5 rounded-full transition-all", i === safePage ? "w-6 bg-primary" : "w-1.5 bg-border")}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
