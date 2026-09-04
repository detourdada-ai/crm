/**
 * LANDING v3(CPO 작업지시, 2026-09-05) — 랜딩용 제품 화면.
 *
 * v2까지의 `product-previews.tsx`는 3행짜리 축약 목업이라 아무리 크게 놓아도
 * "랜딩용으로 그린 예시 화면"으로 보였다. v3는 **실제 앱과 같은 정보 구조**
 * (좌측 네비게이션 · 상단 헤더 · 검색/기간/상태 필터 · 실제 컬럼 · 실제 상태값)로
 * 다시 만든다. 목표는 화면을 크게 만드는 게 아니라 **정보 밀도**로 "실제 운영
 * 시스템"이라는 인식을 만드는 것이다.
 *
 * 지키는 선:
 * - 실제 제품에 있는 화면·기능·정보 구조만 그린다. 없는 AI/자동화/대시보드
 *   그래프/성과 수치는 만들지 않는다.
 * - 네비게이션 라벨은 `src/lib/constants/nav.ts`, 주문 컬럼은
 *   `orders/order-table.tsx`, 배송 문구는 `delivery-board.tsx`의 실제 값이다.
 * - 예시 데이터는 반찬가게 맥락으로 현실화하되, 전화번호와 상세 주소처럼
 *   개인정보로 보이는 값은 만들지 않는다(구/동 단위까지만).
 *
 * 모바일은 데스크톱의 축소판이 아니다 — 사이드바를 없애고 컬럼과 행 수를 줄인
 * "모바일 제품 뷰"로 바꾼다(가로 스크롤 없음).
 */

import { BarChart3, LayoutDashboard, Search, Settings, ShoppingCart, Truck, Users, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "대시보드", icon: LayoutDashboard },
  { label: "주문관리", icon: ShoppingCart },
  { label: "배송관리", icon: Truck },
  { label: "고객관리", icon: Users },
  { label: "정산관리", icon: Wallet },
  { label: "통계", icon: BarChart3 },
  { label: "설정", icon: Settings },
];

