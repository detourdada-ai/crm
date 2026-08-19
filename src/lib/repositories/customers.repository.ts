import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { digitsOnly, formatPhoneNumber } from "@/lib/utils/phone";
import type { Customer, CustomerStatus, GeocodeStatus } from "@/types/domain";

export type CustomerSortField =
  | "customer_code"
  | "name"
  | "phone"
  | "address"
  | "total_orders"
  | "total_amount"
  | "last_order_at";

export interface CustomerSearchParams {
  query?: string;
  page?: number;
  pageSize?: number;
  ownerUsername?: string; // omit for admin (no filter = see everyone's customers)
  sortBy?: CustomerSortField;
  sortAscending?: boolean;
}

export interface CustomerInsert {
  id?: string; // client-generated (crypto.randomUUID()) for batch import — lets order rows reference the customer before the actual insert round-trip
  name: string;
  phone?: string | null;
  address?: string | null;
  address_normalized?: string | null;
  postal_code?: string | null;
  road_address?: string | null;
  detail_address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  sido?: string | null;
  sigungu?: string | null;
  eupmyeondong?: string | null;
  sido_code?: string | null;
  sigungu_code?: string | null;
  eupmyeondong_code?: string | null;
  geocode_status?: GeocodeStatus;
  geocoded_at?: string | null;
  memo?: string | null;
  tags?: string[];
  owner_username: string;
  tenant_id: string;
  created_by_import_id?: string | null;
  bag_no?: string | null;
}

export interface CustomerUpdate {
  name?: string;
  phone?: string | null;
  address?: string | null;
  address_normalized?: string | null;
  postal_code?: string | null;
  road_address?: string | null;
  detail_address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  sido?: string | null;
  sigungu?: string | null;
  eupmyeondong?: string | null;
  sido_code?: string | null;
  sigungu_code?: string | null;
  eupmyeondong_code?: string | null;
  geocode_status?: GeocodeStatus;
  geocoded_at?: string | null;
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

