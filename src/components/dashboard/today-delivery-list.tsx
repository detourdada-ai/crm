import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DELIVERY_STATUS_BADGE_VARIANT } from "@/lib/constants/delivery-status";
import type { Order } from "@/types/domain";

/** Read-only preview of today's deliveries for the Dashboard action center — full management stays on /delivery. */
export function TodayDeliveryList({ orders }: { orders: Order[] }) {
  if (orders.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">오늘 예정된 배송이 없습니다.</p>;
  }

  return (
    <ul className="space-y-2">
      {orders.slice(0, 5).map((order) => (
        <li key={order.id} className="flex items-center justify-between gap-2 border-b pb-2 text-sm last:border-0">
          <div className="min-w-0">
            <Link href={`/orders/${order.id}`} className="font-medium text-primary hover:underline">
              {order.buyer_name ?? order.recipient_name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">{order.address_snapshot ?? "-"}</p>
          </div>
          <Badge variant={DELIVERY_STATUS_BADGE_VARIANT[order.delivery_status]} className="shrink-0">
            {order.delivery_status}
          </Badge>
        </li>
      ))}
      {orders.length > 5 ? (
        <li>
          <Link href="/delivery" className="text-xs text-primary hover:underline">
            +{orders.length - 5}건 더 보기
          </Link>
        </li>
      ) : null}
    </ul>
  );
}
