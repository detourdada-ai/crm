import Link from "next/link";
import { OrdifyLogo } from "@/components/brand/ordify-logo";
import { NavLinks } from "./nav-links";
import { getSession } from "@/lib/auth/current-session";
import { getTenantMessageSettings } from "@/lib/services/messaging/message-settings.service";

/**
 * STEP15-F1 — 메시지 메뉴는 테넌트가 서비스를 쓸 수 있을 때만 보인다.
 * admin은 운영자라 항상 보이고, 사장님은 Admin이 서비스를 열어준 뒤부터 보인다
 * (`disabled`면 숨김). CEO 실사용 테스트 중인 사장님 화면을 건드리지 않기 위한 선택이다.
 */
async function shouldShowMessageService(session: Awaited<ReturnType<typeof getSession>>): Promise<boolean> {
  if (!session || session.role === "driver") return false;
  if (session.role === "admin") return true;
  try {
    const settings = await getTenantMessageSettings(session.username);
    return settings.serviceStatus !== "disabled";
  } catch {
    return false;
  }
}

export async function Sidebar() {
  const session = await getSession();
  const isDriver = session?.role === "driver";
  const isAdmin = session?.role === "admin";
  const showMessageService = await shouldShowMessageService(session);

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar md:flex md:flex-col">
      <div className="flex h-16 items-center border-b px-4">
        {/* Phase 4-B STEP11: 로고 클릭 시 Landing으로 이동. 로그인된 상태로
            "/"에 진입하면 Landing 자체가 즉시 /dashboard로 되돌려보내므로
            (src/app/page.tsx) 기존 redirect와 충돌하지 않는다 — 사실상
            새로고침처럼 동작한다. */}
        <Link href="/">
          <OrdifyLogo variant="full" className="h-8 w-auto" />
        </Link>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto p-3">
        <NavLinks isDriver={isDriver} isAdmin={isAdmin} showMessageService={showMessageService} />
      </div>
    </aside>
  );
}
