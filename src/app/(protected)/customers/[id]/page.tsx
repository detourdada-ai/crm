import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCustomerDetailAction } from "@/actions/customers";
import { CustomerEditForm } from "@/components/customers/customer-edit-form";
import { CustomerStatsCards } from "@/components/customers/customer-stats-cards";
import { CustomerChangeHistory } from "@/components/customers/customer-change-history";
import { CustomerTimeline } from "@/components/customers/customer-timeline";
import { CustomerFavoriteButton } from "@/components/customers/customer-favorite-button";
import { OrderTable } from "@/components/orders/order-table";
import { BackButton } from "@/components/common/back-button";
import { CUSTOMER_STATUS_LABELS } from "@/lib/constants/customer-status";
import type { CustomerStatus } from "@/types/domain";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getCustomerDetailAction(id);
  if (!detail) notFound();

  const { customer, stats, orders, changeLogs, timeline, isVip, mergedIntoCustomer } = detail;

  return (
    <div className="space-y-6">
      <BackButton fallbackHref="/customers" />

      {mergedIntoCustomer ? (
        <Alert variant="destructive">
          <AlertTitle>병합된 고객입니다</AlertTitle>
          <AlertDescription>
            이 고객은{" "}
            <Link href={`/customers/${mergedIntoCustomer.id}`} className="font-medium underline">
              {mergedIntoCustomer.name} ({mergedIntoCustomer.customer_code})
            </Link>
            로 병합되었습니다. 주문 이력은 병합된 고객 쪽에서 확인할 수 있습니다.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{customer.name}</h1>
        <Badge variant="outline">{customer.customer_code}</Badge>
        {isVip ? <Badge className="bg-yellow-400 text-yellow-950 hover:bg-yellow-400">VIP</Badge> : null}
        <Badge variant={customer.status === "active" ? "outline" : "secondary"}>
          {CUSTOMER_STATUS_LABELS[customer.status as CustomerStatus] ?? customer.status}
        </Badge>
        {customer.tags.map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
          </Badge>
        ))}
        <CustomerFavoriteButton customerId={customer.id} initialIsFavorite={customer.is_favorite} />
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
          <CardTitle>Timeline</CardTitle>
          <CardDescription>주문, 정보 변경, 병합 등 모든 이벤트를 시간순으로 보여줍니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <CustomerTimeline events={timeline} />
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
