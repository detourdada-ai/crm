"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, DRIVER_NAV_ITEMS } from "@/lib/constants/nav";
import { cn } from "@/lib/utils";

export function NavLinks({ onNavigate, isDriver = false }: { onNavigate?: () => void; isDriver?: boolean }) {
  const pathname = usePathname();
  const items = isDriver ? DRIVER_NAV_ITEMS : NAV_ITEMS;

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
