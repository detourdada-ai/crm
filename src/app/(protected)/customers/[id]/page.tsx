import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCustomerDetailAction } from "@/actions/customers";
import { CustomerEditForm } from "@/components/customers/customer-edit-form";
import { CustomerStatsCards } from "@/components/customers/customer-stats-cards";
import { CustomerChangeHistory } from "@/components/customers/customer-change-history";
import { OrderTable } from "@/components/orders/order-table";
import { BackButton } from "@/components/common/back-button";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getCustomerDetailAction(id);
  if (!detail) notFound();

  const { customer, stats, orders, changeLogs } = detail;

  return (
    <div className="space-y-6">
      <BackButton fallbackHref="/customers" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{customer.name}</h1>
        <Badge variant="outline">{customer.customer_code}</Badge>
        {customer.tags.map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
          </Badge>
        ))}
      </div>

      <CustomerStatsCards stats={stats} />

      <Card>
        <CardHeader>
          <CardTitle>고객 정보</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerEditForm customer={customer} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>주문목록</CardTitle>
        </CardHeader>
        <CardContent>
          <OrderTable orders={orders} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>변경이력</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerChangeHistory logs={changeLogs} />
        </CardContent>
      </Card>
    </div>
  );
}
