import { Card, CardContent } from "@/components/ui/card";
import { DeliveryBoard } from "@/components/delivery/delivery-board";
import { DeliveryDatePicker } from "@/components/delivery/delivery-date-picker";
import { DriverManagementDialog } from "@/components/delivery/driver-management-dialog";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { getDeliveryBoardAction } from "@/actions/delivery";
import { listDriversAction } from "@/actions/drivers";
import { requireSession } from "@/lib/auth/current-session";
import { listAccounts } from "@/lib/auth/credentials";
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

  const [session, { orders, drivers }, allDrivers, accounts] = await Promise.all([
    requireSession(),
    getDeliveryBoardAction(selectedDate),
    listDriversAction(),
    listAccounts(),
  ]);
  const isAdmin = session.role === "admin";
  const accountUsernames = accounts.filter((a) => a.role !== "driver").map((a) => a.username);

  const inProgressCount = orders.filter((o) => o.delivery_status === "배송중").length;
  const doneCount = orders.filter((o) => o.delivery_status === "완료").length;
  const needsDriverCount = orders.filter((o) => !o.driver_id).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="배송"
        description="오늘 배송을 확인하고 기사에게 배정하세요."
        action={<DriverManagementDialog drivers={allDrivers} isAdmin={isAdmin} accountUsernames={accountUsernames} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="오늘 배송" value={orders.length} cta="전체 보기" href="#board" />
        <KpiCard label="배정 필요" value={needsDriverCount} cta="배정하기" href="#board" />
        <KpiCard label="배송중" value={inProgressCount} cta="확인" href="#board" />
        <KpiCard label="완료" value={doneCount} cta="확인" href="#board" />
      </div>

      <Card id="board">
        <CardContent className="space-y-4 pt-6">
          <DeliveryDatePicker date={selectedDate} />
          <DeliveryBoard orders={orders} drivers={drivers} />
        </CardContent>
      </Card>
    </div>
  );
}
