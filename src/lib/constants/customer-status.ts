import type { CustomerStatus } from "@/types/domain";

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  active: "정상",
  dormant: "휴면",
  watchlist: "주의",
  blocked: "차단",
  // Set only by the 동일인 검토 merge flow — never manually selectable (see
  // CUSTOMER_STATUS_OPTIONS below, which intentionally omits it).
  merged: "병합됨",
};

export const CUSTOMER_STATUS_OPTIONS: { value: CustomerStatus; label: string }[] = [
  { value: "active", label: "정상" },
  { value: "dormant", label: "휴면" },
  { value: "watchlist", label: "주의" },
  { value: "blocked", label: "차단" },
];
