import Link from "next/link";
import { OrdifyLogo } from "@/components/brand/ordify-logo";
import { Button } from "@/components/ui/button";

const NAV_LINKS = [
  { href: "#product", label: "제품" },
  { href: "#features", label: "기능" },
  { href: "#flow", label: "사용 방법" },
  { href: "/contact", label: "문의" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/">
          <OrdifyLogo variant="full" className="h-6" />
        </Link>
        <nav className="hidden flex-1 items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="text-sm font-medium text-muted-foreground hover:text-foreground">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">로그인</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/login">무료로 시작하기</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
