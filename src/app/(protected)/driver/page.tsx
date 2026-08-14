import { MyDeliveriesList } from "@/components/delivery/my-deliveries-list";
import { PageHeader } from "@/components/common/page-header";
import { listMyDeliveriesAction } from "@/actions/delivery";

export default async function DriverPage() {
  const orders = await listMyDeliveriesAction();

  return (
    <div className="space-y-6">
      <PageHeader title="내 배송" description="배정된 배송 목록입니다. 완료 후 배송완료 버튼을 눌러주세요." />

      <MyDeliveriesList orders={orders} />
    </div>
  );
}
