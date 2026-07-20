import { Card, CardContent } from "@/components/ui/card";
import { DeliveryBoard } from "@/components/delivery/delivery-board";
import { DeliveryDatePicker } from "@/components/delivery/delivery-date-picker";
import { getDeliveryBoardAction } from "@/actions/delivery";

function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const selectedDate = date || todayIso();

  const { orders, drivers } = await getDeliveryBoardAction(selectedDate);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">배송관리</h1>
        <p className="text-sm text-muted-foreground">배송일 기준으로 주문을 확인하고 담당 기사를 배정합니다.</p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <DeliveryDatePicker date={selectedDate} />
          <DeliveryBoard orders={orders} drivers={drivers} />
        </CardContent>
      </Card>
    </div>
  );
}
