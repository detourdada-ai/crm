"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Admin 전용 — 엑셀 등록 이력을 사장님(계정) 단위로 좁혀 본다.
 *
 * Admin 화면은 여러 사장님 이력이 한 목록에 섞여 나오는데, 특정 사장님의 업로드를
 * 재현하려면 그 계정 것만 봐야 한다. 정산 화면의 계정 필터와 같은 방식(쿼리스트링 +
 * router.push)이라 새 상태 관리가 붙지 않는다.
 *
 * **권한 정책은 바뀌지 않는다.** 이건 표시 범위를 좁히는 필터일 뿐이고, 넓히는 쪽으로는
 * 동작하지 않는다 — 서버에서 admin일 때만 이 값을 쓰고, 사장님 세션은 owner 쿼리가
 * 붙어 있어도 본인 계정으로 고정된다.
 */
export function ImportOwnerFilter({ accountUsernames, value }: { accountUsernames: string[]; value?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("owner");
    else params.set("owner", next);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">계정 필터</Label>
      <Select value={value ?? "all"} onValueChange={handleChange} disabled={isPending}>
        <SelectTrigger className="w-40" aria-label="사장님 계정 필터">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">전체 계정</SelectItem>
          {accountUsernames.map((username) => (
            <SelectItem key={username} value={username}>
              {username}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
