"use server";

import { requireSession } from "@/lib/auth/current-session";
import { getColumnView, saveColumnView } from "@/lib/services/column-view-settings.service";

export async function getColumnViewAction(viewId: string): Promise<string[] | null> {
  const session = await requireSession();
  return getColumnView(viewId, session.username);
}

export async function saveColumnViewAction(viewId: string, visible: string[]): Promise<{ ok: boolean }> {
  const session = await requireSession();
  await saveColumnView(viewId, session.username, visible);
  return { ok: true };
}
