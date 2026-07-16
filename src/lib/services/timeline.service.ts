import "server-only";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { changeLogRepository } from "@/lib/repositories/change-log.repository";
import { formatCurrency } from "@/lib/constants/order-status";
import type { CustomerChangeLog } from "@/types/domain";

export type TimelineEventType =
  | "order"
  | "phone_change"
  | "address_change"
  | "merge"
  | "memo_change"
  | "info_change";

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  occurredAt: string;
  title: string;
  description: string;
  performedBy?: string;
}

function changeLogToEvent(log: CustomerChangeLog): TimelineEvent {
  const base = { id: `log-${log.id}`, occurredAt: log.created_at, performedBy: log.performed_by };

  if (log.entity === "customer_phone") {
    return { ...base, type: "phone_change", title: "전화번호 변경", description: `${log.old_value ?? "-"} → ${log.new_value ?? "-"}` };
  }
  if (log.entity === "customer_address") {
    return { ...base, type: "address_change", title: "주소 변경", description: `${log.old_value ?? "-"} → ${log.new_value ?? "-"}` };
  }
  if (log.entity === "customer_merge") {
    return { ...base, type: "merge", title: "고객 병합", description: `${log.old_value ?? "-"} → ${log.new_value ?? "-"}` };
  }
  if (log.field === "memo") {
    return { ...base, type: "memo_change", title: "메모 변경", description: `${log.old_value || "(없음)"} → ${log.new_value || "(없음)"}` };
  }
  return {
    ...base,
    type: "info_change",
    title: log.field ? `정보 변경 (${log.field})` : "정보 변경",
    description: `${log.old_value ?? "-"} → ${log.new_value ?? "-"}`,
  };
}

/** Unifies orders + all change-log entries into one chronological feed for the customer detail page. */
export async function getCustomerTimeline(customerId: string): Promise<TimelineEvent[]> {
  const [orders, logs] = await Promise.all([
    ordersRepository.findByCustomerId(customerId),
    changeLogRepository.listByCustomer(customerId),
  ]);

  const events: TimelineEvent[] = orders.map((order) => ({
    id: `order-${order.id}`,
    type: "order",
    occurredAt: order.order_date,
    title: `주문 ${order.order_number}`,
    description: `${formatCurrency(order.total_amount)} · ${order.status}`,
  }));

  events.push(...logs.map(changeLogToEvent));

  events.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  return events;
}
