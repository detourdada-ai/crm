/**
 * STEP11-10-C(CPO 작업지시, 2026-08-30) — 기사 배정 작업 흐름 클릭/판단 횟수
 * 시뮬레이션. 읽기 전용, 코드/DB 변경 없음. 실제 UI를 만들지 않고, 이미
 * STEP11-9/10-A에서 검증된 모델(D-100: 단지우선+동경계유지 반경100m)의
 * "그룹 수 + 미분류 건수" 산수만으로 현재 방식(전건 개별 클릭) 대비
 * 클릭 수 절감을 추정한다.
 *
 * 가정(보수적으로 명시): 그룹 배정 1회 = 클릭 1번(기사 선택 후 그룹 전체
 * 일괄 적용), 미분류 건은 현재와 동일하게 개별 클릭 1번씩 필요.
 * 실제 UI/클릭 동선은 STEP11-10-B 설계 이후 재검증 필요 — 이건 상한선
 * 추정치(최선의 경우)다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/step11-10c-click-simulation.ts
 */
import { getSupabaseAdmin } from "../src/lib/supabase/admin";
import { clusterPointsByDistance } from "../src/lib/services/spatial-grouping.service";
import { extractComplexName } from "../src/lib/utils/delivery-group";
import * as fs from "node:fs";
import * as path from "node:path";

const admin = getSupabaseAdmin();
function currentNormKey(name: string): string {
  return name.replace(/\s+/g, "").replace(/아파트|apt/gi, "").toLowerCase();
}
interface Point { id: string; lat: number; lng: number; eupmyeondong: string | null; buildingKey: string | null }

function modelB(points: Point[]): { groupCount: number; grouped: number; leftover: Point[] } {
  const byKey = new Map<string, Point[]>();
  const leftover: Point[] = [];
  for (const p of points) {
    if (!p.buildingKey) { leftover.push(p); continue; }
    const list = byKey.get(p.buildingKey) ?? [];
    list.push(p);
    byKey.set(p.buildingKey, list);
  }
  let groupCount = 0, grouped = 0;
  for (const [, members] of byKey) {
    if (members.length < 2) { leftover.push(...members); continue; }
    groupCount++;
    grouped += members.length;
  }
  return { groupCount, grouped, leftover };
}
function modelD100(points: Point[]): { groupCount: number; grouped: number; ungrouped: number } {
  const { groupCount: bGroups, grouped: bGrouped, leftover } = modelB(points);
  const byDong = new Map<string, Point[]>();
  for (const p of leftover) {
    const key = p.eupmyeondong ?? "동미상";
    const list = byDong.get(key) ?? [];
    list.push(p);
    byDong.set(key, list);
  }
  let radiusGroups = 0, radiusGrouped = 0;
  for (const [, members] of byDong) {
    const clusters = clusterPointsByDistance(members, 100).filter((c) => c.length >= 2);
    radiusGroups += clusters.length;
    radiusGrouped += clusters.reduce((s, c) => s + c.length, 0);
  }
  const totalGrouped = bGrouped + radiusGrouped;
  return { groupCount: bGroups + radiusGroups, grouped: totalGrouped, ungrouped: points.length - totalGrouped };
}

async function main() {
  const { data: groupCounts } = await admin.from("delivery_groups").select("owner_username");
  const byOwner = new Map<string, number>();
  for (const r of groupCounts ?? []) byOwner.set(r.owner_username, (byOwner.get(r.owner_username) ?? 0) + 1);
  const targetOwner = [...byOwner.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const { data: allDatesRows } = await admin.from("order_shipments").select("delivery_date").eq("owner_username", targetOwner).neq("delivery_status", "취소").not("delivery_date", "is", null);
  const dates = [...new Set((allDatesRows ?? []).map((r) => r.delivery_date as string))].sort().reverse();

  console.log("배송일 | 전체건수 | 현재방식 클릭(=건수) | 그룹지원 클릭(그룹수+미분류) | 절감률");
  const rows: Record<string, unknown>[] = [];
  let totalOrders = 0, totalCurrentClicks = 0, totalGroupClicks = 0;

  for (const dateStr of dates) {
    const { data: shipRows } = await admin.from("order_shipments").select("id, order_id").eq("owner_username", targetOwner).eq("delivery_date", dateStr).neq("delivery_status", "취소");
    if (!shipRows || shipRows.length === 0) continue;
    const orderIds = [...new Set(shipRows.map((s) => s.order_id))];
    const { data: orderRows } = await admin.from("orders").select("id, latitude, longitude, eupmyeondong, address_snapshot, geocode_status").in("id", orderIds);
    const orderById = new Map((orderRows ?? []).map((o) => [o.id, o]));
    const points: Point[] = shipRows
      .map((s) => {
        const o = orderById.get(s.order_id);
        if (!o || o.geocode_status !== "success" || o.latitude === null || o.longitude === null) return null;
        const buildingRaw = extractComplexName(o.address_snapshot);
        return { id: s.id, lat: o.latitude as number, lng: o.longitude as number, eupmyeondong: o.eupmyeondong, buildingKey: buildingRaw ? currentNormKey(buildingRaw) : null };
      })
      .filter((p): p is Point => p !== null);
    const totalDayOrders = shipRows.length; // 지오코딩 실패건도 현재방식에서는 어차피 개별 클릭 필요
    const geocodeFailed = totalDayOrders - points.length;

    const d100 = modelD100(points);
    const currentClicks = totalDayOrders; // 현재: 전건 개별 클릭
    const groupClicks = d100.groupCount + d100.ungrouped + geocodeFailed;
    const reductionPct = Math.round((1 - groupClicks / currentClicks) * 1000) / 10;

    console.log(`${dateStr.slice(0, 10)} | ${totalDayOrders} | ${currentClicks} | ${groupClicks}(그룹${d100.groupCount}+미분류${d100.ungrouped}+지오실패${geocodeFailed}) | ${reductionPct}%`);
    rows.push({ date: dateStr.slice(0, 10), totalOrders: totalDayOrders, currentClicks, groupClicks, groupCount: d100.groupCount, ungrouped: d100.ungrouped, geocodeFailed, reductionPct });
    totalOrders += totalDayOrders;
    totalCurrentClicks += currentClicks;
    totalGroupClicks += groupClicks;
  }

  const overallReduction = Math.round((1 - totalGroupClicks / totalCurrentClicks) * 1000) / 10;
  console.log(`\n=== 8일 합산 ===`);
  console.log(`전체 주문: ${totalOrders}건, 현재방식 클릭: ${totalCurrentClicks}, 그룹지원 클릭: ${totalGroupClicks}, 절감률: ${overallReduction}%`);

  const outDir = path.join(__dirname, "..", "docs", "investigation", "STEP11-10-DELIVERY-GROUP-REDEFINITION");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "step11-10c-click-simulation.json"),
    JSON.stringify({ targetOwner, rows, totalOrders, totalCurrentClicks, totalGroupClicks, overallReductionPct: overallReduction, assumption: "그룹 배정 1회=클릭 1번, 미분류/지오코딩실패건은 개별 클릭 1번(보수적 상한선 추정)" }, null, 2)
  );
  console.log(`Evidence written: docs/investigation/STEP11-10-DELIVERY-GROUP-REDEFINITION/step11-10c-click-simulation.json`);
}
main().catch((e) => { console.error("FATAL:", e); process.exitCode = 1; });
