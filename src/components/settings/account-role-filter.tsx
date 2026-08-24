"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLE_LABELS } from "@/lib/constants/role-labels";
import type { Role } from "@/lib/auth/credentials";

const ALL_VALUE = "__all__";
// STEP1 재정리: 배송기사는 기사관리에서만 관리하고 이 목록에는 아예 나오지
// 않는다(전체 계정 목록 자체가 role=driver를 제외하고 조회한다) — 그래서
// 필터 옵션에서도 "배송기사"를 제거한다. 실제로 볼 일이 없는 옵션을
// 남겨두면 "필터를 걸어도 왜 기사가 안 나오지"라는 혼란만 생긴다.
const ROLES: Role[] = ["admin", "user"];

/** 전체 계정 목록 — 역할(관리자/담당자)로 좁혀 보는 compact select. URL의 roleFilter 파라미터로 상태를 유지한다. 배송기사는 대상이 아니다(기사관리 전용). */
export function AccountRoleFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("roleFilter") ?? ALL_VALUE;

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value === ALL_VALUE) params.delete("roleFilter");
    else params.set("roleFilter", value);
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  return (
    <Select value={current} onValueChange={handleChange}>
      <SelectTrigger className="w-full sm:w-48">
        <SelectValue placeholder="전체 역할" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>전체 역할</SelectItem>
        {ROLES.map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
