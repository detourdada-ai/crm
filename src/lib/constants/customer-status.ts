import type { CustomerStatus } from "@/types/domain";

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  active: "정상",
  dormant: "휴면",
  watchlist: "주의",
  blocked: "차단",
};

export const CUSTOMER_STATUS_OPTIONS: { value: CustomerStatus; label: string }[] = [
  { value: "active", label: "정상" },
  { value: "dormant", label: "휴면" },
  { value: "watchlist", label: "주의" },
  { value: "blocked", label: "차단" },
];
