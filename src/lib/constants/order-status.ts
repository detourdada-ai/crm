export function formatCurrency(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

// Phase 7 STEP2: these two are used across every order/delivery/settlement/
// dashboard table in the app to render 주문일/배송일/타임스탬프. Without an
// explicit `timeZone`, `toLocaleString`/`toLocaleDateString` fall back to
// the JS runtime's default timezone — the server OS timezone for SSR pages,
// which is UTC on a typical Vercel deployment. That silently shifted every
// displayed date/time by up to 9 hours during the KST 00:00~09:00 window,
// the same bug class documented in kst-date.ts. Pinning `timeZone:
// "Asia/Seoul"` makes both immune to server OS timezone.
const KST_TZ = "Asia/Seoul";

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: KST_TZ });
}

export function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("ko-KR", { timeZone: KST_TZ });
}
