import Link from "next/link";
import { LogOut } from "lucide-react";
import { getSession } from "@/lib/auth/current-session";
import { MobileHeaderSheet } from "./mobile-header-sheet";
import { OrdifyLogo } from "@/components/brand/ordify-logo";
import { HeaderClock } from "./header-clock";
import { ROLE_LABELS } from "@/lib/constants/role-labels";
import { logoutAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";

/** 로그아웃이 사이드바/시트 맨 아래(스크롤 필요)에 있어 불편하다는 피드백으로
 * 상단 바로 옮겼다 — 시계는 좌측, 로그아웃은 우측. 계정명/역할 배지는
 * 여전히 NavLinks 하단(AccountFooter)에 남는다. */
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

      <HeaderClock />

      <div className="flex-1" />

      {session ? (
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="sm" className="gap-2 text-muted-foreground">
            <LogOut className="size-4" />
            로그아웃
          </Button>
        </form>
      ) : null}
    </header>
  );
}
