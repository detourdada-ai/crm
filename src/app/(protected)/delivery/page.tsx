import { Card, CardContent } from "@/components/ui/card";
import { DeliveryBoard } from "@/components/delivery/delivery-board";
import { DeliveryDatePicker } from "@/components/delivery/delivery-date-picker";
import { PageHeader } from "@/components/common/page-header";
import { getDeliveryBoardAction } from "@/actions/delivery";
import { isValidDateString } from "@/lib/utils/date";

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
  const selectedDate = isValidDateString(date) ? date : todayIso();

  const { orders, drivers } = await getDeliveryBoardAction(selectedDate);

  return (
    <div className="space-y-6">
      <PageHeader title="배송관리" description="오늘 배송해야 할 주문을 확인하고 관리하세요." />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <DeliveryDatePicker date={selectedDate} />
          <DeliveryBoard orders={orders} drivers={drivers} />
        </CardContent>
      </Card>
    </div>
  );
}