/** 실제 앱 셸 — 좌측 네비 + 상단 헤더. 모바일에서는 네비를 접고 헤더만 남긴다. */
export function AppFrame({
  active,
  title,
  children,
  className,
}: {
  active: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-surface shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]", className)}>
      <div className="flex">
        <aside className="hidden w-40 shrink-0 border-r border-border bg-secondary/40 p-2.5 lg:block">
          <p className="px-2 pb-2 text-[11px] font-bold text-primary">주문:한장</p>
          {NAV.map((item) => (
            <div
              key={item.label}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium",
                item.label === active ? "bg-primary-soft text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </div>
          ))}
        </aside>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-xs font-bold text-text-strong sm:text-sm">{title}</p>
            <div className="flex items-center gap-1.5">
              <span className="hidden rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground sm:inline">
                오늘 2026.09.05
              </span>
              <span className="size-5 rounded-full bg-primary-soft text-center text-[10px] leading-5 font-bold text-primary">반</span>
            </div>
          </div>
          <div className="p-2.5 sm:p-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

function FilterBar({ chips, active }: { chips: string[]; active: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground sm:max-w-[180px]">
        <Search className="size-3" />
        구매자·주문번호 검색
      </span>
      <span className="rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground">오늘</span>
      {chips.map((chip) => (
        <span
          key={chip}
          className={cn(
            "rounded-md px-2 py-1.5 text-[11px] font-medium",
            chip === active ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
          )}
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

type Tone = "wait" | "ing" | "done";
const TONE: Record<Tone, string> = {
  wait: "bg-secondary text-muted-foreground",
  ing: "bg-primary-soft text-primary",
  done: "bg-emerald-50 text-emerald-700",
};

const ORDERS: { no: string; buyer: string; item: string; date: string; qty: number; status: string; tone: Tone; mobile?: boolean }[] = [
  { no: "20260905-0042", buyer: "김영희", item: "수제 반찬 5종 세트", date: "09.05(금)", qty: 1, status: "배송대기", tone: "wait", mobile: true },
  { no: "20260905-0041", buyer: "박지은", item: "제육볶음 500g 외 1건", date: "09.05(금)", qty: 2, status: "배송대기", tone: "wait", mobile: true },
  { no: "20260905-0040", buyer: "이수진", item: "주간 반찬 정기배송", date: "09.05(금)", qty: 1, status: "배송중", tone: "ing", mobile: true },
  { no: "20260905-0039", buyer: "정민호", item: "소불고기 500g", date: "09.05(금)", qty: 1, status: "배송중", tone: "ing", mobile: true },
  { no: "20260905-0038", buyer: "한서연", item: "깻잎장아찌 외 2건", date: "09.05(금)", qty: 3, status: "완료", tone: "done", mobile: true },
  { no: "20260905-0037", buyer: "김영희", item: "제육볶음 500g", date: "09.05(금)", qty: 1, status: "완료", tone: "done" },
  { no: "20260904-0036", buyer: "오세라", item: "수제 반찬 5종 세트", date: "09.04(목)", qty: 2, status: "완료", tone: "done" },
  { no: "20260904-0035", buyer: "박지은", item: "주간 반찬 정기배송", date: "09.04(목)", qty: 1, status: "완료", tone: "done" },
  { no: "20260904-0034", buyer: "장현우", item: "소불고기 500g 외 1건", date: "09.04(목)", qty: 2, status: "완료", tone: "done" },
  { no: "20260904-0033", buyer: "이수진", item: "깻잎장아찌", date: "09.04(목)", qty: 1, status: "완료", tone: "done" },
  { no: "20260904-0032", buyer: "윤가영", item: "수제 반찬 5종 세트", date: "09.04(목)", qty: 1, status: "완료", tone: "done" },
  { no: "20260903-0031", buyer: "정민호", item: "주간 반찬 정기배송", date: "09.03(수)", qty: 1, status: "완료", tone: "done" },
];

/** 실제 화면 — 주문관리. 컬럼 구성은 orders/order-table.tsx와 같다. */
export function OrdersScreen({ className }: { className?: string }) {
  return (
    <AppFrame active="주문관리" title="주문관리" className={className}>
      <FilterBar chips={["전체", "배송대기", "배송중", "완료"]} active="전체" />
      <div className="mt-2.5 overflow-hidden rounded-lg border border-border">
        <table className="w-full table-fixed border-collapse text-left">
          <thead>
            <tr className="bg-secondary/50 text-[11px] text-muted-foreground sm:text-[10px]">
              <th className="hidden px-2 py-1.5 font-medium sm:table-cell sm:w-[24%]">주문번호</th>
              <th className="w-[22%] px-2 py-1.5 font-medium sm:w-[14%]">구매자</th>
              <th className="px-2 py-1.5 font-medium">상품명</th>
              <th className="hidden px-2 py-1.5 font-medium md:table-cell md:w-[14%]">배송일</th>
              <th className="hidden px-2 py-1.5 text-right font-medium lg:table-cell lg:w-[8%]">수량</th>
              <th className="w-[26%] px-2 py-1.5 font-medium sm:w-[14%]">상태</th>
            </tr>
          </thead>
          <tbody>
            {ORDERS.map((row) => (
              <tr key={row.no} className={cn("border-t border-border text-[12px] sm:text-[11px]", !row.mobile && "hidden sm:table-row")}>
                <td className="hidden px-2 py-1.5 font-mono text-[11px] text-muted-foreground sm:text-[10px] sm:table-cell">{row.no}</td>
                <td className="truncate px-2 py-1.5 font-medium text-text-strong">{row.buyer}</td>
                <td className="truncate px-2 py-1.5 text-muted-foreground">{row.item}</td>
                <td className="hidden px-2 py-1.5 text-muted-foreground md:table-cell">{row.date}</td>
                <td className="hidden px-2 py-1.5 text-right text-muted-foreground lg:table-cell">{row.qty}</td>
                <td className="px-2 py-1.5">
                  <span className={cn("inline-block rounded-full px-1.5 py-0.5 text-[11px] font-medium sm:text-[10px]", TONE[row.tone])}>{row.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">엑셀 업로드로 들어온 주문과 직접 등록한 주문이 같은 목록에 있습니다.</p>
    </AppFrame>
  );
}

const CUSTOMER_LIST = [
  { name: "김영희", region: "성남시 분당구", orders: 12, last: "09.05" },
  { name: "박지은", region: "수원시 영통구", orders: 7, last: "09.05" },
  { name: "이수진", region: "서울 강동구", orders: 5, last: "09.05" },
  { name: "정민호", region: "용인시 수지구", orders: 4, last: "09.05" },
  { name: "한서연", region: "성남시 수정구", orders: 2, last: "09.05" },
];

const CUSTOMER_HISTORY = [
  { date: "2026.09.05", item: "수제 반찬 5종 세트", amount: "38,000원" },
  { date: "2026.08.29", item: "제육볶음 500g 외 1건", amount: "24,000원" },
  { date: "2026.08.22", item: "주간 반찬 정기배송", amount: "45,000원" },
  { date: "2026.08.15", item: "수제 반찬 5종 세트", amount: "38,000원" },
];

/** 실제 화면 — 고객관리(목록 + 선택 고객 상세). */
export function CustomersScreen({ className }: { className?: string }) {
  return (
    <AppFrame active="고객관리" title="고객관리" className={className}>
      <div className="grid gap-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="hidden overflow-hidden rounded-lg border border-border md:block">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5 text-[11px] text-muted-foreground">
            <Search className="size-3" />
            고객 검색
          </div>
          {CUSTOMER_LIST.map((c, i) => (
            <div
              key={c.name}
              className={cn(
                "flex items-center justify-between border-b border-border px-2 py-1.5 text-[11px] last:border-b-0",
                i === 0 && "bg-primary-soft/40"
              )}
            >
              <span>
                <span className="font-medium text-text-strong">{c.name}</span>
                <span className="ml-1.5 text-[10px] text-muted-foreground">{c.region}</span>
              </span>
              <span className="text-[10px] text-muted-foreground">주문 {c.orders}회</span>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border p-2.5">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-bold text-text-strong">김영희</p>
            <span className="text-[10px] text-muted-foreground">성남시 분당구</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
            {[
              { label: "주문", value: "12회" },
              { label: "누적", value: "412,000원" },
              { label: "최근", value: "09.05" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-md bg-secondary/50 px-1.5 py-1.5">
                <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                <p className="text-[11px] font-bold text-text-strong">{stat.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[10px] font-medium text-muted-foreground">주문 이력</p>
          <div className="mt-1 overflow-hidden rounded-md border border-border">
            {CUSTOMER_HISTORY.map((h) => (
              <div key={h.date} className="flex items-center justify-between border-b border-border px-2 py-1.5 text-[12px] last:border-b-0 sm:text-[11px]">
                <span className="text-muted-foreground">{h.date}</span>
                <span className="mx-2 min-w-0 flex-1 truncate text-text-strong">{h.item}</span>
                <span className="text-muted-foreground">{h.amount}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 rounded-md border border-primary/30 bg-primary-soft/30 px-2 py-1.5 text-[10px] leading-relaxed text-primary">
            같은 사람으로 보이는 주문이 있습니다 — 확인 후 연결할 수 있습니다.
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

const DELIVERY_GROUPS = [
  {
    group: "성남시 분당구 · 3건",
    driver: "홍기사",
    rows: [
      { name: "김영희", item: "수제 반찬 5종 세트", bag: "12" },
      { name: "정민호", item: "소불고기 500g", bag: "12" },
      { name: "윤가영", item: "수제 반찬 5종 세트", bag: "13" },
    ],
  },
  {
    group: "수원시 영통구 · 2건",
    driver: "이기사",
    rows: [
      { name: "박지은", item: "제육볶음 500g 외 1건", bag: "21" },
      { name: "오세라", item: "주간 반찬 정기배송", bag: "21" },
    ],
  },
];

/** 실제 화면 — 배송관리(배송그룹 · 기사 배정 · 가방번호 · 변경사항 저장). */
export function DeliveryScreen({ className }: { className?: string }) {
  return (
    <AppFrame active="배송관리" title="배송관리" className={className}>
      <FilterBar chips={["전체", "미배정", "홍기사", "이기사"]} active="전체" />
      <div className="mt-2.5 flex items-center justify-between rounded-md bg-secondary/50 px-2 py-1.5 text-[11px]">
        <span className="text-muted-foreground">전체 선택(5건)</span>
        <span className="flex items-center gap-1.5">
          <span className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] text-muted-foreground">담당 기사 선택</span>
          <span className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground">일괄 적용</span>
        </span>
      </div>

      <div className="mt-2 space-y-2">
        {DELIVERY_GROUPS.map((g) => (
          <div key={g.group} className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between bg-secondary/40 px-2 py-1.5">
              <span className="text-[11px] font-medium text-text-strong">{g.group}</span>
              <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-[10px] text-muted-foreground">{g.driver}</span>
            </div>
            {g.rows.map((r) => (
              <div key={r.name} className="flex items-center gap-2 border-t border-border px-2 py-1.5 text-[12px] sm:text-[11px]">
                <span className="size-3 shrink-0 rounded-sm border border-muted-foreground/40" />
                <span className="w-12 shrink-0 font-medium text-text-strong">{r.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.item}</span>
                <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  가방 {r.bag}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between rounded-md border border-primary/40 bg-primary-soft/40 px-2 py-1.5">
        <span className="text-[10px] leading-relaxed text-primary">변경사항 5건 — 저장하지 않으면 반영되지 않습니다</span>
        <span className="shrink-0 rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground">변경사항 저장</span>
      </div>
    </AppFrame>
  );
}

/** 배송관리의 결과 — 기사에게 전달된 화면(별도 대형 섹션으로 두지 않는다). */
export function DriverPhone({ className }: { className?: string }) {
  return (
    <div className={cn("w-[210px] overflow-hidden rounded-[1.6rem] border-4 border-text-strong/85 bg-surface shadow-xl", className)}>
      <div className="bg-text-strong/85 py-1 text-center text-[10px] font-medium text-white">내 배송 · 홍기사</div>
      <div className="space-y-1.5 p-2">
        <div className="rounded-md bg-primary-soft/50 px-2 py-1.5">
          <p className="text-[10px] text-primary">1 / 3 · 성남시 분당구</p>
          <p className="text-[11px] font-bold text-text-strong">김영희 · 가방 12</p>
        </div>
        {[
          { n: "2", name: "정민호", bag: "12" },
          { n: "3", name: "윤가영", bag: "13" },
        ].map((s) => (
          <div key={s.n} className="rounded-md border border-border px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground">{s.n} / 3 · 성남시 분당구</p>
            <p className="text-[11px] font-medium text-text-strong">
              {s.name} · 가방 {s.bag}
            </p>
          </div>
        ))}
        <div className="rounded-md bg-primary py-1.5 text-center text-[11px] font-medium text-primary-foreground">배송완료</div>
      </div>
    </div>
  );
}

/** 실제 화면 — 엑셀 주문 접수(가져올 주문 범위 → 분석 결과). STEP14에서 추가된
 *  "오늘 주문만 가져오기" 기본 설정까지 실제 화면 그대로 보여준다. */
export function ImportScreen({ className }: { className?: string }) {
  return (
    <AppFrame active="주문관리" title="주문 엑셀 접수" className={className}>
      <div className="rounded-lg border border-dashed border-border bg-secondary/30 px-3 py-3 text-center">
        <p className="text-[11px] font-medium text-text-strong">스마트스토어_주문_20260905.xlsx</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">상품행 48개 · 주문 묶음 31건 인식</p>
      </div>

      <p className="mt-2.5 text-[11px] font-medium text-text-strong">가져올 주문 범위</p>
      <div className="mt-1.5 space-y-1.5">
        {[
          { title: "오늘 주문 가져오기", desc: "오늘 처리할 주문만 가져옵니다.", on: true },
          { title: "특정 날짜 주문 가져오기", desc: "선택한 날짜의 주문만 가져옵니다.", on: false },
          { title: "전체 주문 가져오기", desc: "엑셀에 포함된 누적 주문을 모두 확인합니다.", on: false },
        ].map((o) => (
          <div
            key={o.title}
            className={cn(
              "flex gap-2 rounded-md border px-2 py-1.5",
              o.on ? "border-primary bg-primary-soft/30" : "border-border"
            )}
          >
            <span className={cn("mt-0.5 size-3 shrink-0 rounded-full border", o.on ? "border-4 border-primary" : "border-muted-foreground/40")} />
            <span className="min-w-0">
              <span className="block text-[11px] font-medium text-text-strong">{o.title}</span>
              <span className="block truncate text-[10px] text-muted-foreground">{o.desc}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="mt-2.5 rounded-md border border-border bg-secondary/30 px-2 py-2">
        <p className="text-[10px] text-muted-foreground">
          이번에 가져온 주문 범위 <span className="ml-1 rounded bg-surface px-1.5 py-0.5 font-medium text-text-strong">오늘 주문</span>
        </p>
        <p className="mt-1 text-[11px] text-text-strong">신규 12건 · 이미 등록 19건 · 날짜 조건 제외 17건</p>
      </div>
    </AppFrame>
  );
}
