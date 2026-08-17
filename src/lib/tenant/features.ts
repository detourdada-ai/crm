import "server-only";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import type { SessionPayload } from "@/lib/auth/session";
import type { Tenant } from "@/types/domain";

/**
 * Phase 10 (업종 기반 Tenant Feature): 화면에서는 `tenant.bag_management`를
 * 직접 읽지 않고 이 판정 결과(TenantFeatures)만 사용한다 — 나중에
 * deliveryOption/containerManagement 등이 추가돼도 화면 쪽 코드는 바뀌지
 * 않고 이 파일의 판정 로직만 확장하면 된다. `if (industry === "반찬")` 같은
 * 하드코딩은 여기서도, 다른 어디서도 하지 않는다 — 업종은 추천값 산정에만
 * 쓰이고(src/lib/constants/industry.ts) 실제 판정은 저장된 feature 컬럼만 본다.
 */
export interface TenantFeatures {
  bagManagement: boolean;
}

export function resolveTenantFeatures(tenant: Pick<Tenant, "bag_management"> | null): TenantFeatures {
  return { bagManagement: tenant?.bag_management ?? false };
}

/**
 * admin은 여러 tenant의 데이터를 한 화면(owner_username 필터 없이)에 함께
 * 보므로, 자기 자신의 tenant 설정 하나만으로 컬럼을 숨기면 다른 tenant의
 * 가방 데이터가 오히려 안 보이게 된다 — 플랫폼 운영자 시점에서는 항상 켜둔다.
 */
export async function getTenantFeaturesForSession(session: SessionPayload): Promise<TenantFeatures> {
  if (session.role === "admin") return { bagManagement: true };
  if (session.role === "driver") return { bagManagement: false };
  const tenant = await tenantsRepository.findByUsername(session.username);
  return resolveTenantFeatures(tenant);
}
