import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ProductAlias } from "@/types/domain";

export interface ProductAliasInsert {
  product_id: string;
  alias_name: string;
  owner_username: string;
  tenant_id: string;
}

export interface UnmappedProductName {
  product_name: string;
  count: number;
}

export const productAliasesRepository = {
  /** ownerUsername 생략 시(admin) 전체 계정의 별칭을 반환. */
  async listAll(ownerUsername?: string): Promise<ProductAlias[]> {
    let q = getSupabaseAdmin().from("product_aliases").select("*");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("alias_name");
    if (error) throw error;
    return data ?? [];
  },

  async findById(id: string): Promise<ProductAlias | null> {
    const { data, error } = await getSupabaseAdmin().from("product_aliases").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * STEP12-8F Phase3(R05): 원본 문자열(alias_name)로 정확히 일치하는(exact
   * match — 유사매칭/문자열 정규화 없음) 별칭을 찾는다. Excel/수동 주문
   * 생성 시 이 결과가 있으면 order_items.product_id만 채우고 product_name
   * 원본 텍스트는 그대로 둔다.
   */
  async findByExactName(ownerUsername: string, aliasName: string): Promise<ProductAlias | null> {
    const { data, error } = await getSupabaseAdmin()
      .from("product_aliases")
      .select("*")
      .eq("owner_username", ownerUsername)
      .eq("alias_name", aliasName)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async create(input: ProductAliasInsert): Promise<ProductAlias> {
    const { data, error } = await getSupabaseAdmin().from("product_aliases").insert(input).select("*").single();
    if (error) throw error;
    return data;
  },

  async delete(id: string, ownerUsername?: string): Promise<void> {
    let q = getSupabaseAdmin().from("product_aliases").delete().eq("id", id);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("별칭을 찾을 수 없거나 권한이 없습니다.");
  },

  /**
   * 아직 표준 상품에 연결되지 않은(product_id가 null인) order_items의 원본
   * 상품명을 문자열별로 세어 보여준다 — CPO/사장님이 "이 이름을 어떤 표준
   * 상품으로 연결할지" 고를 수 있는 후보 목록이다. order_items 자체에는
   * owner_username이 없어(orders를 통해서만 스코프됨) 최근 주문 id를 먼저
   * 구한 뒤 그 범위에서만 조회한다(다른 repository와 동일한 2단계 조회
   * 관례 — 임의 조인 대신 id 목록으로 좁힌다). 최근 300건만 조회해 부담을
   * 제한한다(작은 사업자 규모에 맞는 참고용 목록).
   */
  async listUnmappedProductNames(ownerUsername: string): Promise<UnmappedProductName[]> {
    const admin = getSupabaseAdmin();
    const { data: recentOrders, error: ordersError } = await admin
      .from("orders")
      .select("id")
      .eq("owner_username", ownerUsername)
      .order("created_at", { ascending: false })
      .limit(300);
    if (ordersError) throw ordersError;
    const orderIds = (recentOrders ?? []).map((o) => o.id);
    if (orderIds.length === 0) return [];

    const { data, error } = await admin.from("order_items").select("product_name").is("product_id", null).in("order_id", orderIds);
    if (error) throw error;
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      counts.set(row.product_name, (counts.get(row.product_name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([product_name, count]) => ({ product_name, count }))
      .sort((a, b) => b.count - a.count);
  },
};
