import "server-only";
import { settingsRepository } from "@/lib/repositories/settings.repository";
import type { ImportDateFilterMode } from "@/types/excel";

/**
 * STEP14(CPO 작업지시, 2026-09-05) — 사업장마다 반복되는 "주문 가져오기 범위"를
 * 기억한다. 매일 오늘 주문만 접수하는 사장님이 매번 같은 판단을 다시 하지 않게
 * 하는 것이 목적이다.
 *
 * 저장소는 `import-mapping-settings.service.ts`(STD-4)와 **완전히 같은 패턴**을
 * 재사용한다 — `app_settings`의 계정별 네임스페이스 키. 이번 요구 때문에 새
 * 설정 테이블이나 tenants 컬럼을 만들지 않는다(migration 없음).
 *
 * 핵심 정책 3가지:
 *   1. 기본값은 기억한다.
 *   2. 이번 업로드 선택은 자유롭게 바꿀 수 있다.
 *   3. 기본값 변경은 사용자가 **명시적으로** 선택했을 때만 한다.
 * 그래서 저장 함수는 화면의 체크박스가 켜졌을 때만 호출되며, 업로드 진행
 * 자체가 기본값을 바꾸는 경로는 존재하지 않는다.
 *
 * 미설정(null)을 정상 상태로 허용한다 — 기존 사장님의 운영 방식을 추측해서
 * today/all 중 하나로 자동 판단하지 않는다.
 */
function settingsKeyFor(ownerUsername: string): string {
  return `import_order_scope:${ownerUsername}`;
}

interface StoredScope {
  mode: ImportDateFilterMode;
}

const VALID_MODES: ImportDateFilterMode[] = ["all", "today", "specific_date"];

export async function getDefaultImportScope(ownerUsername: string): Promise<ImportDateFilterMode | null> {
  const stored = await settingsRepository.get<StoredScope>(settingsKeyFor(ownerUsername));
  const mode = stored?.mode;
  return mode && VALID_MODES.includes(mode) ? mode : null;
}

export async function saveDefaultImportScope(ownerUsername: string, mode: ImportDateFilterMode): Promise<void> {
  if (!VALID_MODES.includes(mode)) throw new Error(`허용되지 않은 주문 범위입니다: ${mode}`);
  await settingsRepository.set<StoredScope>(settingsKeyFor(ownerUsername), { mode });
}
