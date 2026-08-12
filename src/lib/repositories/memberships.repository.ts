import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Membership, MembershipRole } from "@/types/domain";

export interface MembershipInsert {
  username: string;
  tenant_id: string;
  role: MembershipRole;
}

export const membershipsRepository = {
  async create(input: MembershipInsert): Promise<Membership> {
    const { data, error } = await getSupabaseAdmin().from("memberships").insert(input).select("*").single();
    if (error) throw error;
    return data;
  },
};
