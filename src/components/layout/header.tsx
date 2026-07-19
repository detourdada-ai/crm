import { Menu, LogOut, Utensils } from "lucide-react";
import { logoutAction } from "@/actions/auth";
import { getSession } from "@/lib/auth/current-session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NavLinks } from "./nav-links";

export async function Header() {
  const session = await getSession();

  return (
    <header className="flex h-14 items-center gap-3 border-b bg-background px-4 md:px-6">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="size-5" />
            <span className="sr-only">메뉴 열기</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-60 p-0">
          <SheetTitle className="flex h-14 items-center gap-2 border-b px-4 text-lg font-semibold">
            <Utensils className="size-5 text-primary" />
            CRM
          </SheetTitle>
          <div className="p-3">
            <NavLinks />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex-1" />

      {session ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{session.username}</span>
          <Badge variant="outline">{session.role === "admin" ? "관리자" : "담당자"}</Badge>
        </div>
      ) : null}

      <form action={logoutAction}>
        <Button type="submit" variant="ghost" size="sm">
          <LogOut className="size-4" />
          로그아웃
        </Button>
      </form>
    </header>
  );
}
