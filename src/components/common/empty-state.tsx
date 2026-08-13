import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared "nothing here yet" state. Sprint 14-I UI/UX renewal — replaces the
 * ad hoc single-line "OO이(가) 없습니다." text each page used to center
 * alone in a huge blank area; gives the same emptiness a consistent icon +
 * title + one-line explanation + optional action across every screen.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center", className)}>
      <Icon className="size-8 text-muted-foreground/60" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
