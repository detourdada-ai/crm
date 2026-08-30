/**
 * STEP11-8(CPO 작업지시, 2026-08-30) Phase 1/2 — 배송 그룹 실사용성 조사.
 * 읽기 전용(AGENTS.md 4단계 프로토콜 대상 아님 — 어떤 row도 쓰지 않는다).
 *
 * 목적: "현재 100m 좌표 클러스터링이 실제 배송 동선 관점에서 의미 있는
 * 묶음인가?"를 실제 사장님(가장 활성 데이터를 가진 tenant) 데이터로 확인하고,
 * 동(행정구역) 기준 묶음과 실측 비교한다. 코드/DB를 전혀 수정하지 않는다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/step11-8-delivery-group-investigation.ts
 */
import { getSupabaseAdmin } from "../src/lib/supabase/admin";
import { haversineDistanceMeters, computeCentroid } from "../src/lib/services/spatial-grouping.service";
import { buildGroupBuildingCounts } from "../src/lib/utils/delivery-group";
import * as fs from "node:fs";
import * as path from "node:path";

const admin = getSupabaseAdmin();

interface ShipmentPoint {
  id: string;
  order_id: string;
  delivery_group_id: string | null;
  latitude: number;
  longitude: number;
  sigungu: string | null;
  eupmyeondong: string | null;
  address_snapshot: string | null;
  delivery_date: string;
  owner_username: string;
}