  /**
   * Phase 1: 기사 담당지역 등록 UI의 시군구/읍면동 자동완성용 — 지역
   * 마스터 테이블 없이, 이미 지오코딩에 성공한 고객 주소에서 뽑은
   * distinct 조합을 그대로 후보로 쓴다(작업지시서 8번).
   */
  async listDistinctRegions(
    ownerUsername?: string
  ): Promise<Array<{ sido: string; sigungu: string | null; eupmyeondong: string | null }>> {
    let q = getSupabaseAdmin()
      .from("customers")
      .select("sido, sigungu, eupmyeondong")
      .eq("geocode_status", "success")
      .not("sido", "is", null)
      .limit(2000);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q;
    if (error) throw error;

    const seen = new Set<string>();
    const result: Array<{ sido: string; sigungu: string | null; eupmyeondong: string | null }> = [];
    for (const row of data ?? []) {
      if (!row.sido) continue;
      const key = `${row.sido}|${row.sigungu ?? ""}|${row.eupmyeondong ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ sido: row.sido, sigungu: row.sigungu, eupmyeondong: row.eupmyeondong });
    }
    return result;
  },

  /**
   * P6 13번: 동일인 매칭은 "절대 다른 사장님 고객과 병합하지 않는다"는
   * 원칙이 걸린 조회다 — ownerUsername을 선택 인자로 두면 언젠가 실수로
   * 빠뜨린 호출이 테넌트 전체를 뒤지게 된다. 실제 호출부(customer.service.ts,
   * duplicate-detection.service.ts)는 이미 항상 넘기고 있었으므로 동작
   * 변화는 없고, 타입으로 강제해 향후 실수를 막는 하드닝이다.
   */
  async findByPhone(phone: string, ownerUsername: string): Promise<Customer[]> {
    const { data, error } = await getSupabaseAdmin().from("customers").select("*").eq("phone", phone).eq("owner_username", ownerUsername);
    if (error) throw error;
    return data ?? [];
  },

  async findByNameAndAddress(name: string, addressNormalized: string, ownerUsername: string): Promise<Customer[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("customers")
      .select("*")
      .eq("name", name)
      .eq("address_normalized", addressNormalized)
      .eq("owner_username", ownerUsername);
    if (error) throw error;
    return data ?? [];
  },

  async findByAddress(addressNormalized: string, ownerUsername: string): Promise<Customer[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("customers")
      .select("*")
      .eq("address_normalized", addressNormalized)
      .eq("owner_username", ownerUsername);
    if (error) throw error;
    return data ?? [];
  },

  async search({ query, page = 1, pageSize = 20, ownerUsername, sortBy, sortAscending = false }: CustomerSearchParams) {
    // customer_list_view joins in order stats so 주문횟수/총금액/최근주문일 can
    // be sorted the same way as native columns (see migrations/0011).
    // 병합되어 흡수된 고객은 목록에서 기본적으로 숨김 (감사/이력 조회는 customer detail에서 가능)
    let q = getSupabaseAdmin().from("customer_list_view").select("*", { count: "exact" }).neq("status", "merged");

    if (ownerUsername) q = q.eq("owner_username", ownerUsername);

    if (query && query.trim()) {
      const term = query.trim();
      // Phase 4-B STEP7: phone은 하이픈 포함 형식으로 저장되므로, 사용자가
      // 하이픈 없이(01012345678) 또는 다르게 입력해도 동일하게 찾히도록 검색어를
      // 저장 형식과 동일한 방식(formatPhoneNumber)으로 재정규화해 함께 매칭한다.
      const digits = digitsOnly(term);
      const phoneVariant = digits.length >= 8 ? formatPhoneNumber(digits) : null;
      const phoneClause = phoneVariant && phoneVariant !== term ? `,phone.ilike.%${phoneVariant}%` : "";
      q = q.or(
        `name.ilike.%${term}%,phone.ilike.%${term}%${phoneClause},address.ilike.%${term}%,customer_code.ilike.%${term}%`
      );
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await q
      .order(sortBy ?? "created_at", { ascending: sortBy ? sortAscending : false, nullsFirst: false })
      .range(from, to);
    if (error) throw error;
    return { customers: (data as Customer[]) ?? [], total: count ?? 0 };
  },

  async create(input: CustomerInsert): Promise<Customer> {
    const { data, error } = await getSupabaseAdmin().from("customers").insert(input).select("*").single();
    if (error) throw error;
    return data;
  },

  /** Batch import: one INSERT for every new customer discovered in a file, instead of one round-trip per row. */
  async createMany(inputs: CustomerInsert[]): Promise<Customer[]> {
    if (inputs.length === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("customers").insert(inputs).select("*");
    if (error) throw error;
    return data ?? [];
  },

  /** Batch import: the owner's entire customer pool fetched once, then matched in memory (name/phone/address dedup rules unchanged) instead of 2-3 lookup queries per row. */
  async findAllByOwner(ownerUsername: string): Promise<Customer[]> {
    const { data, error } = await getSupabaseAdmin().from("customers").select("*").eq("owner_username", ownerUsername);
    if (error) throw error;
    return data ?? [];
  },

  /**
   * P8 3번: "신규 주문 vs 반복 주문"을 정확히 정의하려면(고객 레코드가
   * 새로 생겼는지가 아니라, 이 주문이 그 고객의 진짜 첫 주문인지) Import
   * 실행 전 각 고객의 기존 주문 수를 알아야 한다. 이미 있는
   * customer_order_stats 뷰(취소 제외 집계)를 그대로 재사용 — 새 테이블/
   * 마이그레이션 없이 배치로 한 번에 조회한다.
   */
  async findOrderCounts(customerIds: string[]): Promise<Map<string, number>> {
    if (customerIds.length === 0) return new Map();
    const { data, error } = await getSupabaseAdmin()
      .from("customer_order_stats")
      .select("customer_id, total_orders")
      .in("customer_id", customerIds);
    if (error) throw error;
    return new Map((data ?? []).map((r) => [r.customer_id as string, r.total_orders as number]));
  },

  /** F15: ownerUsername이 주어지면(비-admin 호출) DB 쿼리에도 소유권 조건을 건다. */
  async update(id: string, input: CustomerUpdate, ownerUsername?: string): Promise<Customer> {
    let q = getSupabaseAdmin().from("customers").update(input).eq("id", id);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("고객을 찾을 수 없거나 권한이 없습니다.");
    return data;
  },

  /** P10-3: F15-1 패턴과 동일하게 repository 레벨에도 소유권 필터를 건다 — action 레벨 사전 체크에만 의존하지 않는 이중 검증. */
  async delete(id: string, ownerUsername?: string): Promise<void> {
    let q = getSupabaseAdmin().from("customers").delete().eq("id", id);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("고객을 찾을 수 없거나 권한이 없습니다.");
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
    Pick<Customer, "id" | "name" | "phone" | "address_normalized" | "owner_username" | "tenant_id">[]
  > {
    const { data, error } = await getSupabaseAdmin()
      .from("customers")
      .select("id, name, phone, address_normalized, owner_username, tenant_id")
      .neq("status", "merged")
      .not("phone", "is", null)
      .not("address_normalized", "is", null);
    if (error) throw error;
    return data ?? [];
  },
};
