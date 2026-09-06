import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/current-session";
import { Badge } from "@/components/ui/badge";
import { getTenantMessageSettings } from "@/lib/services/messaging/message-settings.service";
import { listMessageLogs } from "@/lib/services/messaging/message-log.repository";
import { getMessageProvider } from "@/lib/services/messaging/provider";
import { OwnerMessageView } from "@/components/messages/owner-message-view";
import { AdminMessageView, type AdminTenantRow } from "@/components/messages/admin-message-view";

/**
 * STEP15-F1 — 메시지 서비스 화면. **라우트는 하나이고 role로 갈린다.**
 * 라우트를 둘로 나누면 링크·권한·QA가 두 배가 된다.
 *
 *   admin → 서비스 운영자 화면(테넌트별 상태, Provider 상태)
 *   user  → 내 메시지 서비스(배송 알림 / 잔액 / 발송 내역)
 *
 * 실제 발송·실결제는 아직 없다. 잔액은 구조만 있고 **가짜 금액을 만들지 않는다.**
 * 네비게이션 노출은 `serviceStatus !== "disabled"`일 때만이라 URL을 직접 치는
 * 경우가 남는데, 여기서 상태를 다시 확인해 안내 화면으로만 보낸다.
 */
export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const session = await requireSession();
  if (session.role === "driver") redirect("/driver");

  if (session.role === "admin") {
    const admin = getSupabaseAdmin();
    const { data: tenants } = await admin.from("tenants").select("name, slug").order("created_at", { ascending: true });
    const rows: AdminTenantRow[] = [];
    for (const t of tenants ?? []) {
      const settings = await getTenantMessageSettings(t.slug);
      rows.push({
        ownerUsername: t.slug,
        tenantName: t.name,
        serviceStatus: settings.serviceStatus,
        enabledEventCount: Object.values(settings.events).filter(Boolean).length,
      });
    }
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-text-strong">메시지 서비스 관리</h1>
          <Badge variant="secondary">SOON</Badge>
        </div>
        <AdminMessageView tenants={rows} providerName={getMessageProvider().name} />
      </div>
    );
  }

  const settings = await getTenantMessageSettings(session.username);
  const logs = settings.serviceStatus === "enabled" ? await listMessageLogs(session.username) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-text-strong">메시지 관리</h1>
        {settings.serviceStatus === "enabled" ? null : <Badge variant="outline">준비 중</Badge>}
      </div>
      <OwnerMessageView serviceStatus={settings.serviceStatus} events={settings.events} logs={logs} />
    </div>
  );
}
