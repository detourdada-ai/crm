import Link from "next/link";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/current-session";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { computeAccessStatus } from "@/lib/auth/access-control";
import { AccessKeyRedeemForm } from "@/components/settings/access-key-redeem-form";
import { logoutAction } from "@/actions/auth";

// Deliberately outside the (protected) route group — requireActiveAccess()
// (called from (protected)/layout.tsx) would otherwise redirect right back
// here, since this page exists for exactly the accounts that gate rejects.
export default async function SubscriptionPage() {
  const session = await requireSession();
  const tenant = await tenantsRepository.findByUsername(session.username);
  const status = tenant ? computeAccessStatus(tenant) : "NONE";

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        {status === "ACTIVE_BETA" ? (
          <BetaActiveContent expiresAt={tenant?.access_expires_at ?? null} />
        ) : status === "ACTIVE_SUBSCRIPTION" ? (
          <SubscriptionActiveContent />
        ) : status === "EXPIRED" ? (
          <ExpiredContent />
        ) : status === "SUSPENDED" ? (
          <SuspendedContent />
        ) : (
          <NoneContent />
        )}
        <CardContent className="pt-0">
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" className="w-full">
              로그아웃
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function NoneContent() {
  return (
    <CardContent className="space-y-6 pt-6">
      <div className="space-y-1.5">
        <CardTitle className="flex items-center gap-2 text-xl">
          서비스 이용 권한 필요
          <Badge variant="outline">미구독</Badge>
        </CardTitle>
        <CardDescription>정식 구독을 시작하거나 Access Key를 입력해주세요.</CardDescription>
      </div>
      <AccessKeyRedeemForm />
      <div className="border-t pt-4">
        <Button type="button" variant="outline" className="w-full" disabled>
          구독 플랜 보기 (준비 중)
        </Button>
      </div>
    </CardContent>
  );
}

function BetaActiveContent({ expiresAt }: { expiresAt: string | null }) {
  const range = expiresAt
    ? `~ ${new Date(expiresAt).toISOString().slice(0, 10)}`
    : "";
  return (
    <CardContent className="space-y-4 pt-6">
      <div className="space-y-1.5">
        <CardTitle className="flex items-center gap-2 text-xl">
          Beta 이용 중
          <Badge>BETA</Badge>
        </CardTitle>
        <CardDescription>사용 가능 기간 {range}</CardDescription>
      </div>
      <Button asChild className="w-full">
        <Link href="/">서비스 시작</Link>
      </Button>
    </CardContent>
  );
}

function SubscriptionActiveContent() {
  return (
    <CardContent className="space-y-4 pt-6">
      <div className="space-y-1.5">
        <CardTitle className="flex items-center gap-2 text-xl">
          구독 이용 중
          <Badge>구독중</Badge>
        </CardTitle>
      </div>
      <Button asChild className="w-full">
        <Link href="/">서비스 시작</Link>
      </Button>
    </CardContent>
  );
}

function ExpiredContent() {
  return (
    <CardContent className="space-y-6 pt-6">
      <div className="space-y-1.5">
        <CardTitle className="flex items-center gap-2 text-xl">
          Beta 기간 종료
          <Badge variant="outline">만료</Badge>
        </CardTitle>
        <CardDescription>Beta 이용 기간이 종료되었습니다. 서비스를 계속 이용하려면 정식 구독을 시작해주세요.</CardDescription>
      </div>
      <Button type="button" variant="outline" className="w-full" disabled>
        구독 플랜 보기 (준비 중)
      </Button>
    </CardContent>
  );
}

function SuspendedContent() {
  return (
    <CardContent className="space-y-1.5 pt-6">
      <CardTitle className="flex items-center gap-2 text-xl">
        이용 중지
        <Badge variant="destructive">중지</Badge>
      </CardTitle>
      <CardDescription>현재 계정 이용이 중지된 상태입니다. 담당자에게 문의해주세요.</CardDescription>
    </CardContent>
  );
}
