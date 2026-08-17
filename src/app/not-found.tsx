import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * F15: 존재하지 않는 URL(/orders/not-exist 등)이 500으로 죽지 않고
 * 깔끔한 404로 처리되도록 하는 루트 not-found — 지금까지 하나도 없었다.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <FileQuestion className="size-10 text-muted-foreground" />
      <p className="text-lg font-semibold">페이지를 찾을 수 없습니다.</p>
      <p className="max-w-md text-sm text-muted-foreground">주소가 정확한지 확인하시거나, 아래 버튼으로 이동해주세요.</p>
      <Button asChild className="mt-2">
        <Link href="/dashboard">대시보드로 이동</Link>
      </Button>
    </div>
  );
}
