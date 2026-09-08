import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ImportRecord, ImportRowError, ImportStatus } from "@/types/domain";

export interface ImportInsert {
  file_name: string;
  status?: ImportStatus;
  total_rows?: number;
  owner_username: string;
  tenant_id: string;
  /** STEP19: 원본 엑셀 storage 경로. 보관에 실패했거나 이 기능 이전 건이면 null. */
  file_path?: string | null;
}

export interface ImportUpdate {
  status?: ImportStatus;
  total_rows?: number;
  success_rows?: number;
  failed_rows?: number;
  new_customers?: number;
  existing_customers?: number;
  duplicate_candidates?: number;
  already_imported_rows?: number;
  column_mapping?: Record<string, string> | null;
  error_log?: ImportRowError[] | null;
}

export const importsRepository = {
  async create(input: ImportInsert): Promise<ImportRecord> {
    const { data, error } = await getSupabaseAdmin().from("imports").insert(input).select("*").single();
    if (error) throw error;
    return data as ImportRecord;
  },

  async update(id: string, input: ImportUpdate): Promise<ImportRecord> {
    const { data, error } = await getSupabaseAdmin().from("imports").update(input).eq("id", id).select("*").single();
    if (error) throw error;
    return data as ImportRecord;
  },

  async findById(id: string): Promise<ImportRecord | null> {
    const { data, error } = await getSupabaseAdmin().from("imports").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data as ImportRecord | null;
  },

  /**
   * STEP19 후속: `sinceIso`를 주면 그 시각 이후 이력만 돌려준다(사장님 화면 7일 노출).
   * 생략하면 기존과 동일하게 기간 제한 없이 최근 N건이다.
   */
  async listRecent(limit = 20, ownerUsername?: string, sinceIso?: string): Promise<ImportRecord[]> {
    let q = getSupabaseAdmin().from("imports").select("*");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return (data as ImportRecord[]) ?? [];
  },

  /**
   * STEP19 후속: 보관기간이 지난 이력. cron은 전 테넌트를 대상으로 호출한다.
   * `ownerUsername`은 QA가 자기 테넌트로 범위를 좁혀 검증하기 위한 것 —
   * 운영 데이터를 건드리지 않고 경계 조건을 확인할 수 있게 한다.
   */
  async listExpired(beforeIso: string, ownerUsername?: string): Promise<Pick<ImportRecord, "id" | "file_path">[]> {
    let q = getSupabaseAdmin().from("imports").select("id, file_path").lt("created_at", beforeIso);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q;
    if (error) throw error;
    return (data as Pick<ImportRecord, "id" | "file_path">[]) ?? [];
  },

  /**
   * STEP19 후속: 이력 행만 지운다 — **주문/고객은 건드리지 않는다.**
   * `orders.import_id`/`customers.created_by_import_id`는 `on delete set null`이라
   * 연결만 끊기고 데이터는 그대로 남는다. 보관기간이 끝났다고 사장님의 실제 주문을
   * 지우는 일은 절대 없어야 하므로, 주문까지 지우는 `deleteImport()`와 분리해 둔다.
   */
  async deleteRowsOnly(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { data, error } = await getSupabaseAdmin().from("imports").delete().in("id", ids).select("id");
    if (error) throw error;
    return (data ?? []).length;
  },

  /** P10-3: F15-1 패턴과 동일하게 repository 레벨에도 소유권 필터를 건다 — action 레벨 사전 체크에만 의존하지 않는 이중 검증. */
  async delete(id: string, ownerUsername?: string): Promise<void> {
    let q = getSupabaseAdmin().from("imports").delete().eq("id", id);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("업로드 이력을 찾을 수 없거나 권한이 없습니다.");
  },

  /** P5: "전체 삭제" — 지정한 계정 소속 이력의 id를 전부(20건 limit 없이) 가져온다. */
  async listIdsByOwner(ownerUsername: string): Promise<string[]> {
    const { data, error } = await getSupabaseAdmin().from("imports").select("id").eq("owner_username", ownerUsername);
    if (error) throw error;
    return (data ?? []).map((r) => r.id as string);
  },
};
