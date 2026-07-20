"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PaginationControls({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function goTo(nextPage: number) {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(nextPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center justify-between pt-2">
      <p className="text-sm text-muted-foreground">
        총 {total}건{totalPages > 1 ? ` · ${page} / ${totalPages} 페이지` : ""}
      </p>
      {totalPages > 1 ? (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            <ChevronLeft className="size-4" />
            이전
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => goTo(page + 1)}>
            다음
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
