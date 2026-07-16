import Link from "next/link";
import { formatCurrency, formatDateTime } from "@/lib/constants/order-status";
import type { Order } from "@/types/domain";

export function RecentOrdersList({ orders }: { orders: Order[] }) {
  if (orders.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">최근 주문이 없습니다.</p>;
  }

  return (
    <ul className="space-y-2">
      {orders.map((order) => (
        <li key={order.id} className="flex items-center justify-between gap-2 border-b pb-2 text-sm last:border-0">
          <div className="min-w-0">
            <Link href={`/orders/${order.id}`} className="font-medium text-primary hover:underline">
              {order.order_number}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {order.recipient_name} · {formatDateTime(order.order_date)}
            </p>
          </div>
          <span className="shrink-0 font-medium">{formatCurrency(Number(order.total_amount))}</span>
        </li>
      ))}
    </ul>
  );
}
