"use server";

import { requireSession } from "@/lib/auth/current-session";
import { getColumnView, saveColumnView } from "@/lib/services/column-view-settings.service";
import { getAvailableExtraColumns } from "@/lib/services/order-extra-columns.service";

export async function getColumnViewAction(viewId: string): Promise<string[] | null> {
  const session = await requireSession();
  return getColumnView(viewId, session.username);
}

export async function saveColumnViewAction(viewId: string, visible: string[]): Promise<{ ok: boolean }> {
  const session = await requireSession();
  await saveColumnView(viewId, session.username, visible);
  return { ok: true };
}

/** UX11: 이 계정이 실제로 올린 엑셀에 있던 원본 컬럼 목록(표시 컬럼 후보). */
export async function getAvailableExtraColumnsAction(): Promise<string[]> {
  const session = await requireSession();
  return getAvailableExtraColumns(session.username);
}
