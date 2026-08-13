import Link from "next/link";
import { Menu } from "lucide-react";
import { OrdifyLogo } from "@/components/brand/ordify-logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const NAV_LINKS = [
  { href: "#product", label: "제품" },
  { href: "#features", label: "기능" },
  { href: "#flow", label: "사용 방법" },
  { href: "/contact", label: "문의하기" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/">
          <OrdifyLogo variant="full" className="h-8" />
        </Link>
        <nav className="hidden flex-1 items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="text-sm font-medium text-muted-foreground hover:text-foreground">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">로그인</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/login">무료로 시작하기</Link>
          </Button>
        </div>

        {/* Sprint 14-I UI/UX 리뉴얼 2차: 모바일에서 nav 링크가 사라지고 로고만
            남아 있던 문제 — 내부 SaaS 화면의 Sheet 패턴을 그대로 재사용해
            햄버거로 제품/기능/사용 방법/문의 + 로그인/시작하기를 노출한다. */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="ml-auto md:hidden">
              <Menu className="size-5" />
              <span className="sr-only">메뉴 열기</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <SheetTitle className="flex h-14 items-center border-b px-4">
              <OrdifyLogo variant="full" className="h-6" />
            </SheetTitle>
            <nav className="flex flex-col gap-1 px-3">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div className="mt-auto flex flex-col gap-2 border-t border-border p-3">
              <Button asChild variant="outline">
                <Link href="/login">로그인</Link>
              </Button>
              <Button asChild>
                <Link href="/login">무료로 시작하기</Link>
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
