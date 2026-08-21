import dotenv from "dotenv";
dotenv.config({ path: "./.env.local" });
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getSupabaseAdmin } from "../src/lib/supabase/admin";
import { triggerDeliveryGroupRegeneration } from "../src/lib/services/delivery-group-regeneration.service";

/**
 * S2-0 §22 P0 백필: S1 Phase 5에서 배송그룹화 단위가 주문→배송건으로
 * 바뀌면서, 배포 시점에 이미 존재하던 배송건들은 그룹 재계산을 트리거하는
 * 쓰기 이벤트(주문 생성/수정/취소/Excel import)가 그 이후로 없었기 때문에
 * order_shipments.delivery_group_id가 전부 null로 남아있었다(조사 결과
 * 566건 중 0건 연결). 새 코드/알고리즘을 추가하지 않고, 이미 매 주문
 * 생성/수정 시 호출되는 것과 완전히 동일한 함수(triggerDeliveryGroupRegeneration)를
 * 기존에 존재하던 (tenant, 배송일) 조합에 대해 한 번씩만 다시 실행한다.
 */
async function main() {
  const admin = getSupabaseAdmin();

  // 1) 백업 — 손댈 수 있는 두 테이블(order_shipments.delivery_group_id, delivery_groups) 전체를 스냅샷.
  const snapshotDir = join(process.cwd(), "scratch-snapshots");
  if (!existsSync(snapshotDir)) mkdirSync(snapshotDir, { recursive: true });
  const stamp = Date.now();

  const { data: shipmentsBefore, error: shErr } = await admin
    .from("order_shipments")
    .select("id, tenant_id, owner_username, delivery_date, delivery_status, delivery_group_id");
  if (shErr) throw shErr;
  writeFileSync(join(snapshotDir, `p0-backfill-order_shipments-${stamp}.json`), JSON.stringify(shipmentsBefore, null, 2));

  const { data: groupsBefore, error: grErr } = await admin.from("delivery_groups").select("*");
  if (grErr) throw grErr;
  writeFileSync(join(snapshotDir, `p0-backfill-delivery_groups-${stamp}.json`), JSON.stringify(groupsBefore, null, 2));

  console.log(`[backup] order_shipments 스냅샷: ${shipmentsBefore?.length ?? 0}행`);
  console.log(`[backup] delivery_groups 스냅샷: ${groupsBefore?.length ?? 0}행`);

  // 2) 재계산 대상 (tenant_id, owner_username, delivery_date) 조합 — 취소 제외, 배송일 있는 것만.
  const seen = new Map<string, { tenantId: string; owner: string; date: string }>();
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await admin
      .from("order_shipments")
      .select("tenant_id, owner_username, delivery_date")
      .neq("delivery_status", "취소")
      .not("delivery_date", "is", null)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const dateStr = String(row.delivery_date).slice(0, 10);
      const key = `${row.tenant_id}|${dateStr}`;
      if (!seen.has(key)) seen.set(key, { tenantId: row.tenant_id, owner: row.owner_username, date: dateStr });
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  console.log(`\n재계산 대상 (tenant, 배송일) 조합: ${seen.size}개`);

  // 3) 실행 — 이미 매 쓰기 이벤트마다 호출되는 것과 동일한 함수를 재사용.
  const failed: string[] = [];
  for (const { tenantId, owner, date } of seen.values()) {
    try {
      await triggerDeliveryGroupRegeneration(tenantId, date, owner);
      console.log(`  OK  tenant=${owner} date=${date}`);
    } catch (e) {
      failed.push(`${owner}/${date}: ${e}`);
      console.log(`  FAIL tenant=${owner} date=${date} — ${e}`);
    }
  }

  // 4) 검증 — 완료/취소 상태 분포가 그대로인지 + 그룹 연결 현황.
  const { data: shipmentsAfter, error: shErr2 } = await admin
    .from("order_shipments")
    .select("id, delivery_status, delivery_group_id");
  if (shErr2) throw shErr2;

  const statusBefore = new Map<string, number>();
  for (const s of shipmentsBefore ?? []) statusBefore.set(s.delivery_status, (statusBefore.get(s.delivery_status) ?? 0) + 1);
  const statusAfter = new Map<string, number>();
  for (const s of shipmentsAfter ?? []) statusAfter.set(s.delivery_status, (statusAfter.get(s.delivery_status) ?? 0) + 1);

  console.log("\n=== 배송상태 분포 (백필 전후 동일해야 함) ===");
  console.log("전:", Object.fromEntries(statusBefore));
  console.log("후:", Object.fromEntries(statusAfter));

  const activeAfter = (shipmentsAfter ?? []).filter((s) => s.delivery_status !== "취소");
  const withGroupAfter = activeAfter.filter((s) => s.delivery_group_id !== null);
  console.log("\n=== 백필 결과 ===");
  console.log(`전체 배송건(취소 제외): ${activeAfter.length}`);
  console.log(`그룹 연결된 배송건: ${withGroupAfter.length}`);
  console.log(`미그룹 배송건: ${activeAfter.length - withGroupAfter.length}`);

  if (failed.length > 0) {
    console.log(`\n실패한 조합 ${failed.length}개:`, failed);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("백필 스크립트 오류:", e);
  process.exitCode = 1;
});
