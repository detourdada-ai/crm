import Link from "next/link";
import { OrdifyLogo } from "@/components/brand/ordify-logo";
import { NavLinks } from "./nav-links";
import { getSession } from "@/lib/auth/current-session";
import { ROLE_LABELS } from "@/lib/constants/role-labels";

export async function Sidebar() {
  const session = await getSession();
  const isDriver = session?.role === "driver";
  const isAdmin = session?.role === "admin";

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
        <NavLinks
          isDriver={isDriver}
          isAdmin={isAdmin}
          username={session?.username}
          roleLabel={session ? ROLE_LABELS[session.role] : undefined}
        />
      </div>
    </aside>
  );
}
