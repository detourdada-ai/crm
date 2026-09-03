/**
 * STEP12-17(CPO 작업지시, 2026-09-03) WORKSTREAM A/D — 주문·배송·고객 데이터 정합성 감사.
 *
 * **읽기 전용이다.** INSERT/UPDATE/DELETE를 하지 않는다(AGENTS.md의 Production DB
 * 안전 규칙 대상이 아님). 이상을 "발견"만 하고, 고치는 것은 사람이 판단한다.
 *
 * `user1`/`user2`는 CPO 지시로 조회조차 하지 않는다. 기본 대상은 실제 업무 데이터가
 * 있는 `user3`/`user4`/`user5`이며, 인자로 tenant를 직접 지정할 수 있다.
 *
 * 실행:
 *   NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *     scripts/qa/data-integrity-audit.ts dotenv_config_path=.env.local [tenant ...]
 */
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { FORBIDDEN_QA_OWNERS } from "./lib/qa-config";

const DEFAULT_TENANTS = ["user3", "user4", "user5"];
/** 조회 자체가 금지된 tenant — 인자로 넘어와도 거부한다. */
const NEVER_READ = ["user1", "user2"];

const admin = getSupabaseAdmin();

interface Finding {
  tenant: string;
  check: string;
  count: number;
  severity: "RED" | "YELLOW" | "GREEN";
  detail: string;
}

const findings: Finding[] = [];

function report(tenant: string, check: string, count: number, severity: Finding["severity"], detail = "") {
  findings.push({ tenant, check, count, severity: count === 0 ? "GREEN" : severity, detail });
}

function kstDay(iso: string | null): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function auditTenant(tenant: string) {
  const [{ data: orders }, { data: shipments }, { data: groups }, { data: customers }] = await Promise.all([
    admin.from("orders").select("id, customer_id, status, order_date").eq("owner_username", tenant),
    admin
      .from("order_shipments")
      .select("id, order_id, delivery_date, delivery_status, driver_id, delivery_group_id, route_order, completed_at")
      .eq("owner_username", tenant),
    admin.from("delivery_groups").select("id").eq("owner_username", tenant),
    admin.from("customers").select("id").eq("owner_username", tenant),
  ]);

  const orderIds = new Set((orders ?? []).map((o) => o.id));
  const customerIds = new Set((customers ?? []).map((c) => c.id));
  const groupIds = new Set((groups ?? []).map((g) => g.id));
  const ships = shipments ?? [];

  const orderIdList = [...orderIds];
  const items: { id: string; order_id: string }[] = [];
  for (let i = 0; i < orderIdList.length; i += 200) {
    const { data } = await admin.from("order_items").select("id, order_id").in("order_id", orderIdList.slice(i, i + 200));
    items.push(...(data ?? []));
  }

  // ---------- A-1. Order ↔ Shipment 관계 ----------
  report(tenant, "A-1 주문 없는 배송건(orphan shipment)", ships.filter((s) => !orderIds.has(s.order_id)).length, "RED");
  const shipOrderIds = new Set(ships.map((s) => s.order_id));
  report(
    tenant,
    "A-1 배송건이 하나도 없는 주문",
    [...orderIds].filter((id) => !shipOrderIds.has(id)).length,
    "YELLOW",
    "취소/직접수령 등 정상일 수 있어 YELLOW"
  );
  report(tenant, "A-1 주문 없는 상품주문(order_item)", items.filter((it) => !orderIds.has(it.order_id)).length, "RED");

  // ---------- A-2. 발송일 기준 분리 ----------
  const dateKey = new Map<string, number>();
  for (const s of ships) {
    const k = `${s.order_id}|${kstDay(s.delivery_date)}`;
    dateKey.set(k, (dateKey.get(k) ?? 0) + 1);
  }
  report(
    tenant,
    "A-2 동일 주문+동일 배송일 중복 배송건",
    [...dateKey.values()].filter((n) => n > 1).length,
    "RED",
    "설계상 발송일이 다르면 배송건이 나뉘므로, 같은 날짜 중복만 이상"
  );

  // ---------- A-3. 상태 정합성 ----------
  const active = ships.filter((s) => s.delivery_status !== "취소");
  report(tenant, "A-3 완료인데 완료시각(completed_at) 없음", active.filter((s) => s.delivery_status === "완료" && !s.completed_at).length, "YELLOW");
  report(tenant, "A-3 완료인데 배송일 없음", active.filter((s) => s.delivery_status === "완료" && !s.delivery_date).length, "YELLOW");
  report(tenant, "A-3 기사 미배정인데 route_order 있음", active.filter((s) => !s.driver_id && s.route_order !== null).length, "YELLOW");
  report(
    tenant,
    "A-3 기사 배정+배송일 있는데 route_order 없음",
    active.filter((s) => s.driver_id && s.delivery_date && s.route_order === null).length,
    "YELLOW",
    "배정 직후 정규화 전 상태일 수 있음"
  );
  report(
    tenant,
    "A-3 존재하지 않는 배송그룹 참조",
    active.filter((s) => s.delivery_group_id && !groupIds.has(s.delivery_group_id)).length,
    "RED"
  );

  // ---------- B. route_order 정합성(기사·배송일 단위) ----------
  const byDriverDay = new Map<string, number[]>();
  for (const s of active) {
    if (!s.driver_id || !s.delivery_date || s.route_order === null) continue;
    const k = `${s.driver_id}|${kstDay(s.delivery_date)}`;
    const list = byDriverDay.get(k) ?? [];
    list.push(s.route_order);
    byDriverDay.set(k, list);
  }
  let dupOrder = 0;
  let gapOrder = 0;
  for (const list of byDriverDay.values()) {
    if (new Set(list).size !== list.length) dupOrder += 1;
    const sorted = [...list].sort((a, b) => a - b);
    if (sorted.some((v, i) => v !== i + 1)) gapOrder += 1;
  }
  report(tenant, "B 같은 기사·같은 날짜에서 route_order 중복", dupOrder, "RED");
  report(tenant, "B route_order가 1..N 연속이 아님(구멍)", gapOrder, "YELLOW", "배송 취소/재배정 후 압축 전이면 정상일 수 있음");

  // ---------- D. 고객 참조 ----------
  report(tenant, "D 존재하지 않는 고객을 참조하는 주문", (orders ?? []).filter((o) => !customerIds.has(o.customer_id)).length, "RED");

  const { data: merges } = await admin.from("merge_history").select("removed_customer_id, unmerged_at");
  const removedIds = (merges ?? []).filter((m) => !m.unmerged_at).map((m) => m.removed_customer_id).filter((id) => customerIds.has(id));
  let mergedWithOrders = 0;
  for (let i = 0; i < removedIds.length; i += 200) {
    const chunk = removedIds.slice(i, i + 200);
    if (chunk.length === 0) continue;
    const { data } = await admin.from("orders").select("id").eq("owner_username", tenant).in("customer_id", chunk);
    mergedWithOrders += (data ?? []).length;
  }
  report(tenant, "D 병합으로 제거된 고객에 주문이 연결됨", mergedWithOrders, "RED");

  return { orders: orders?.length ?? 0, shipments: ships.length, items: items.length, customers: customerIds.size };
}

