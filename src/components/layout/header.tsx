import Link from "next/link";
import { LogOut } from "lucide-react";
import { getSession } from "@/lib/auth/current-session";
import { MobileHeaderSheet } from "./mobile-header-sheet";
import { OrdifyLogo } from "@/components/brand/ordify-logo";
import { HeaderClock } from "./header-clock";
import { ROLE_LABELS } from "@/lib/constants/role-labels";
import { logoutAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/** 로그아웃과 계정명/역할이 사이드바/시트 맨 아래(스크롤 필요)에 있어
 * 불편하다는 피드백으로 상단 바로 옮겼다 — 시계는 좌측, 계정정보+로그아웃은
 * 우측. NavLinks에는 더 이상 계정정보가 남지 않는다. */
export async function Header() {
  const session = await getSession();
  const isDriver = session?.role === "driver";
  const isAdmin = session?.role === "admin";

  return (
    <header className="flex h-16 items-center gap-3 border-b bg-background px-4 md:px-6">
      <MobileHeaderSheet isDriver={isDriver} isAdmin={isAdmin} />

      <Link href="/" className="md:hidden">
        <OrdifyLogo variant="mark" />
      </Link>

      <HeaderClock />

      <div className="flex-1" />

      {session ? (
        <div className="flex min-w-0 items-center gap-2">
          <span className="max-w-16 truncate text-sm font-medium text-foreground sm:max-w-none">{session.username}</span>
          <Badge variant="outline" className="shrink-0">
            {ROLE_LABELS[session.role]}
          </Badge>
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" size="sm" className="gap-2 text-muted-foreground">
              <LogOut className="size-4" />
              <span className="hidden sm:inline">로그아웃</span>
            </Button>
          </form>
        </div>
      ) : null}
    </header>
  );
}
