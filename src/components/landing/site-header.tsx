import Link from "next/link";
import { Menu, ArrowRight, LogOut } from "lucide-react";
import { OrdifyLogo } from "@/components/brand/ordify-logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { logoutAction } from "@/actions/auth";
import type { SessionPayload } from "@/lib/auth/session";

/**
 * LANDING v4(CPO 확정, 2026-09-05) — 상단 메뉴를 **랜딩 목차형에서 서비스
 * 구조형으로** 바꾼다. "어떻게 관리되나요 / 실제 화면"은 페이지 안의 목차라
 * 소개자료처럼 읽혔다. 메뉴만 보고도 "주문·고객·배송을 관리하는 SaaS"라는
 * 것이 전달돼야 한다.
 */
const NAV_LINKS = [
  { href: "#orders", label: "주문 관리" },
  { href: "#customers", label: "고객 관리" },
  { href: "#delivery", label: "배송 관리" },
  { href: "#pricing", label: "요금제" },
  { href: "#faq", label: "FAQ" },
];

export function SiteHeader({ session }: { session: SessionPayload | null }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/">
          <OrdifyLogo variant="full" className="h-8" />
        </Link>
        <nav className="hidden flex-1 items-center gap-5 lg:gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="text-sm font-medium text-muted-foreground hover:text-foreground">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-3 md:flex">
          {session ? (
            <>
              <span className="text-sm font-medium text-foreground">{session.username}</span>
              <form action={logoutAction}>
                <Button type="submit" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                  <LogOut className="size-4" />
                  로그아웃
                </Button>
              </form>
              <Button asChild size="sm" className="gap-1.5">
                <Link href="/dashboard">
                  서비스 가기
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">로그인</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/login">무료로 시작하기</Link>
              </Button>
            </>
          )}
        </div>

        {/* Beta 고객 모집 전환: 모바일 우선순위 — 비로그인은 "베타 신청"이
            1순위(로그인은 보조), 로그인 상태는 "서비스 가기"가 1순위다. */}
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
              {session ? (
                <>
                  <p className="px-1 text-sm font-medium text-foreground">{session.username}</p>
                  <Button asChild className="gap-1.5">
                    <Link href="/dashboard">
                      서비스 가기
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                  <form action={logoutAction}>
                    <Button type="submit" variant="outline" className="w-full gap-1.5">
                      <LogOut className="size-4" />
                      로그아웃
                    </Button>
                  </form>
                </>
              ) : (
                <>
                  <Button asChild>
                    <Link href="/login">무료로 시작하기</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/login">로그인</Link>
                  </Button>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
