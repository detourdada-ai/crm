import type { Role } from "@/lib/auth/credentials";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "관리자",
  user: "담당자",
  driver: "배송기사",
};