async function main() {
  const argTenants = process.argv.slice(2).filter((a) => !a.startsWith("dotenv_config"));
  const tenants = argTenants.length > 0 ? argTenants : DEFAULT_TENANTS;
  for (const t of tenants) {
    if (NEVER_READ.includes(t) || (FORBIDDEN_QA_OWNERS as readonly string[]).includes(t)) {
      if (NEVER_READ.includes(t)) throw new Error(`data-integrity-audit: "${t}"는 조회 금지 대상입니다(CPO 지시).`);
    }
  }

  for (const t of tenants) {
    const size = await auditTenant(t);
    console.log(`\n[${t}] orders=${size.orders} shipments=${size.shipments} order_items=${size.items} customers=${size.customers}`);
    for (const f of findings.filter((x) => x.tenant === t)) {
      const mark = f.severity === "GREEN" ? "OK  " : f.severity === "RED" ? "RED " : "YEL ";
      console.log(`  ${mark} ${f.check}: ${f.count}건${f.detail ? ` — ${f.detail}` : ""}`);
    }
  }

  const red = findings.filter((f) => f.severity === "RED");
  const yellow = findings.filter((f) => f.severity === "YELLOW");
  console.log(`\n=== 데이터 정합성 감사 결과: RED ${red.length}건 / YELLOW ${yellow.length}건 / 검사 ${findings.length}건 ===`);
  if (red.length > 0) {
    console.log("RED 항목:");
    for (const f of red) console.log(`  - [${f.tenant}] ${f.check}: ${f.count}건`);
  }
  if (yellow.length > 0) {
    console.log("YELLOW 항목:");
    for (const f of yellow) console.log(`  - [${f.tenant}] ${f.check}: ${f.count}건`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
