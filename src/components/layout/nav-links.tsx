"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ENTRIES, NAV_HELP_ENTRY, DRIVER_NAV_ITEMS, isNavSection, type NavItem } from "@/lib/constants/nav";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function NavLink({ item, isActive, onNavigate }: { item: NavItem; isActive: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        isActive ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className="size-4" />
      {item.label}
    </Link>
  );
}

function NavSectionBlock({
  entry,
  isActive,
  isAdmin,
  onNavigate,
  withDivider = false,
}: {
  entry: { section: string; items: NavItem[] };
  isActive: (href: string) => boolean;
  isAdmin: boolean;
  onNavigate?: () => void;
  withDivider?: boolean;
}) {
  return (
    <div className={cn("mt-5 flex flex-col gap-0.5 first:mt-0", withDivider && "mt-5 border-t pt-4")}>
      <span className="px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground/70 uppercase">{entry.section}</span>
      {entry.items
        .filter((item) => !item.adminOnly || isAdmin)
        .map((item) => (
          <NavLink key={item.href} item={item} isActive={isActive(item.href)} onNavigate={onNavigate} />
        ))}
    </div>
  );
}

/** 계정명/역할 배지 — 데스크톱 Sidebar와 모바일 Sheet 둘 다 이 컴포넌트를 쓰므로 한 곳에서만 렌더링한다. 로그아웃 버튼은 스크롤 없이 항상 보이도록 상단 Header로 옮겼다(header.tsx). */
function AccountFooter({ username, roleLabel }: { username: string; roleLabel: string }) {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2 px-2.5 py-2 text-sm">
      <span className="truncate font-medium text-foreground">{username}</span>
      <Badge variant="outline" className="shrink-0">
        {roleLabel}
      </Badge>
    </div>
  );
}

export function NavLinks({
  onNavigate,
  isDriver = false,
  isAdmin = false,
  username,
  roleLabel,
}: {
  onNavigate?: () => void;
  isDriver?: boolean;
  isAdmin?: boolean;
  username?: string;
  roleLabel?: string;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  if (isDriver) {
    return (
      <nav className="flex h-full flex-col gap-4">
        <div className="flex flex-1 flex-col gap-1">
          {DRIVER_NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} isActive={isActive(item.href)} onNavigate={onNavigate} />
          ))}
        </div>
        {username && roleLabel ? <AccountFooter username={username} roleLabel={roleLabel} /> : null}
      </nav>
    );
  }

  return (
    <nav className="flex h-full flex-col gap-4">
      <div className="flex-1">
        <div className="flex flex-col gap-1">
          {NAV_ENTRIES.map((entry) =>
            isNavSection(entry) ? (
              <NavSectionBlock key={entry.section} entry={entry} isActive={isActive} isAdmin={isAdmin} onNavigate={onNavigate} />
            ) : !entry.adminOnly || isAdmin ? (
              <NavLink key={entry.href} item={entry} isActive={isActive(entry.href)} onNavigate={onNavigate} />
            ) : null
          )}
        </div>
        <NavSectionBlock entry={NAV_HELP_ENTRY} isActive={isActive} isAdmin={isAdmin} onNavigate={onNavigate} withDivider />
      </div>
      {username && roleLabel ? <AccountFooter username={username} roleLabel={roleLabel} /> : null}
    </nav>
  );
}
