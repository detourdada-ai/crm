import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Product } from "@/types/domain";

export interface ProductInsert {
  name: string;
  unit_price?: number;
  is_active?: boolean;
  owner_username: string;
  tenant_id: string;
}

export interface ProductUpdate {
  name?: string;
  unit_price?: number;
  is_active?: boolean;
}

export const productsRepository = {
  async findById(id: string): Promise<Product | null> {
    const { data, error } = await getSupabaseAdmin().from("products").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },

  /** ownerUsername 생략 시(admin) 전체 계정의 상품을 반환. */
  async listAll(ownerUsername?: string): Promise<Product[]> {
    let q = getSupabaseAdmin().from("products").select("*");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("owner_username").order("name");
    if (error) throw error;
    return data ?? [];
  },

  /** 수동 주문 SelectBox용 — 사용 중(is_active)인 상품만, 이름순. */
  async listActive(ownerUsername: string): Promise<Product[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("products")
      .select("*")
      .eq("owner_username", ownerUsername)
      .eq("is_active", true)
      .order("name");
    if (error) throw error;
    return data ?? [];
  },

  async create(input: ProductInsert): Promise<Product> {
    const { data, error } = await getSupabaseAdmin().from("products").insert(input).select("*").single();
    if (error) throw error;
    return data;
  },

  /** F15 패턴: ownerUsername이 주어지면(비-admin 호출) DB 쿼리에도 소유권 조건을 건다. */
  async update(id: string, input: ProductUpdate, ownerUsername?: string): Promise<Product> {
    let q = getSupabaseAdmin().from("products").update(input).eq("id", id);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("상품을 찾을 수 없거나 권한이 없습니다.");
    return data;
  },

  /** 이 상품을 참조하는 order_items가 있는지 — 있으면 완전 삭제 대신 사용 중지를 권장하기 위한 가드. */
  async countReferencingOrderItems(productId: string): Promise<number> {
    const { count, error } = await getSupabaseAdmin()
      .from("order_items")
      .select("*", { count: "exact", head: true })
      .eq("product_id", productId);
    if (error) throw error;
    return count ?? 0;
  },

  async delete(id: string, ownerUsername?: string): Promise<void> {
    let q = getSupabaseAdmin().from("products").delete().eq("id", id);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("상품을 찾을 수 없거나 권한이 없습니다.");
  },
};
