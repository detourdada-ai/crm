import { MyDeliveriesList } from "@/components/delivery/my-deliveries-list";
import { PageHeader } from "@/components/common/page-header";
import { listMyDeliveriesAction } from "@/actions/delivery";
import { getMyShiftAction } from "@/actions/driver-shifts";
import { kstTodayIso } from "@/lib/utils/kst-date";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function DriverPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: rawDate } = await searchParams;
  const date = rawDate && ISO_DATE_RE.test(rawDate) ? rawDate : kstTodayIso();
  const [orders, shift] = await Promise.all([listMyDeliveriesAction(date), getMyShiftAction()]);

  return (
    <div className="space-y-6">
      <PageHeader title="내 배송" description="배정된 배송 목록입니다. 완료 후 배송완료 버튼을 눌러주세요." />

      <MyDeliveriesList key={date} orders={orders} initialShift={shift} selectedDate={date} />
    </div>
  );
}
