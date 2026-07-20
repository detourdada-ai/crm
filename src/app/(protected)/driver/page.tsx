import { MyDeliveriesList } from "@/components/delivery/my-deliveries-list";
import { listMyDeliveriesAction } from "@/actions/delivery";

export default async function DriverPage() {
  const orders = await listMyDeliveriesAction();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">내 배송</h1>
        <p className="text-sm text-muted-foreground">배정된 배송 목록입니다. 완료 후 배송완료 버튼을 눌러주세요.</p>
      </div>

      <MyDeliveriesList orders={orders} />
    </div>
  );
}
