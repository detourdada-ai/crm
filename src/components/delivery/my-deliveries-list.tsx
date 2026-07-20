"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, MapPin, Phone } from "lucide-react";
import { formatCurrency } from "@/lib/constants/order-status";
import { markDeliveredAction } from "@/actions/delivery";
import type { Order } from "@/types/domain";

function DeliveryCard({ order }: { order: Order }) {
  const [isPending, startTransition] = useTransition();

  function handleComplete() {
    startTransition(async () => {
      const result = await markDeliveredAction(order.id);
      if (!result.ok) toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
      else toast.success("배송완료로 처리했습니다.");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <div className="flex items-center justify-between">
          <p className="font-medium">{order.buyer_name ?? order.recipient_name}</p>
          <span className="text-sm text-muted-foreground">{formatCurrency(Number(order.total_amount))}</span>
        </div>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Phone className="size-3.5" />
          {order.phone_snapshot ?? "-"}
        </p>
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <MapPin className="mt-0.5 size-3.5 shrink-0" />
          {order.address_snapshot ?? "-"}
        </p>
        {order.delivery_memo ? <p className="text-sm text-muted-foreground">메모: {order.delivery_memo}</p> : null}
        <Button size="sm" className="mt-2 w-full gap-1.5" disabled={isPending} onClick={handleComplete}>
          <CheckCircle2 className="size-4" />
          {isPending ? "처리하는 중..." : "배송완료"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function MyDeliveriesList({ orders }: { orders: Order[] }) {
  if (orders.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">배정된 배송이 없습니다.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {orders.map((order) => (
        <DeliveryCard key={order.id} order={order} />
      ))}
    </div>
  );
}
