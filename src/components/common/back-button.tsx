"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * router.back() rather than a hardcoded href: if you got here from 주문관리,
 * back takes you to 주문관리; from 고객관리, back takes you there — whatever
 * page actually linked here, matching real browser back behavior.
 */
export function BackButton({ fallbackHref, label = "뒤로" }: { fallbackHref: string; label?: string }) {
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
    >
      <ArrowLeft className="size-4" />
      {label}
    </Button>
  );
}
