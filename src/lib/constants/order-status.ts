export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  confirmed: "확정",
  shipped: "배송중",
  completed: "완료",
  cancelled: "취소",
};

export function formatCurrency(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

export function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("ko-KR");
}
