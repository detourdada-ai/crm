import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/current-session";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { computeAccessStatus } from "@/lib/auth/access-control";
import { logoutAction } from "@/actions/auth";

// Deliberately outside the (protected) route group — requireActiveAccess()
// (called from (protected)/layout.tsx) would otherwise redirect right back
// here, since this page exists for exactly the accounts that gate rejects.
export default async function SubscriptionPage() {
  const session = await requireSession();
  const tenant = await tenantsRepository.findByUsername(session.username);
  const status = tenant ? computeAccessStatus(tenant) : "NONE";

  const isActive = status === "ACTIVE_BETA" || status === "ACTIVE_SUBSCRIPTION";
  const statusLabel =
    status === "EXPIRED" ? "만료" : status === "SUSPENDED" ? "중지" : status === "ACTIVE_SUBSCRIPTION" ? "구독중" : status === "ACTIVE_BETA" ? "BETA" : "미구독";
  const message =
    status === "EXPIRED"
      ? "Beta 이용 기간이 만료되었습니다. 서비스를 계속 이용하려면 구독이 필요합니다."
      : status === "SUSPENDED"
        ? "현재 계정 이용이 중지된 상태입니다. 담당자에게 문의해주세요."
        : isActive
          ? "정상적으로 서비스를 이용할 수 있는 계정입니다."
          : "아직 서비스 이용 권한이 없습니다. 구독 또는 Beta 참여가 필요합니다.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            서비스 이용 권한 필요
            <Badge variant="outline">{statusLabel}</Badge>
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" className="w-full">
              로그아웃
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
