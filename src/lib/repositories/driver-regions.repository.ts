import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { normalizeSido } from "@/lib/constants/region";
import type { DriverRegion } from "@/types/domain";

export interface DriverRegionInsert {
  driver_id: string;
  sido: string;
  sigungu?: string | null;
  eupmyeondong?: string | null;
  owner_username: string;
  tenant_id: string;
}

export interface DriverRegionCandidate extends DriverRegion {
  /** 더 구체적인 지정일수록 낮은 숫자(=더 높은 우선순위). 읍면동=0, 시군구=1, 시도전체=2. */
  priority: number;
}

export const driverRegionsRepository = {
  async listByDriverId(driverId: string): Promise<DriverRegion[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("driver_regions")
      .select("*")
      .eq("driver_id", driverId)
      .order("created_at");
    if (error) throw error;
    return data ?? [];
  },

  /** ownerUsername 생략 시(admin) 전체 계정의 담당지역을 반환 — 기사 목록 화면에서 N+1 방지용 일괄 조회. */
  async listByOwnerUsername(ownerUsername?: string): Promise<DriverRegion[]> {
    let q = getSupabaseAdmin().from("driver_regions").select("*");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("created_at");
    if (error) throw error;
    return data ?? [];
  },

  async create(input: DriverRegionInsert): Promise<DriverRegion> {
    const { data, error } = await getSupabaseAdmin().from("driver_regions").insert(input).select("*").single();
    if (error) throw error;
    return data;
  },

  /** F15 패턴을 따름: ownerUsername이 주어지면(비-admin 호출) DB 쿼리에도 소유권 조건을 건다. */
  async delete(id: string, ownerUsername?: string): Promise<void> {
    let q = getSupabaseAdmin().from("driver_regions").delete().eq("id", id);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("담당지역을 찾을 수 없거나 권한이 없습니다.");
  },

  /**
   * Phase 1: 특정 배송지(시도/시군구/읍면동)를 담당할 수 있는 기사 후보를
   * 우선순위(더 구체적인 지정 우선) 순으로 반환한다. 같은 지역에 기사가
   * 여럿이어도 최종 배정을 자동 확정하지 않는다 — 후보 목록만 제공한다
   * (작업지시서 원칙: 배정은 여전히 사람이 배송관리 화면에서 직접 한다).
   */
  async findCandidates(params: {
    ownerUsername?: string;
    sido: string | null;
    sigungu: string | null;
    eupmyeondong: string | null;
  }): Promise<DriverRegionCandidate[]> {
    const sido = normalizeSido(params.sido);
    if (!sido) return [];
    let q = getSupabaseAdmin().from("driver_regions").select("*").eq("sido", sido);
    if (params.ownerUsername) q = q.eq("owner_username", params.ownerUsername);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as DriverRegion[];

    return rows
      .filter((r) => {
        if (r.sigungu && r.sigungu !== params.sigungu) return false;
        if (r.eupmyeondong && r.eupmyeondong !== params.eupmyeondong) return false;
        return true;
      })
      .map((r) => ({ ...r, priority: r.eupmyeondong ? 0 : r.sigungu ? 1 : 2 }))
      .sort((a, b) => a.priority - b.priority);
  },

  /**
   * P0(기사관리 3건) 3번: 배송관리 화면에서 여러 주문을 한 번에 선택했을 때
   * 그 주문들의 배송지를 담당하는 기사 후보를 한 번의 쿼리로 조회한다.
   * findCandidates(단일 지역용)를 재사용/수정하지 않고 별도로 구현 —
   * 여러 지역을 한꺼번에 물어봐야 하는 N+1 방지 목적의 배치 메서드다.
   * 자동배정에는 쓰지 않는다 — 호출부에서 정렬/라벨 힌트로만 사용해야 한다.
   * 지역마다 ownerUsername을 함께 받아 매칭한다 — admin은 서로 다른
   * 테넌트의 주문을 동시에 선택할 수 있어, 전역 필터 하나로는 다른
   * 테넌트 기사가 후보에 섞여 나오는 tenant 격리 누락이 생길 수 있다.
   */
  async findCandidateDriverIdsForRegions(
    regions: { ownerUsername: string; sido: string | null; sigungu: string | null; eupmyeondong: string | null }[]
  ): Promise<string[]> {
    const normalizedRegions = regions.map((r) => ({ ...r, sido: normalizeSido(r.sido) }));
    const sidoList = Array.from(new Set(normalizedRegions.map((r) => r.sido).filter((s): s is string => !!s)));
    if (sidoList.length === 0) return [];

    const { data, error } = await getSupabaseAdmin().from("driver_regions").select("*").in("sido", sidoList);
    if (error) throw error;
    const rows = (data ?? []) as DriverRegion[];

    const matches = new Set<string>();
    for (const region of normalizedRegions) {
      if (!region.sido) continue;
      for (const r of rows) {
        if (r.owner_username !== region.ownerUsername) continue;
        if (r.sido !== region.sido) continue;
        if (r.sigungu && r.sigungu !== region.sigungu) continue;
        if (r.eupmyeondong && r.eupmyeondong !== region.eupmyeondong) continue;
        matches.add(r.driver_id);
      }
    }
    return Array.from(matches);
  },
};
