/**
 * Phase 4-B: every "오늘/이번주/이번달" calendar-day boundary in this app is
 * meant in KST (Asia/Seoul), regardless of what timezone the Node process
 * itself runs in. The previous pattern (`now.getTimezoneOffset()` then
 * `new Date(dateStr); date.setHours(0,0,0,0)`) only produced correct KST
 * boundaries because the local dev machine's OS happened to be set to
 * Asia/Seoul — it would silently compute UTC boundaries instead on a
 * server whose OS timezone is UTC (e.g. a typical Vercel function), causing
 * KST-morning orders/deliveries to fall outside "오늘" by up to 9 hours.
 *
 * These helpers hardcode the +09:00 offset explicitly in the parsed string,
 * so the resulting UTC instant is correct no matter what timezone the
 * server process itself is running in.
 */
const KST_OFFSET = "+09:00";

/** Today's calendar date in KST as "YYYY-MM-DD", independent of server-local timezone. */
export function kstTodayIso(): string {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kstNow.toISOString().slice(0, 10);
}

/** The KST calendar day of an arbitrary ISO instant, as "YYYYMMDD" (no dashes) — used for 주문번호 채번(day_str). */
export function kstDayStrOf(isoInstant: string): string {
  const kst = new Date(new Date(isoInstant).getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, "");
}

/** The KST calendar day of an arbitrary ISO instant, as "YYYY-MM-DD" (dashed) — used wherever a delivery_groups.delivery_date-shaped key is needed (e.g. P15-A group-regeneration triggers). */
export function kstDayDateStrOf(isoInstant: string): string {
  const kst = new Date(new Date(isoInstant).getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** The UTC instant corresponding to 00:00:00.000 KST on the given "YYYY-MM-DD" calendar day. */
export function kstDayStartIso(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000${KST_OFFSET}`).toISOString();
}

/** The UTC instant corresponding to 23:59:59.999 KST on the given "YYYY-MM-DD" calendar day (inclusive end). */
export function kstDayEndIso(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59.999${KST_OFFSET}`).toISOString();
}

// Phase 5 STEP3: 주문일은 과거 위주(오늘/어제/이번주/지난주/이번달/전체),
// 배송일은 미래 위주(오늘/내일/이번주/다음주/이번달/전체)로 서로 다른 빠른
// 필터 세트를 쓴다 — 화면마다 실제로 쓰는 옵션만 QuickDateRange에 넘긴다.
export type QuickDateFilterValue =
  | "all"
  | "today"
  | "yesterday"
  | "tomorrow"
  | "week"
  | "lastWeek"
  | "nextWeek"
  | "month"
  | "custom";

export interface KstDateRange {
  start: string; // YYYY-MM-DD (KST calendar day)
  end: string; // YYYY-MM-DD (KST calendar day)
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return toDateString(date);
}

function weekRangeContaining(dateStr: string): KstDateRange {
  const [y, m, d] = dateStr.split("-").map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d));
  const day = ref.getUTCDay(); // 0 = Sunday
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(ref);
  monday.setUTCDate(ref.getUTCDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: toDateString(monday), end: toDateString(sunday) };
}

/** Resolves a quick filter into a KST calendar-day [start, end], both inclusive. Week is Mon–Sun. "all"/"custom" are not resolvable here (caller handles them). */
export function resolveKstQuickRange(
  filter: Exclude<QuickDateFilterValue, "all" | "custom">,
  referenceDateStr: string = kstTodayIso()
): KstDateRange {
  const [y, m] = referenceDateStr.split("-").map(Number);

  switch (filter) {
    case "today":
      return { start: referenceDateStr, end: referenceDateStr };
    case "yesterday": {
      const yDate = addDays(referenceDateStr, -1);
      return { start: yDate, end: yDate };
    }
    case "tomorrow": {
      const tDate = addDays(referenceDateStr, 1);
      return { start: tDate, end: tDate };
    }
    case "week":
      return weekRangeContaining(referenceDateStr);
    case "lastWeek": {
      const thisWeek = weekRangeContaining(referenceDateStr);
      return { start: addDays(thisWeek.start, -7), end: addDays(thisWeek.end, -7) };
    }
    case "nextWeek": {
      const thisWeek = weekRangeContaining(referenceDateStr);
      return { start: addDays(thisWeek.start, 7), end: addDays(thisWeek.end, 7) };
    }
    case "month": {
      const monthStart = new Date(Date.UTC(y, m - 1, 1));
      const monthEnd = new Date(Date.UTC(y, m, 0));
      return { start: toDateString(monthStart), end: toDateString(monthEnd) };
    }
  }
}

function toDateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** "2026.08.10 ~ 2026.08.16" style label for a resolved range (single day shows once). */
export function formatKstRangeLabel(range: KstDateRange): string {
  const fmt = (s: string) => s.replaceAll("-", ".");
  return range.start === range.end ? fmt(range.start) : `${fmt(range.start)} ~ ${fmt(range.end)}`;
}

// Phase 7 STEP2: shared KST-safe formatters for displaying an arbitrary UTC
// instant (e.g. tenants.created_at / access_expires_at) as a Korean date —
// used by beta welcome/expiration emails, subscription page, settings page.
// `Intl.DateTimeFormat` with an explicit `timeZone` is immune to server OS
// timezone, unlike `new Date(iso).getFullYear()/getHours()` (local getters).
const KST_TZ = "Asia/Seoul";

function kstDateParts(iso: string) {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** "2026년 08월 14일" — KST calendar date of an arbitrary ISO instant. */
export function formatKstDateKorean(iso: string): string {
  const { year, month, day } = kstDateParts(iso);
  return `${year}년 ${month}월 ${day}일`;
}

/** "2026년 08월 14일 09:00" — KST calendar date + time of an arbitrary ISO instant. */
export function formatKstDateTimeKorean(iso: string): string {
  const date = formatKstDateKorean(iso);
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${date} ${get("hour").padStart(2, "0")}:${get("minute")}`;
}

/** "2026.08.14" — KST calendar date of an arbitrary ISO instant. */
export function formatKstDateDotted(iso: string): string {
  const { year, month, day } = kstDateParts(iso);
  return `${year}.${month}.${day}`;
}

const ALL_QUICK_DATE_FILTER_VALUES: QuickDateFilterValue[] = [
  "all",
  "today",
  "yesterday",
  "tomorrow",
  "week",
  "lastWeek",
  "nextWeek",
  "month",
  "custom",
];

/** URL searchParams 값이 유효한 QuickDateFilterValue인지 확인하는 타입 가드 — Orders/Delivery 페이지에서 공용으로 쓴다. */
export function isQuickDateFilter(v: string | undefined): v is QuickDateFilterValue {
  return !!v && (ALL_QUICK_DATE_FILTER_VALUES as string[]).includes(v);
}

// Phase 8: moved here from quick-date-range.tsx (a "use client" module).
// orders/page.tsx (a Server Component) imported ORDER_DATE_QUICK_OPTIONS
// directly from that client module to build orderRangeLabel — Turbopack's
// dev-mode RSC boundary handling turned the imported array into an
// unusable client reference server-side, throwing
// "ORDER_DATE_QUICK_OPTIONS.find is not a function" and breaking 주문관리
// entirely (reproduced on a fresh dev server + fresh session, confirmed NOT
// a preview-tool artifact). Plain data used by both server and client code
// must live in a module with no "use client" directive.
export interface QuickDateOption {
  value: QuickDateFilterValue;
  label: string;
}

/** 주문일: 과거 위주, 기본이 전체(S1-3 — 배송일이 주 필터, 주문일은 보조). */
export const ORDER_DATE_QUICK_OPTIONS: QuickDateOption[] = [
  { value: "all", label: "전체" },
  { value: "today", label: "오늘" },
  { value: "yesterday", label: "어제" },
  { value: "week", label: "이번주" },
  { value: "lastWeek", label: "지난주" },
  { value: "month", label: "이번달" },
  { value: "custom", label: "기간선택" },
];

/** 배송일: 미래 위주, 기본이 오늘(S1-3 — "오늘 발송할 상품주문"이 주문관리의 기본 화면). */
export const DELIVERY_DATE_QUICK_OPTIONS: QuickDateOption[] = [
  { value: "today", label: "오늘" },
  { value: "tomorrow", label: "내일" },
  { value: "week", label: "이번주" },
  { value: "nextWeek", label: "다음주" },
  { value: "month", label: "이번달" },
  { value: "custom", label: "기간선택" },
  { value: "all", label: "전체" },
];
