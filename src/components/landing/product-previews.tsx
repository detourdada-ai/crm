"use client";

/**
 * LANDING REPOSITIONING v1(CPO 작업지시, 2026-09-04) — 랜딩에서 쓰는 "실제 제품
 * 화면" 미리보기 모음. 예전에는 feature-showcase.tsx 안에 탭 UI와 함께 묶여
 * 있었는데, 새 랜딩은 이 화면들을 탭 뒤에 숨기지 않고 흐름 위에 크게 펼쳐
 * 보여주므로 화면 컴포넌트만 따로 뗀다. 내용(문구/수치)은 그대로 옮겼다 —
 * 제품에 없는 기능을 새로 그리지 않는다.
 */

import { useState } from "react";
import { Navigation, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ProductPreview, PreviewStat, PreviewTable, type PreviewTableRow } from "./product-preview";

const ORDER_ROWS: PreviewTableRow[] = [
  { order: "20260814-0031", customer: "김민수", item: "상품 A 외 1건", deliveryDate: "08.14(금)", status: "신규", statusTone: "primary", highlighted: true },
  { order: "20260814-0030", customer: "박지현", item: "상품 B", deliveryDate: "08.14(금)", status: "배송준비", statusTone: "success" },
  { order: "20260813-0029", customer: "이수진", item: "상품 C 외 2건", deliveryDate: "08.15(토)", status: "처리중", statusTone: "neutral" },
];

/** 실제 화면 — 주문관리. */
export function OrdersPreview() {
  return (
    <ProductPreview screen="주문관리">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-primary px-3 py-1.5 font-medium text-primary-foreground">전체</span>
        <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">신규</span>
        <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">처리중</span>
      </div>
      <div className="mt-4">
        <PreviewTable rows={ORDER_ROWS} />
      </div>
    </ProductPreview>
  );
}

const CUSTOMERS = [
  { name: "김민수", orders: "8회", total: "324,000원", lastOrder: "2026.08.12" },
  { name: "박지현", orders: "3회", total: "112,000원", lastOrder: "2026.08.09" },
];

