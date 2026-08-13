import type { ReactNode } from "react";

/**
 * Shared header for every top-level page: title + one-line description on
 * the left, the page's single primary action (if any) on the right.
 * Sprint 14-I UI/UX renewal — replaces the ad hoc `<h1>`+`<p>` block each
 * page used to hand-roll, so every screen reads the same way.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-text-strong">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