async function main() {
  // 0) 가장 활성화된(실제 사용 중인) tenant를 찾는다 — 하드코딩하지 않고 실측으로 결정.
  const { data: groupCounts, error: gcErr } = await admin
    .from("delivery_groups")
    .select("owner_username")
    .order("owner_username");
  if (gcErr) throw gcErr;
  const byOwner = new Map<string, number>();
  for (const r of groupCounts ?? []) byOwner.set(r.owner_username, (byOwner.get(r.owner_username) ?? 0) + 1);
  const ranked = [...byOwner.entries()].sort((a, b) => b[1] - a[1]);
  console.log("=== tenant별 delivery_groups 총 행 수(누적, 과거 재계산 포함) ===");
  for (const [owner, count] of ranked) console.log(`  ${owner}: ${count}`);

  const targetOwner = ranked[0]?.[0];
  if (!targetOwner) {
    console.log("delivery_groups 데이터가 전혀 없습니다 — 조사 대상 없음.");
    return;
  }
  console.log(`\n조사 대상 tenant: ${targetOwner} (가장 활성)\n`);

  // 1) 최근 30일 내에서 이 tenant가 실제로 그룹을 가진 배송일 목록.
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: groups, error: gErr } = await admin
    .from("delivery_groups")
    .select("*")
    .eq("owner_username", targetOwner)
    .gte("delivery_date", since)
    .order("delivery_date", { ascending: false });
  if (gErr) throw gErr;
  if (!groups || groups.length === 0) {
    console.log("최근 30일 내 그룹 데이터 없음 — 전체 기간으로 재조회합니다.");
  }
  const dates = [...new Set((groups ?? []).map((g) => g.delivery_date as string))].sort().reverse();
  console.log(`분석 대상 배송일: ${dates.length}개 (${dates.slice(0, 10).join(", ")}${dates.length > 10 ? " ..." : ""})\n`);

  const report: Record<string, unknown>[] = [];

  for (const dateStr of dates) {
    const dayGroups = (groups ?? []).filter((g) => g.delivery_date === dateStr);
    // 좌표/행정구역/주소는 order_shipments가 아니라 orders 테이블 컬럼이다
    // (order-shipments.repository.ts의 fetchBoardRowsForShipments와 동일한
    // join 패턴) — 배송건을 먼저 조회한 뒤 대응하는 orders를 별도로 조회해 합친다.
    const { data: shipRows, error: shErr } = await admin
      .from("order_shipments")
      .select("id, order_id, delivery_group_id, delivery_date, owner_username, delivery_status")
      .eq("owner_username", targetOwner)
      .eq("delivery_date", dateStr)
      .neq("delivery_status", "취소");
    if (shErr) throw shErr;
    if (!shipRows || shipRows.length === 0) continue;

    const orderIds = [...new Set(shipRows.map((s) => s.order_id))];
    const { data: orderRows, error: oErr } = await admin
      .from("orders")
      .select("id, latitude, longitude, sigungu, eupmyeondong, address_snapshot, geocode_status")
      .in("id", orderIds);
    if (oErr) throw oErr;
    const orderById = new Map((orderRows ?? []).map((o) => [o.id, o]));

    const shipments: ShipmentPoint[] = shipRows
      .map((s) => {
        const o = orderById.get(s.order_id);
        if (!o || o.geocode_status !== "success" || o.latitude === null || o.longitude === null) return null;
        return {
          id: s.id,
          order_id: s.order_id,
          delivery_group_id: s.delivery_group_id,
          latitude: o.latitude as number,
          longitude: o.longitude as number,
          sigungu: o.sigungu,
          eupmyeondong: o.eupmyeondong,
          address_snapshot: o.address_snapshot,
          delivery_date: s.delivery_date,
          owner_username: s.owner_username,
        };
      })
      .filter((s): s is ShipmentPoint => s !== null);
    if (shipments.length === 0) continue;

    const groupedIds = new Set(shipments.filter((s) => s.delivery_group_id).map((s) => s.id));
    const ungroupedCount = shipments.length - groupedIds.size;

    // ---- Phase 1: 그룹별 상세 ----
    const dayReport: Record<string, unknown>[] = [];
    for (const g of dayGroups) {
      const members = shipments.filter((s) => s.delivery_group_id === g.id);
      if (members.length === 0) continue;
      const sigunguSet = new Set(members.map((m) => m.sigungu).filter(Boolean));
      const dongSet = new Set(members.map((m) => m.eupmyeondong).filter(Boolean));
      const buildingCounts = buildGroupBuildingCounts(members.map((m) => m.address_snapshot)).filter((c) => c.name !== "기타");

      let maxInternalDistanceM = 0;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const d = haversineDistanceMeters(
            { lat: members[i].latitude, lng: members[i].longitude },
            { lat: members[j].latitude, lng: members[j].longitude }
          );
          if (d > maxInternalDistanceM) maxInternalDistanceM = d;
        }
      }

      let minInterGroupDistanceM: number | null = null;
      for (const other of dayGroups) {
        if (other.id === g.id) continue;
        const d = haversineDistanceMeters(
          { lat: g.center_latitude, lng: g.center_longitude },
          { lat: other.center_latitude, lng: other.center_longitude }
        );
        if (minInterGroupDistanceM === null || d < minInterGroupDistanceM) minInterGroupDistanceM = d;
      }

      dayReport.push({
        groupId: g.id,
        groupNo: g.group_no,
        orderCount: members.length,
        distinctSigungu: [...sigunguSet],
        distinctDong: [...dongSet],
        crossesMultipleDong: dongSet.size > 1,
        representativeBuildings: buildingCounts.slice(0, 3),
        maxInternalDistanceM: Math.round(maxInternalDistanceM),
        minInterGroupDistanceM: minInterGroupDistanceM === null ? null : Math.round(minInterGroupDistanceM),
      });
    }

    // ---- Phase 2: 동 기준 vs 좌표그룹 기준 비교 ----
    const dongCounts = new Map<string, number>();
    for (const s of shipments) {
      const key = s.eupmyeondong ?? "동 미상";
      dongCounts.set(key, (dongCounts.get(key) ?? 0) + 1);
    }
    // 같은 동이 몇 개의 서로 다른 좌표그룹(또는 미분류)으로 쪼개졌는지.
    const groupsByDong = new Map<string, Set<string>>();
    for (const s of shipments) {
      const dong = s.eupmyeondong ?? "동 미상";
      const bucket = groupsByDong.get(dong) ?? new Set<string>();
      bucket.add(s.delivery_group_id ?? "미분류");
      groupsByDong.set(dong, bucket);
    }
    const dongSplitAcrossGroups = [...groupsByDong.entries()]
      .filter(([, gset]) => gset.size > 1)
      .map(([dong, gset]) => ({ dong, splitIntoGroupsCount: gset.size }));
    const groupsCrossingMultipleDong = dayReport.filter((r) => (r as { crossesMultipleDong: boolean }).crossesMultipleDong);

    report.push({
      deliveryDate: dateStr,
      totalEligibleShipments: shipments.length,
      totalGroups: dayReport.length,
      groupedShipments: groupedIds.size,
      ungroupedShipments: ungroupedCount,
      dongBasedCounts: Object.fromEntries(dongCounts),
      dongSplitAcrossMultipleGroups: dongSplitAcrossGroups,
      groupsCrossingMultipleDong: groupsCrossingMultipleDong.map((r) => ({
        groupId: (r as { groupId: string }).groupId,
        distinctDong: (r as { distinctDong: string[] }).distinctDong,
        orderCount: (r as { orderCount: number }).orderCount,
      })),
      groups: dayReport,
    });

    console.log(`\n--- ${dateStr} ---`);
    console.log(`  전체 좌표확보 배송건: ${shipments.length}, 그룹 수: ${dayReport.length}, 그룹화됨: ${groupedIds.size}, 미분류: ${ungroupedCount}`);
    console.log(`  동 기준 분포: ${[...dongCounts.entries()].map(([d, c]) => `${d} ${c}건`).join(", ")}`);
    if (dongSplitAcrossGroups.length > 0) {
      console.log(`  ⚠ 같은 동이 여러 좌표그룹으로 쪼개진 사례: ${dongSplitAcrossGroups.map((d) => `${d.dong}(${d.splitIntoGroupsCount}개 그룹)`).join(", ")}`);
    }
    if (groupsCrossingMultipleDong.length > 0) {
      console.log(
        `  ⚠ 하나의 좌표그룹이 여러 동을 걸친 사례: ${groupsCrossingMultipleDong.map((r) => `그룹#${(r as { groupNo: number }).groupNo ?? "?"}(${(r as { distinctDong: string[] }).distinctDong.join("+")}, ${(r as { orderCount: number }).orderCount}건)`).join(", ")}`
      );
    }
    for (const g of dayReport) {
      const gr = g as { groupNo: number; orderCount: number; maxInternalDistanceM: number; minInterGroupDistanceM: number | null; representativeBuildings: { name: string; count: number }[] };
      console.log(
        `    그룹#${gr.groupNo}: ${gr.orderCount}건, 내부최대거리 ${gr.maxInternalDistanceM}m, 최근접그룹 ${gr.minInterGroupDistanceM}m, 대표건물 ${gr.representativeBuildings.map((b) => `${b.name}(${b.count})`).join(", ") || "없음"}`
      );
    }
  }

  const outDir = path.join(__dirname, "..", "docs", "investigation", "STEP11-8-DELIVERY-GROUP");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "raw-data.json"),
    JSON.stringify({ targetOwner, generatedAt: new Date().toISOString(), report }, null, 2)
  );
  console.log(`\n\nEvidence written: docs/investigation/STEP11-8-DELIVERY-GROUP/raw-data.json`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  console.error(e?.stack);
  process.exitCode = 1;
});
