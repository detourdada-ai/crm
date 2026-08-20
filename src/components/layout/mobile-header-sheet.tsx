"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NavLinks } from "./nav-links";
import { OrdifyLogo } from "@/components/brand/ordify-logo";

/**
 * P12 CEO 실사용 발견: 모바일 메뉴에서 항목을 눌러 화면이 이동해도 메뉴창이
 * 닫히지 않고 남아있었다 — Header가 Sheet를 제어하지 않는(uncontrolled) 상태로
 * 렌더링했기 때문이다. Header는 async Server Component라 useState를 못 쓰므로,
 * Sheet 부분만 이 Client Component로 분리해 pathname 변화에 맞춰 자동으로
 * 닫히게 한다(항목 클릭 시 onNavigate로 즉시 닫히는 것과 별개로, 로고 클릭 등
 * NavLinks를 거치지 않는 이동도 잡아준다). setState-in-effect의 cascading
 * render 경고를 피하려고 useEffect 대신 React가 권장하는 "렌더 중 상태 조정"
 * 패턴(pathname이 바뀐 걸 렌더 중에 감지해 그 자리에서 바로 닫음)을 쓴다.
 */
export function MobileHeaderSheet({ isDriver, isAdmin }: { isDriver: boolean; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);

  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="size-5" />
          <span className="sr-only">메뉴 열기</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-60 flex-col p-0">
        <SheetTitle className="flex h-16 items-center border-b px-4">
          <Link href="/">
            <OrdifyLogo variant="full" />
          </Link>
        </SheetTitle>
        <div className="flex flex-1 flex-col overflow-y-auto p-3">
          <NavLinks isDriver={isDriver} isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
