import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * STEP15-F3D-2 — 단가 정책 저장소.
 *
 * dispatch나 화면이 `message_pricing_policies`를 직접 select하지 않게 막는 유일한 문이다.
 * 정책 선택 규칙이 여러 곳에 흩어지면 "어떤 가격이 적용됐는지"를 나중에 추적할 수 없다.
 *
 * 가격 변경은 UPDATE가 아니라 **새 정책 생성**이다(v1 retired → v2 active).
 * 활성화된 정책의 단가·축은 DB 트리거가 잠그므로 여기에 수정 API를 두지 않는다.
 */

export type PricingPolicyStatus = "draft" | "active" | "retired";
/** 메시지의 **목적**. 형태(alimtalk/sms/lms)와는 다른 축이다. */
export type PricingKind = "transactional" | "customer_notice" | "marketing";
export type PricingMessageType = "alimtalk" | "sms" | "lms";

export interface PricingPolicyScope {
  /** null이면 플랫폼 공통(global) 정책. */
  ownerUsername: string | null;
  kind: PricingKind;
  messageType: PricingMessageType;
  provider: string;
}

export interface PricingPolicyRow {
  id: string;
  owner_username: string | null;
  kind: string;
  message_type: string;
  provider: string;
  unit_price: number;
  amount_unit: string;
  provider_cost: number | null;
  status: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  activated_at: string | null;
  retired_at: string | null;
}

const COLUMNS =
  "id, owner_username, kind, message_type, provider, unit_price, amount_unit, provider_cost, status, note, created_by, created_at, activated_at, retired_at";

export interface StoreResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export const pricingPolicyStore = {
  /** 항상 draft로 만든다. 만들자마자 발송에 쓰이는 가격이 생기지 않게 한다. */
  async createPolicy(input: {
    scope: PricingPolicyScope;
    unitPrice: number;
    providerCost?: number | null;
    note?: string | null;
    createdBy?: string | null;
  }): Promise<StoreResult<PricingPolicyRow>> {
    try {
      const { data, error } = await getSupabaseAdmin()
        .from("message_pricing_policies")
        .insert({
          owner_username: input.scope.ownerUsername,
          kind: input.scope.kind,
          message_type: input.scope.messageType,
          provider: input.scope.provider,
          unit_price: input.unitPrice,
          provider_cost: input.providerCost ?? null,
          note: input.note ?? null,
          created_by: input.createdBy ?? null,
          status: "draft",
        })
        .select(COLUMNS)
        .maybeSingle();
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: (data as PricingPolicyRow) ?? undefined };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "create_failed" };
    }
  },

  /**
   * draft → active. 같은 범위에 이미 active가 있으면 **DB의 부분 unique 인덱스가
   * 거부한다** — 앱에서 먼저 조회해 막는 방식은 동시 요청에서 새기 때문에 쓰지 않는다.
   */
  async activatePolicy(id: string): Promise<StoreResult<PricingPolicyRow>> {
    try {
      const { data, error } = await getSupabaseAdmin()
        .from("message_pricing_policies")
        .update({ status: "active", activated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "draft")
        .select(COLUMNS)
        .maybeSingle();
      if (error) return { ok: false, error: error.message };
      if (!data) return { ok: false, error: "not_draft_or_missing" };
      return { ok: true, data: data as PricingPolicyRow };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "activate_failed" };
    }
  },

  /** active → retired. 과거 로그의 참조는 그대로 남는다(삭제가 아니라 은퇴다). */
  async retirePolicy(id: string): Promise<StoreResult<PricingPolicyRow>> {
    try {
      const { data, error } = await getSupabaseAdmin()
        .from("message_pricing_policies")
        .update({ status: "retired", retired_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "active")
        .select(COLUMNS)
        .maybeSingle();
      if (error) return { ok: false, error: error.message };
      if (!data) return { ok: false, error: "not_active_or_missing" };
      return { ok: true, data: data as PricingPolicyRow };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "retire_failed" };
    }
  },

  /**
   * 주어진 범위의 **활성 정책 1건**. 없으면 `data: undefined`, 조회가 이상하면 `ok:false`.
   *
   * `maybeSingle()`을 쓰는 것이 핵심이다 — 같은 범위에 active가 2건이면 에러가 나고,
   * 그 에러를 삼켜 "첫 번째 행"을 고르지 않는다. 어떤 가격인지 확신할 수 없으면
   * 보내지 않는 쪽이 안전하다.
   */
  async findActivePolicy(scope: PricingPolicyScope): Promise<StoreResult<PricingPolicyRow | undefined>> {
    try {
      let q = getSupabaseAdmin()
        .from("message_pricing_policies")
        .select(COLUMNS)
        .eq("kind", scope.kind)
        .eq("message_type", scope.messageType)
        .eq("provider", scope.provider)
        .eq("status", "active");
      q = scope.ownerUsername === null ? q.is("owner_username", null) : q.eq("owner_username", scope.ownerUsername);

      const { data, error } = await q.maybeSingle();
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: (data as PricingPolicyRow) ?? undefined };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "lookup_failed" };
    }
  },

  async listPolicies(limit = 100): Promise<PricingPolicyRow[]> {
    try {
      const { data } = await getSupabaseAdmin()
        .from("message_pricing_policies")
        .select(COLUMNS)
        .order("created_at", { ascending: false })
        .limit(limit);
      return (data as PricingPolicyRow[]) ?? [];
    } catch {
      return [];
    }
  },
};
