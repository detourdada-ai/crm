import "server-only";
import { settingsRepository } from "@/lib/repositories/settings.repository";

// STD-9: vip.service.ts/import-mapping-settings.service.ts와 동일한 계정별
// app_settings 네임스페이싱 패턴 — 화면(viewId)마다, 계정마다 노출 컬럼
// 목록을 따로 저장한다. 저장된 값이 없으면(첫 방문) null을 반환해
// 호출자가 "전체 노출"을 기본값으로 쓰게 한다.
function settingsKeyFor(viewId: string, ownerUsername: string): string {
  return `column_view:${viewId}:${ownerUsername}`;
}

export async function getColumnView(viewId: string, ownerUsername: string): Promise<string[] | null> {
  const value = await settingsRepository.get<{ visible: string[] }>(settingsKeyFor(viewId, ownerUsername));
  return Array.isArray(value?.visible) ? value.visible : null;
}

export async function saveColumnView(viewId: string, ownerUsername: string, visible: string[]): Promise<void> {
  await settingsRepository.set(settingsKeyFor(viewId, ownerUsername), { visible });
}
