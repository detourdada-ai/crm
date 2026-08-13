import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared loading placeholders (Sprint 14-I UI/UX renewal). Every page's
 * loading.tsx / suspense fallback should reach for one of these instead of
 * inventing its own skeleton layout, so the "still loading" moment looks
 * the same everywhere in the app.
 */
export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      <TableSkeleton />
    </div>
  );
}

export function CardSkeleton() {
  return <Skeleton className="h-24 w-full" />;
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-4">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
