import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listVipCustomersAction, listReorderDueCustomersAction } from "@/actions/stats";
import { VipCustomerTable } from "@/components/stats/vip-customer-table";
import { ReorderDueTable } from "@/components/stats/reorder-due-table";

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const [vipCustomers, reorderDue] = await Promise.all([
    listVipCustomersAction(),
    listReorderDueCustomersAction(),
  ]);

  const defaultTab = tab === "reorder" ? "reorder" : "vip";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">통계</h1>
        <p className="text-sm text-muted-foreground">VIP 고객과 재주문이 임박한 고객을 확인할 수 있습니다.</p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="vip">VIP 고객 ({vipCustomers.length})</TabsTrigger>
          <TabsTrigger value="reorder">재주문 임박 ({reorderDue.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="vip">
          <Card>
            <CardHeader>
              <CardTitle>VIP 고객</CardTitle>
              <CardDescription>
                총 구매금액 또는 주문횟수 기준. 기준값은 [설정] 화면에서 변경할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VipCustomerTable customers={vipCustomers} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="reorder">
          <Card>
            <CardHeader>
              <CardTitle>재주문 임박 고객</CardTitle>
              <CardDescription>
                고객마다 실제 주문 간격(평균 주기)을 계산해, 그 주기를 이미 넘겼는데 재주문이 없는 고객만
                보여줍니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ReorderDueTable customers={reorderDue} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>준비 중인 기능</CardTitle>
          <CardDescription>문자 발송(재주문 알림/프로모션)은 외부 연동이 필요해 추후 진행됩니다.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
