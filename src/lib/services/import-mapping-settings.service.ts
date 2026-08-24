import "server-only";
import { settingsRepository } from "@/lib/repositories/settings.repository";
import type { ColumnMapping } from "@/types/excel";

// STD-4: vip.service.ts의 계정별 app_settings 키 네임스페이싱 패턴을 그대로
// 재사용 — 계정마다 가장 최근에 확정한 컬럼 매핑 1개만 보관한다(여러 형식을
// 동시에 저장/선택하는 기능이 아니라, "다음부터 같은 형식은 자동매핑"이라는
// 요구를 만족하는 최소 구현).
function settingsKeyFor(ownerUsername: string): string {
  return `import_column_mapping:${ownerUsername}`;
}

export async function getSavedColumnMapping(ownerUsername: string): Promise<ColumnMapping | null> {
  return settingsRepository.get<ColumnMapping>(settingsKeyFor(ownerUsername));
}

export async function saveColumnMapping(ownerUsername: string, mapping: ColumnMapping): Promise<void> {
  await settingsRepository.set(settingsKeyFor(ownerUsername), mapping);
}
