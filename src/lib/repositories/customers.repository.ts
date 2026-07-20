import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Customer, CustomerStatus } from "@/types/domain";

export interface CustomerSearchParams {
  query?: string;
  page?: number;
  pageSize?: number;
  ownerUsername?: string; // omit for admin (no filter = see everyone's customers)
}

export interface CustomerInsert {
  name: string;
  phone?: string | null;
  address?: string | null;
  address_normalized?: string | null;
  memo?: string | null;
  tags?: string[];
  owner_username: string;
  created_by_import_id?: string | null;
  bag_no?: string | null;
}

export interface CustomerUpdate {
  name?: string;
  phone?: string | null;
  address?: string | null;
  address_normalized?: string | null;
  memo?: string | null;
  tags?: string[];
  is_favorite?: boolean;
  status?: CustomerStatus;
  merged_into_id?: string | null;
  bag_no?: string | null;
}

/** Direct Supabase query access for the `customers` table. No business logic here. */
export const customersRepository = {
  async findById(id: string): Promise<Customer | null> {
    const { data, error } = await getSupabaseAdmin().from("customers").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },

  async findByIds(ids: string[]): Promise<Customer[]> {
    if (ids.length === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("customers").select("*").in("id", ids);
    if (error) throw error;
    return data ?? [];
  },

  async findByPhone(phone: string, ownerUsername?: string): Promise<Customer[]> {
    let q = getSupabaseAdmin().from("customers").select("*").eq("phone", phone);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },

  async findByNameAndAddress(name: string, addressNormalized: string, ownerUsername?: string): Promise<Customer[]> {
    let q = getSupabaseAdmin()
      .from("customers")
      .select("*")
      .eq("name", name)
      .eq("address_normalized", addressNormalized);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },

  async findByAddress(addressNormalized: string, ownerUsername?: string): Promise<Customer[]> {
    let q = getSupabaseAdmin().from("customers").select("*").eq("address_normalized", addressNormalized);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },

  async search({ query, page = 1, pageSize = 20, ownerUsername }: CustomerSearchParams) {
    // 병합되어 흡수된 고객은 목록에서 기본적으로 숨김 (감사/이력 조회는 customer detail에서 가능)
    let q = getSupabaseAdmin().from("customers").select("*", { count: "exact" }).neq("status", "merged");

    if (ownerUsername) q = q.eq("owner_username", ownerUsername);

    if (query && query.trim()) {
      const term = query.trim();
      q = q.or(
        `name.ilike.%${term}%,phone.ilike.%${term}%,address.ilike.%${term}%,customer_code.ilike.%${term}%`
      );
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await q.order("created_at", { ascending: false }).range(from, to);
    if (error) throw error;
    return { customers: data ?? [], total: count ?? 0 };
  },

  async create(input: CustomerInsert): Promise<Customer> {
    const { data, error } = await getSupabaseAdmin().from("customers").insert(input).select("*").single();
    if (error) throw error;
    return data;
  },

  async update(id: string, input: CustomerUpdate): Promise<Customer> {
    const { data, error } = await getSupabaseAdmin()
      .from("customers")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id: string): Promise<void> {
    const { error } = await getSupabaseAdmin().from("customers").delete().eq("id", id);
    if (error) throw error;
  },

  async findByCreatedByImportId(importId: string): Promise<Customer[]> {
    const { data, error } = await getSupabaseAdmin().from("customers").select("*").eq("created_by_import_id", importId);
    if (error) throw error;
    return data ?? [];
  },

  async count(ownerUsername?: string): Promise<number> {
    let q = getSupabaseAdmin().from("customers").select("*", { count: "exact", head: true }).neq("status", "merged");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  },

  /** Every non-merged customer's identity fields, for the retroactive exact-duplicate scan (grouped in JS — table is small enough that a DB-side GROUP BY isn't worth the extra RPC). */
  async findAllForDedupScan(): Promise<
    Pick<Customer, "id" | "name" | "phone" | "address_normalized" | "owner_username">[]
  > {
    const { data, error } = await getSupabaseAdmin()
      .from("customers")
      .select("id, name, phone, address_normalized, owner_username")
      .neq("status", "merged")
      .not("phone", "is", null)
      .not("address_normalized", "is", null);
    if (error) throw error;
    return data ?? [];
  },
};
