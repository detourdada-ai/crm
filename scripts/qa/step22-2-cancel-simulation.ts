/**
 * STEP22 2단계 **시뮬레이션 전용**(CPO 승인, 2026-09-08) — 자동 취소 후보를 계산만 한다.
 *
 * ★★ 이 스크립트는 취소를 실행하지 않는다. delivery_status를 바꾸지 않고, 주문/배송건을
 * 지우지 않으며, 배정·그룹도 건드리지 않는다. 판정 알고리즘이 실제 데이터에서 어떤
 * 결과를 내는지 확인하는 것이 전부다. 마지막에 UPDATE/DELETE가 0건이었음을 스스로 검증한다.
 *
 * 판정 알고리즘(아직 제품 코드로 확정하지 않는다 — CPO 지시):
 *   1. 이번 import에서 도장 찍힌 상품주문번호 = "이번 파일에 있었던 것"
 *   2. 그 주문들의 order_date 최소~최대 = **이번 파일이 실제로 커버한 구간**
 *   3. 후보 = last_seen_import_id IS NOT NULL AND != 이번 import
 *            AND order_date가 구간 안
 *            AND 수동주문(import_id IS NULL) 아님
 *            AND 이미 취소 아님
 *   4. 배송중/완료/배정/그룹은 **별도 분류만** 하고 자동 처리 대상으로 세지 않는다.
 *
 * 검증은 user3 QA 테넌트에 이번 실행이 만든 행으로만 하고 finally에서 전부 지운다.
 * user2 실데이터에는 **읽기 전용 집계만** 수행한다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step22-2-cancel-simulation.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, makeRunTag } from "./lib/qa-guard";

const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = makeRunTag("step22-2");
const admin = getSupabaseAdmin();

let pass = 0;
let fail = 0;
function record(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function dayIso(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86400000).toISOString();
}

// ───────────────────────────── 판정 알고리즘 (read-only) ─────────────────────────────

interface Candidate {
  orderId: string;
  pon: string | null;
  deliveryStatus: string;
  orderDate: string;
  hasShipment: boolean;
  hasDriver: boolean;
  hasGroup: boolean;
}

interface SimulationResult {
  window: { min: string | null; max: string | null };
  seenInCurrent: number;
  poolConsidered: number;
  excluded: { nullLastSeen: number; outOfWindow: number; manual: number; alreadyCancelled: number };
  candidates: Candidate[];
}

async function simulate(tenantId: string, currentImportId: string): Promise<SimulationResult> {
  // 1. 이번 import에서 도장 찍힌 상품주문번호 = 이번 파일에 있었던 것
  const { data: currentItems } = await admin
    .from("order_items")
    .select("order_id, product_order_number")
    .eq("tenant_id", tenantId)
    .eq("last_seen_import_id", currentImportId);
  const currentOrderIds = [...new Set((currentItems ?? []).map((i) => i.order_id as string))];

  // 2. 이번 파일이 커버한 주문일 구간 — orders.order_date 기준.
  //    (extra.주문일시도 있지만 스마트스토어 파일에만 있고 표준 엑셀에는 없어 신뢰할 수 없다.)
  let min: string | null = null;
  let max: string | null = null;
  for (let i = 0; i < currentOrderIds.length; i += 40) {
    const { data } = await admin.from("orders").select("order_date").in("id", currentOrderIds.slice(i, i + 40));
    for (const o of data ?? []) {
      const d = o.order_date as string | null;
      if (!d) continue;
      if (min === null || d < min) min = d;
      if (max === null || d > max) max = d;
    }
  }

  // 3. 비교 대상 풀 — 도장이 있고, 이번 import가 아닌 것
  const { data: pool } = await admin
    .from("order_items")
    .select("order_id, product_order_number, last_seen_import_id")
    .eq("tenant_id", tenantId)
    .not("last_seen_import_id", "is", null)
    .neq("last_seen_import_id", currentImportId);

  const excluded = { nullLastSeen: 0, outOfWindow: 0, manual: 0, alreadyCancelled: 0 };
  const candidates: Candidate[] = [];
  const poolOrderIds = [...new Set((pool ?? []).map((i) => i.order_id as string))];

  // null인 것은 위 쿼리에서 이미 빠졌다 — 몇 건이 빠졌는지는 따로 센다(검증용).
  const { count: nullCount } = await admin
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("last_seen_import_id", null);
  excluded.nullLastSeen = nullCount ?? 0;

  for (let i = 0; i < poolOrderIds.length; i += 40) {
    const chunk = poolOrderIds.slice(i, i + 40);
    const { data: orders } = await admin
      .from("orders")
      .select("id, order_date, delivery_status, import_id")
      .in("id", chunk);
    const { data: shipments } = await admin
      .from("order_shipments")
      .select("order_id, driver_id, delivery_group_id")
      .in("order_id", chunk);

    for (const o of orders ?? []) {
      const orderId = o.id as string;
      if (currentOrderIds.includes(orderId)) continue; // 이번 파일에 있었음 → 후보 아님
      if (o.import_id === null) {
        excluded.manual++;
        continue;
      }
      if (o.delivery_status === "취소") {
        excluded.alreadyCancelled++;
        continue;
      }
      const od = o.order_date as string | null;
      if (!od || min === null || max === null || od < min || od > max) {
        excluded.outOfWindow++;
        continue;
      }
      const mine = (shipments ?? []).filter((s) => s.order_id === orderId);
      candidates.push({
        orderId,
        pon: (pool ?? []).find((p) => p.order_id === orderId)?.product_order_number ?? null,
        deliveryStatus: String(o.delivery_status),
        orderDate: od,
        hasShipment: mine.length > 0,
        hasDriver: mine.some((s) => s.driver_id !== null),
        hasGroup: mine.some((s) => s.delivery_group_id !== null),
      });
    }
  }

  return { window: { min, max }, seenInCurrent: currentOrderIds.length, poolConsidered: poolOrderIds.length, excluded, candidates };
}

// ───────────────────────────── 시나리오 시드 (user3) ─────────────────────────────

const createdOrderIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdImportIds: string[] = [];

async function seedImport(tenantId: string, label: string): Promise<string> {
  const id = randomUUID();
  await admin.from("imports").insert({
    id,
    file_name: `QA-STEP22-2-${RUN_TAG}-${label}.xlsx`,
    status: "completed",
    total_rows: 1,
    owner_username: OWNER,
    tenant_id: tenantId,
  });
  createdImportIds.push(id);
  return id;
}

async function seedOrder(
  tenantId: string,
  label: string,
  opts: {
    orderDateOffsetDays: number;
    lastSeenImportId: string | null;
    importId: string | null;
    deliveryStatus?: "배송대기" | "배송중" | "완료" | "취소";
    withShipment?: boolean;
    withDriver?: string | null;
    withGroup?: string | null;
  }
): Promise<string> {
  const customerId = randomUUID();
  const orderId = randomUUID();
  const pon = `${RUN_TAG}-${label}`;
  await admin.from("customers").insert({
    id: customerId,
    name: `QA-STEP22-2-${RUN_TAG}-${label}-고객`,
    address: "서울 QA구 QA로 22",
    owner_username: OWNER,
    tenant_id: tenantId,
  });
  await admin.from("orders").insert({
    id: orderId,
    customer_id: customerId,
    internal_order_number: `QA-STEP22-2-${RUN_TAG}-${label}`,
    order_date: dayIso(opts.orderDateOffsetDays),
    recipient_name: `QA-STEP22-2-${RUN_TAG}-${label}-수령`,
    address_snapshot: "서울 QA구 QA로 22",
    delivery_date: dayIso(0),
    delivery_status: opts.deliveryStatus ?? "배송대기",
    fulfillment_method: "delivery" as const,
    owner_username: OWNER,
    tenant_id: tenantId,
    import_id: opts.importId,
  });
  createdCustomerIds.push(customerId);
  createdOrderIds.push(orderId);

  if (opts.withShipment !== false) {
    await admin.from("order_shipments").insert({
      id: randomUUID(),
      order_id: orderId,
      tenant_id: tenantId,
      owner_username: OWNER,
      delivery_date: dayIso(0),
      delivery_status: opts.deliveryStatus ?? "배송대기",
      fulfillment_method: "delivery" as const,
      driver_id: opts.withDriver ?? null,
      delivery_group_id: opts.withGroup ?? null,
    });
  }
  await admin.from("order_items").insert({
    id: randomUUID(),
    order_id: orderId,
    tenant_id: tenantId,
    product_name: "QA상품",
    quantity: 1,
    unit_price: 1000,
    amount: 1000,
    product_order_number: opts.importId === null ? null : pon,
    last_seen_import_id: opts.lastSeenImportId,
  });
  return orderId;
}

async function main() {
  await assertTenantIsQaSafe(OWNER);
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant!.id as string;

  console.log(`\n===== STEP22 2단계 시뮬레이션 (UPDATE/DELETE 없음) =====\n`);

  // 쓰기 0건 검증용 기준선
  const baseline = async () => {
    const { count: cancelled } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("owner_username", OWNER)
      .eq("delivery_status", "취소");
    const { count: orders } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER);
    const { count: ships } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("owner_username", OWNER);
    return { cancelled: cancelled ?? 0, orders: orders ?? 0, ships: ships ?? 0 };
  };

  try {
    const prevImport = await seedImport(tenantId, "prev");
    const olderImport = await seedImport(tenantId, "older");
    const curImport = await seedImport(tenantId, "cur");

    // 이번 파일 커버 구간을 -5일 ~ -1일로 만든다.
    await seedOrder(tenantId, "A-계속존재-경계min", { orderDateOffsetDays: -5, lastSeenImportId: curImport, importId: curImport });
    await seedOrder(tenantId, "A2-계속존재-경계max", { orderDateOffsetDays: -1, lastSeenImportId: curImport, importId: curImport });

    const caseB = await seedOrder(tenantId, "B-사라짐-범위안", { orderDateOffsetDays: -3, lastSeenImportId: prevImport, importId: prevImport });
    const caseC = await seedOrder(tenantId, "C-사라짐-범위밖", { orderDateOffsetDays: -20, lastSeenImportId: prevImport, importId: prevImport });
    const caseD = await seedOrder(tenantId, "D-도장없음", { orderDateOffsetDays: -3, lastSeenImportId: null, importId: prevImport });
    const caseE = await seedOrder(tenantId, "E-수동주문", { orderDateOffsetDays: -3, lastSeenImportId: null, importId: null });
    const caseF = await seedOrder(tenantId, "F-이미취소", { orderDateOffsetDays: -3, lastSeenImportId: prevImport, importId: prevImport, deliveryStatus: "취소" });
    const caseH = await seedOrder(tenantId, "H-건너뛴이전import", { orderDateOffsetDays: -3, lastSeenImportId: olderImport, importId: olderImport });
    const caseShipping = await seedOrder(tenantId, "배송중", { orderDateOffsetDays: -3, lastSeenImportId: prevImport, importId: prevImport, deliveryStatus: "배송중", withDriver: null });
    const caseDone = await seedOrder(tenantId, "완료", { orderDateOffsetDays: -3, lastSeenImportId: prevImport, importId: prevImport, deliveryStatus: "완료" });
    const caseNoShip = await seedOrder(tenantId, "배송건없음", { orderDateOffsetDays: -3, lastSeenImportId: prevImport, importId: prevImport, withShipment: false });

    const before = await baseline();
    const sim = await simulate(tenantId, curImport);
    const after = await baseline();

    const ids = new Set(sim.candidates.map((c) => c.orderId));
    console.log(`  파일 커버 구간: ${String(sim.window.min).slice(0, 10)} ~ ${String(sim.window.max).slice(0, 10)}`);
    console.log(`  이번 파일에 있던 주문 ${sim.seenInCurrent} / 비교 풀 ${sim.poolConsidered} / 후보 ${sim.candidates.length}\n`);

    record("Case A. 파일에 계속 존재 → 후보 아님", !ids.has(await Promise.resolve(createdOrderIds[0])));
    record("Case B. 사라짐 + 범위 안 → 후보", ids.has(caseB));
    record("Case C. 사라짐 + 범위 밖 → 후보 아님", !ids.has(caseC), `제외 ${sim.excluded.outOfWindow}건`);
    record("Case D. last_seen NULL → 후보 아님", !ids.has(caseD), `null 보유 품목 ${sim.excluded.nullLastSeen}건`);
    record("Case E. 수동 주문 → 후보 아님", !ids.has(caseE), `수동 제외 ${sim.excluded.manual}건`);
    record("Case F. 이미 취소 → 후보 아님", !ids.has(caseF), `취소 제외 ${sim.excluded.alreadyCancelled}건`);
    record("Case G. 이번 파일에 있던 행(날짜필터 제외 포함) → 후보 아님", !ids.has(createdOrderIds[1]));
    record("Case H. 건너뛴 이전 import 건도 범위 안이면 후보", ids.has(caseH));

    const shipping = sim.candidates.filter((c) => c.deliveryStatus === "배송중");
    const done = sim.candidates.filter((c) => c.deliveryStatus === "완료");
    record("배송중이 후보에 잡히지만 별도 분류된다", shipping.some((c) => c.orderId === caseShipping), `${shipping.length}건`);
    record("배송완료도 별도 분류로 드러난다", done.some((c) => c.orderId === caseDone), `${done.length}건`);
    record("배송건 없는 주문도 식별된다", sim.candidates.some((c) => c.orderId === caseNoShip && !c.hasShipment));

    // ── 상태별 집계표 ──────────────────────────────────────────────
    console.log("\n  ── 후보 분류 ──");
    const by = (f: (c: Candidate) => boolean) => sim.candidates.filter(f).length;
    console.log(`   전체 후보      ${sim.candidates.length}`);
    console.log(`   배송대기       ${by((c) => c.deliveryStatus === "배송대기")}`);
    console.log(`   배송중         ${by((c) => c.deliveryStatus === "배송중")}   ← 자동 처리 대상 아님(정책 미확정)`);
    console.log(`   배송완료       ${by((c) => c.deliveryStatus === "완료")}   ← 자동 취소 제외 검토`);
    console.log(`   기사 배정 있음 ${by((c) => c.hasDriver)}`);
    console.log(`   배송그룹 있음  ${by((c) => c.hasGroup)}`);
    console.log(`   배송건 없음    ${by((c) => !c.hasShipment)}`);
    console.log(`   수동주문       0 (알고리즘에서 제외 — ${sim.excluded.manual}건 걸러짐)`);
    console.log(`   이미 취소      0 (알고리즘에서 제외 — ${sim.excluded.alreadyCancelled}건 걸러짐)`);
    console.log("\n  ── 후보 주문 ID ──");
    for (const c of sim.candidates) console.log(`   ${c.orderId} | ${c.deliveryStatus} | 주문일 ${c.orderDate.slice(0, 10)} | 배송건 ${c.hasShipment} 기사 ${c.hasDriver} 그룹 ${c.hasGroup}`);

    // ── 쓰기 0건 검증 ──────────────────────────────────────────────
    record("★ 시뮬레이션이 취소 건수를 바꾸지 않았다", before.cancelled === after.cancelled, `${before.cancelled} → ${after.cancelled}`);
    record("★ 주문/배송건 수가 변하지 않았다", before.orders === after.orders && before.ships === after.ships, `주문 ${before.orders}→${after.orders} / 배송건 ${before.ships}→${after.ships}`);

    // ── user2 실데이터 시뮬레이션(읽기 전용) ────────────────────────
    const { data: t2 } = await admin.from("tenants").select("id").eq("slug", "user2").maybeSingle();
    const { data: latest2 } = await admin
      .from("imports")
      .select("id, file_name, created_at")
      .eq("owner_username", "user2")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (t2 && latest2) {
      const real = await simulate(t2.id as string, latest2.id as string);
      console.log(`\n  ── user2 실데이터 시뮬레이션(읽기 전용) ──`);
      console.log(`   기준 import: ${latest2.file_name} (${String(latest2.created_at).slice(0, 19)})`);
      console.log(`   이번 import로 도장 찍힌 주문: ${real.seenInCurrent}건`);
      console.log(`   비교 풀: ${real.poolConsidered}건 / last_seen이 null인 품목: ${real.excluded.nullLastSeen}건`);
      console.log(`   ★ 취소 후보: ${real.candidates.length}건`);
      record("user2 실데이터에서는 아직 후보가 0건이다(도장이 없어 판정 불가)", real.candidates.length === 0, `${real.candidates.length}건`);
    }
  } finally {
    for (const id of createdOrderIds) {
      await admin.from("order_items").delete().eq("order_id", id);
      await admin.from("order_shipments").delete().eq("order_id", id);
      await admin.from("orders").delete().eq("id", id);
    }
    if (createdCustomerIds.length > 0) await admin.from("customers").delete().in("id", createdCustomerIds);
    for (const id of createdImportIds) await admin.from("imports").delete().eq("id", id);
    const { data: left } = await admin
      .from("orders")
      .select("id")
      .eq("owner_username", OWNER)
      .like("recipient_name", `QA-STEP22-2-${RUN_TAG}-%`);
    console.log(`\n[cleanup] 잔여 주문 ${(left ?? []).length}건`);
  }

  console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
