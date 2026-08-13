"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ENTRIES, NAV_SETTINGS_ITEM, DRIVER_NAV_ITEMS, isNavSection, type NavItem } from "@/lib/constants/nav";
import { cn } from "@/lib/utils";

function NavLink({ item, isActive, onNavigate }: { item: NavItem; isActive: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className="size-4" />
      {item.label}
    </Link>
  );
}

export function NavLinks({
  onNavigate,
  isDriver = false,
  isAdmin = false,
}: {
  onNavigate?: () => void;
  isDriver?: boolean;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  if (isDriver) {
    return (
      <nav className="flex flex-col gap-1">
        {DRIVER_NAV_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} isActive={isActive(item.href)} onNavigate={onNavigate} />
        ))}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        {NAV_ENTRIES.map((entry) =>
          isNavSection(entry) ? (
            <div key={entry.section} className="mt-3 flex flex-col gap-1 first:mt-0">
              <span className="px-3 text-xs font-semibold tracking-wide text-muted-foreground/80 uppercase">
                {entry.section}
              </span>
              {entry.items
                .filter((item) => !item.adminOnly || isAdmin)
                .map((item) => (
                  <NavLink key={item.href} item={item} isActive={isActive(item.href)} onNavigate={onNavigate} />
                ))}
            </div>
          ) : !entry.adminOnly || isAdmin ? (
            <NavLink key={entry.href} item={entry} isActive={isActive(entry.href)} onNavigate={onNavigate} />
          ) : null
        )}
      </div>
      <div className="flex flex-col gap-1 border-t pt-3">
        <NavLink item={NAV_SETTINGS_ITEM} isActive={isActive(NAV_SETTINGS_ITEM.href)} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}