/** 실제 화면 — 고객관리. */
export function CustomersPreview() {
  const [selected, setSelected] = useState(0);
  const customer = CUSTOMERS[selected];

  return (
    <ProductPreview screen="고객관리">
      <div className="flex gap-2">
        {CUSTOMERS.map((c, i) => (
          <button
            key={c.name}
            type="button"
            onClick={() => setSelected(i)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium",
              i === selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}
          >
            {c.name}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm font-semibold text-text-strong">{customer.name}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl border-2 border-primary/30 bg-primary-soft/30 px-4 py-3.5">
          <p className="text-xs text-muted-foreground">최근 주문</p>
          <p className="mt-1 text-2xl font-bold text-primary">{customer.orders}</p>
        </div>
        <div className="rounded-xl border-2 border-primary/30 bg-primary-soft/30 px-4 py-3.5">
          <p className="text-xs text-muted-foreground">누적 구매</p>
          <p className="mt-1 text-2xl font-bold text-primary">{customer.total}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">최근 주문 · {customer.lastOrder}</p>
      <Button size="sm" variant="outline" className="mt-3 h-8 w-full">
        주문 이력 보기
      </Button>
    </ProductPreview>
  );
}

const DRIVERS = ["홍길동", "김철수", "이영희"];

/**
 * STEP12-5(CPO 작업지시, 2026-08-31) — 배송관리는 가장 중요한 화면이므로
 * 실제 STEP11-13/11-14에서 만든 핵심 UX(배송 그룹, 체크박스 일괄 배정,
 * 가방번호, "변경사항 저장" Draft 흐름)가 랜딩에서도 그대로 드러나야 한다.
 * 실제 화면에서 쓰는 문구를 그대로 재사용한다("이 그룹 N건 선택", "선택한
 * N건 일괄 적용", "변경사항 N건 저장하지 않으면 반영되지 않습니다").
 */
export function DeliveryPreview() {
  const [assignOpen, setAssignOpen] = useState(false);
  const [driver, setDriver] = useState("홍길동");
  const [groupChecked, setGroupChecked] = useState(true);

  return (
    <ProductPreview screen="배송관리">
      <div className="grid grid-cols-3 gap-2 text-center">
        <PreviewStat label="배송 대기" value="8" />
        <PreviewStat label="배송중" value="5" />
        <PreviewStat label="완료" value="21" />
      </div>

      <div className="mt-4 rounded-xl border border-border bg-surface p-3.5">
        <p className="text-xs font-medium text-muted-foreground">서초구 반포동 · 같은 배송지로 3건 묶였습니다</p>
        <label className="mt-2 flex items-center gap-2 text-xs font-medium text-text-strong">
          <Checkbox checked={groupChecked} onCheckedChange={(v) => setGroupChecked(v === true)} />이 그룹 3건 선택
        </label>
        {groupChecked ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary-soft/60 px-3 py-2 text-xs">
            <span className="font-semibold text-primary">3건 선택</span>
            <span className="text-muted-foreground">담당 기사 이영희 ▾</span>
            <Button size="sm" className="ml-auto h-7 px-2.5 text-[11px]">
              선택한 3건 일괄 적용
            </Button>
          </div>
        ) : null}
      </div>

      <div className="relative mt-3 rounded-xl border-2 border-primary/30 bg-primary-soft/30 p-4">
        <p className="text-xs font-medium text-muted-foreground">김민수 · 상품 A 외 1건</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="text-text-strong">
            담당기사: <span className="font-semibold text-primary">{driver}</span>
          </span>
          <span className="flex items-center gap-1.5 text-text-strong">
            가방번호 <span className="rounded-md border border-input bg-surface px-2 py-0.5 text-xs font-semibold">12</span>
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">미회수</span>
        </div>
        <Button size="sm" variant="outline" className="mt-3 h-8 w-full" onClick={() => setAssignOpen((v) => !v)}>
          담당기사 변경
        </Button>

        {assignOpen ? (
          <div className="animate-in fade-in-0 slide-in-from-top-1 absolute inset-x-4 top-full z-10 mt-1 rounded-xl border border-border bg-surface p-2 shadow-lg duration-200">
            {DRIVERS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setDriver(name);
                  setAssignOpen(false);
                }}
                className={cn(
                  "block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary",
                  name === driver ? "font-semibold text-primary" : "text-text-strong"
                )}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warning-soft px-3.5 py-2.5 text-xs">
        <span className="font-medium text-text-strong">변경사항 4건 저장하지 않으면 반영되지 않습니다</span>
        <Button size="sm" className="h-7 px-3 text-[11px]">
          변경사항 저장
        </Button>
      </div>
    </ProductPreview>
  );
}

/**
 * 실제 화면 — 기사 앱(현재/다음 배송 카드 + 배송완료 버튼 + 운행 시작/종료).
 * 실제 고객 개인정보는 절대 사용하지 않고, 다른 화면과 동일하게 가상값만 쓴다.
 */
export function DriverAppPreview() {
  const [running, setRunning] = useState(false);

  return (
    <ProductPreview screen="기사 앱">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">오늘 배송 5건 · 남음 3건</p>
        <Button size="sm" variant={running ? "outline" : "default"} className="h-7 gap-1.5 text-xs" onClick={() => setRunning((v) => !v)}>
          <Play className="size-3" />
          {running ? "운행중" : "운행 시작"}
        </Button>
      </div>

      <div className="mt-3 rounded-xl border-2 border-primary/30 bg-primary-soft/30 p-4">
        <p className="text-xs font-semibold text-primary">현재 배송</p>
        <p className="mt-2 text-sm font-medium text-text-strong">김민수 · 상품 A 외 1건</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Navigation className="size-3" />
          서울시 강남구 ○○로 12
        </p>
        <Button size="sm" className="mt-3 h-8 w-full">
          배송완료
        </Button>
      </div>

      <div className="mt-2 rounded-xl border border-border bg-surface p-4">
        <p className="text-xs font-semibold text-muted-foreground">다음 배송</p>
        <p className="mt-2 text-sm font-medium text-text-strong">박지현 · 상품 B</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Navigation className="size-3" />
          서울시 강남구 ○○로 45
        </p>
      </div>
    </ProductPreview>
  );
}

const DRIVER_LOCATIONS = [
  { name: "홍길동", status: "운행중", updated: "2분 전" },
  { name: "김철수", status: "운행중", updated: "5분 전" },
  { name: "이영희", status: "운행종료", updated: "32분 전" },
];

/**
 * 실제 화면 — 배송 현황(60초 자동 갱신 + "운행중 · N분 전" 최신성 표시).
 * "실시간 관제/GPS 추적"이라는 표현은 절대 쓰지 않는다 — 실제로는 주기적
 * 갱신 + 마지막 갱신 시각 표시 구조이기 때문이다(§CPO 원칙).
 */
export function DeliveryStatusPreview() {
  return (
    <ProductPreview screen="배송 현황">
      <div className="grid grid-cols-3 gap-2 text-center">
        <PreviewStat label="배송 대기" value="8" />
        <PreviewStat label="배송중" value="5" />
        <PreviewStat label="완료" value="21" />
      </div>
      <div className="mt-4 space-y-2">
        {DRIVER_LOCATIONS.map((d) => (
          <div key={d.name} className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3">
            <p className="text-sm font-medium text-text-strong">{d.name}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={d.status === "운행중" ? "font-semibold text-primary" : ""}>{d.status}</span>
              <span>· {d.updated}</span>
            </p>
          </div>
        ))}
      </div>
    </ProductPreview>
  );
}

const SETTLEMENTS = [
  { key: "a", primary: "김기사 · 배송 42건", secondary: "이번 달 정산", steps: ["배송완료", "정산대상", "정산완료"], activeIndex: 2, amount: "₩1,260,000" },
  { key: "b", primary: "이기사 · 배송 31건", secondary: "이번 달 정산", steps: ["배송완료", "정산대상", "정산완료"], activeIndex: 1, amount: "₩930,000" },
];

/** 실제 화면 — 정산관리(배송완료→정산대상→정산완료 흐름 + 지급 확정/기사별 이력). */
export function SettlementPreview() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <ProductPreview screen="정산관리">
      <div className="grid grid-cols-2 gap-3">
        <PreviewStat label="정산 대기" value="₩1,240,000" />
        <PreviewStat label="정산 완료" value="₩3,820,000" />
      </div>
      <div className="mt-4">
        {SETTLEMENTS.map((row) => (
          <div key={row.key}>
            <button type="button" onClick={() => setSelected(row.key === selected ? null : row.key)} className="block w-full text-left">
              <div className="flex items-center justify-between gap-3 border-b border-border py-3 text-sm last:border-0">
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-strong">{row.primary}</p>
                  <p className="truncate text-xs text-muted-foreground">{row.secondary}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {row.steps.map((step, i) => (
                    <span
                      key={step}
                      className={cn(
                        "rounded-full px-2 py-1 text-[11px] font-medium",
                        i === row.activeIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground/70"
                      )}
                    >
                      {step}
                    </span>
                  ))}
                </div>
              </div>
            </button>
            {selected === row.key ? (
              <div className="animate-in fade-in-0 slide-in-from-top-1 mb-2 rounded-xl border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground duration-200">
                이번 달 정산 금액 · <span className="font-semibold text-text-strong">{row.amount}</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">정산 완료 처리 시 정산일과 금액을 직접 확정하고, 기사별 일별 이력도 확인할 수 있습니다.</p>
    </ProductPreview>
  );
}
