/**
 * Safety wrapper for scratch scripts that need to mutate rows in the shared
 * Production Supabase DB for reproduction/verification purposes.
 *
 * Added 2026-08-19 after a real incident: a scratch script overwrote 6 real
 * orders' coordinates without a disk-backed snapshot, and the in-memory
 * backup was lost when the script exited early. See AGENTS.md's
 * "Production DB 안전 규칙" section for the full policy this enforces.
 *
 * Usage:
 *   import { withSnapshot } from "../scripts/safe-scratch";
 *
 *   await withSnapshot({ table: "orders", ids: [...] }, async (originalRows) => {
 *     // ...mutate, verify...
 *   });
 *
 * withSnapshot refuses to run if any target row's owner isn't in
 * ALLOWED_TEST_OWNERS, writes a full snapshot to disk before touching
 * anything, and always reverts from that snapshot in a `finally` block —
 * there is no flag to skip the revert. If you need to inspect the mutated
 * state in a browser, do it inside the callback (before it returns), not by
 * skipping revert.
 */
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getSupabaseAdmin } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type TableName = keyof Database["public"]["Tables"];

/**
 * Only these owner_username values may be targeted by a mutating scratch
 * script. Add a new test tenant here explicitly (with a comment saying why)
 * rather than picking whichever account happens to have the most rows.
 *
 * STEP12-17(2026-09-03, CPO 지시 — WORKSTREAM C): `user4`/`user5`도 여기서 뺐다.
 * 두 tenant에는 실명·실전화·실제 스토어 export 근거가 있는 데이터가 들어와 있어
 * "실제 업무 데이터"로 판정됐다(docs/qa/S13-STABILIZATION-SPRINT/CTO-REPORT.md §1).
 * 이제 QA 쓰기가 허용되는 tenant는 `user3` 하나뿐이며, 목록에 없는 tenant에 대한
 * 쓰기 시도는 예외로 즉시 중단된다(기본 거부). 교차 tenant 격리 검증처럼 두 번째
 * tenant가 꼭 필요한 QA는 CPO가 전용 QA tenant를 새로 만들어줄 때까지 fail-fast
 * 시키는 것이 의도된 동작이었다.
 *
 * STEP12-18(2026-09-03, CPO 승인): 그 "전용 QA tenant"로 `user6`을 만들었다
 * (scripts/qa/provision-qa-tenant.ts — 실서비스와 같은 create_seller_signup 경로).
 * 이제 QA 쓰기가 허용되는 tenant는 `user3`(주) / `user6`(보조) 둘뿐이고,
 * 교차 tenant 격리 검증은 이 둘 사이에서 한다 — 실데이터 tenant는 관여하지 않는다.
 *
 * STEP8(2026-08-27, CPO 지시): `user2`는 실제 사장님이 테스트를 진행 중인
 * 것으로 확인되어(394건 규모 Excel import 등) 여기서 뺐다 — QA 기본
 * tenant는 `user3`, 교차 tenant 격리 검증이 필요한 스크립트는 `user4`를
 * 보조로 쓴다(scripts/qa/lib/qa-config.ts 참고). `user2`가 다시 순수
 * QA 전용으로 정리되면 CPO 승인 하에 재추가한다.
 */
export const ALLOWED_TEST_OWNERS = ["user3", "user6"];

interface WithSnapshotOptions {
  table: TableName;
  ids: string[];
  /** Column to check against ALLOWED_TEST_OWNERS. Defaults to "owner_username". */
  ownerColumn?: string;
}

export async function withSnapshot<T>(
  opts: WithSnapshotOptions,
  fn: (originalRows: Record<string, unknown>[]) => Promise<T>
): Promise<T> {
  const supabase = getSupabaseAdmin();
  const ownerColumn = opts.ownerColumn ?? "owner_username";

  const { data: rawRows, error } = await supabase.from(opts.table).select("*").in("id", opts.ids);
  if (error) throw error;
  if (!rawRows || rawRows.length !== opts.ids.length) {
    throw new Error(
      `safe-scratch: expected ${opts.ids.length} rows in "${opts.table}", found ${rawRows?.length ?? 0}. Refusing to proceed — check the ids.`
    );
  }
  // Generic multi-table utility — the strict per-table Supabase types don't
  // express "arbitrary column access by dynamic table name" cleanly, so this
  // is intentionally widened to a plain record shape.
  const rows = rawRows as unknown as Record<string, unknown>[];

  const offenders = rows.filter((r) => !ALLOWED_TEST_OWNERS.includes(String(r[ownerColumn])));
  if (offenders.length > 0) {
    const bad = [...new Set(offenders.map((r) => String(r[ownerColumn])))];
    throw new Error(
      `safe-scratch: refusing to mutate "${opts.table}" rows outside the test-tenant allowlist (${ALLOWED_TEST_OWNERS.join(", ")}). ` +
        `Found real-looking owner(s): ${bad.join(", ")}. If this is genuinely a new test tenant, add it to ALLOWED_TEST_OWNERS explicitly.`
    );
  }

  const snapshotDir = join(process.cwd(), "scratch-snapshots");
  if (!existsSync(snapshotDir)) mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = join(snapshotDir, `${opts.table}-${Date.now()}.json`);
  writeFileSync(snapshotPath, JSON.stringify(rows, null, 2));
  console.log(`[safe-scratch] snapshot saved: ${snapshotPath} (${rows.length} row(s) from "${opts.table}")`);

  try {
    return await fn(rows);
  } finally {
    console.log(`[safe-scratch] reverting "${opts.table}" from snapshot...`);
    for (const row of rows) {
      const { id, ...fields } = row as { id: string; [key: string]: unknown };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic multi-table revert, see comment above
      const { error: revertErr } = await (supabase.from(opts.table) as any).update(fields).eq("id", id);
      if (revertErr) {
        console.error(`[safe-scratch] REVERT FAILED for ${opts.table}.${id}:`, revertErr);
        console.error(`[safe-scratch] Manual recovery needed — snapshot is still at ${snapshotPath}`);
      }
    }
    console.log("[safe-scratch] revert complete.");
  }
}
