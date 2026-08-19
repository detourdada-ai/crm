import Link from "next/link";
import { getSession } from "@/lib/auth/current-session";
import { MobileHeaderSheet } from "./mobile-header-sheet";
import { OrdifyLogo } from "@/components/brand/ordify-logo";
import { HeaderClock } from "./header-clock";
import { ROLE_LABELS } from "@/lib/constants/role-labels";

/** Sprint 14-I UI/UX 리뉴얼 2차 (Phase UI-1): 계정 정보/로그아웃은 이제 NavLinks 하단(Sidebar/Sheet 공용)에서만 노출한다 — 상단 바는 모바일 메뉴 진입점 역할만 한다. */
export async function Header() {
  const session = await getSession();
  const isDriver = session?.role === "driver";
  const isAdmin = session?.role === "admin";

  return (
    <header className="flex h-16 items-center gap-3 border-b bg-background px-4 md:px-6">
      <MobileHeaderSheet
        isDriver={isDriver}
        isAdmin={isAdmin}
        username={session?.username}
        roleLabel={session ? ROLE_LABELS[session.role] : undefined}
      />

      <Link href="/" className="md:hidden">
        <OrdifyLogo variant="mark" />
      </Link>

      <div className="flex-1" />

      <HeaderClock />
    </header>
  );
}
