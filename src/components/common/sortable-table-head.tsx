"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function SortableTableHead({
  field,
  children,
  className,
  defaultDir = "desc",
}: {
  field: string;
  children: React.ReactNode;
  className?: string;
  defaultDir?: "asc" | "desc";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSort = searchParams.get("sort");
  const currentDir = searchParams.get("dir") ?? "desc";
  const isActive = currentSort === field;

  function handleClick() {
    const params = new URLSearchParams(searchParams);
    params.set("sort", field);
    params.set("dir", isActive ? (currentDir === "asc" ? "desc" : "asc") : defaultDir);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  const Icon = isActive ? (currentDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <TableHead className={cn("cursor-pointer select-none", className)} onClick={handleClick}>
      <span className="inline-flex items-center gap-1">
        {children}
        <Icon className={cn("size-3.5", isActive ? "text-foreground" : "text-muted-foreground/40")} />
      </span>
    </TableHead>
  );
}
