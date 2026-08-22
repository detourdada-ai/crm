"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLE_LABELS } from "@/lib/constants/role-labels";
import type { Role } from "@/lib/auth/credentials";

const ALL_VALUE = "__all__";
const ROLES: Role[] = ["admin", "user", "driver"];

/** 전체 계정 목록 — 역할(관리자/담당자/배송기사)로 좁혀 보는 compact select. URL의 roleFilter 파라미터로 상태를 유지한다. */
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
