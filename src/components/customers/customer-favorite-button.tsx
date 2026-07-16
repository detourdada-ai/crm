"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toggleCustomerFavoriteAction } from "@/actions/customers";
import { cn } from "@/lib/utils";

export function CustomerFavoriteButton({ customerId, initialIsFavorite }: { customerId: string; initialIsFavorite: boolean }) {
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      try {
        const result = await toggleCustomerFavoriteAction(customerId);
        setIsFavorite(result.isFavorite);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "즐겨찾기 변경 중 오류가 발생했습니다.");
      }
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={handleClick}
      className={cn("gap-1.5", isFavorite && "border-yellow-400 text-yellow-600")}
    >
      <Star className={cn("size-4", isFavorite && "fill-yellow-400")} />
      {isFavorite ? "즐겨찾기됨" : "즐겨찾기"}
    </Button>
  );
}
