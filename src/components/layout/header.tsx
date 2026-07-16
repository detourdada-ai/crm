import { Menu, LogOut } from "lucide-react";
import { logoutAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NavLinks } from "./nav-links";

export function Header() {
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
          <SheetTitle className="flex h-14 items-center border-b px-4 text-lg font-semibold">
            CRM
          </SheetTitle>
          <div className="p-3">
            <NavLinks />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex-1" />

      <form action={logoutAction}>
        <Button type="submit" variant="ghost" size="sm">
          <LogOut className="size-4" />
          로그아웃
        </Button>
      </form>
    </header>
  );
}
