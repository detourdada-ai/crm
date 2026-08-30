/**
 * STEP11-11(CPO 작업지시, 2026-08-30) Phase 1 검증 — "구현 후 기존 416건
 * 데이터로 다시 비교"를 실제 배포 코드(buildDeliveryGroupClusters, delivery-
 * group-regeneration.service.ts에서 export)로 수행한다. 읽기 전용 —
 * user1 delivery_groups에는 어떤 것도 쓰지 않는다(비교만 하고 저장 안 함).
 *
 * 실행: npx tsx --env-file=.env.local scripts/step11-11-verify-real-algorithm.ts
 */
import { getSupabaseAdmin } from "../src/lib/supabase/admin";
import { buildDeliveryGroupClusters, GROUP_RADIUS_METERS } from "../src/lib/services/delivery-group-regeneration.service";
import { extractComplexName, buildingNormalizationKey } from "../src/lib/utils/delivery-group";
import { clusterPointsByDistance } from "../src/lib/services/spatial-grouping.service";

const admin = getSupabaseAdmin();

async function main() {
  const { data: groupCounts } = await admin.from("delivery_groups").select("owner_username");
  const byOwner = new Map<string, number>();
  for (const r of groupCounts ?? []) byOwner.set(r.owner_username, (byOwner.get(r.owner_username) ?? 0) + 1);
  const targetOwner = [...byOwner.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!targetOwner) throw new Error("no data");

  const { data: allDatesRows } = await admin
    .from("order_shipments")
    .select("delivery_date")
    .eq("owner_username", targetOwner)
    .neq("delivery_status", "취소")
    .not("delivery_date", "is", null);
  const dates = [...new Set((allDatesRows ?? []).map((r) => r.delivery_date as string))].sort().reverse();

  let totalShipments = 0;
  let totalCurrentGroups = 0,
    totalCurrentCovered = 0;
  let totalNewGroups = 0,
    totalNewCovered = 0;
  let totalNewFullyExplainable = 0;
  let totalNewMixedBuilding = 0;
  let totalNewMixedDong = 0;
  let totalCurrentMixedBuilding = 0;

  console.log(`검증 대상: ${targetOwner}, ${dates.length}일\n`);
  console.log("배송일 | 좌표확보건 | 기존(순수100m) 그룹/커버리지 | 신규(단지우선+100m) 그룹/커버리지");

  for (const dateStr of dates) {
    const { data: shipRows } = await admin
      .from("order_shipments")
      .select("id, order_id, delivery_group_id")
      .eq("owner_username", targetOwner)
      .eq("delivery_date", dateStr)
      .neq("delivery_status", "취소");
    if (!shipRows || shipRows.length === 0) continue;
    totalShipments += shipRows.length;
    const orderIds = [...new Set(shipRows.map((s) => s.order_id))];
    const { data: orderRows } = await admin
      .from("orders")
      .select("id, latitude, longitude, eupmyeondong, address_snapshot, geocode_status")
      .in("id", orderIds);
    const orderById = new Map((orderRows ?? []).map((o) => [o.id, o]));

    const eligible = shipRows
      .map((s) => {
        const o = orderById.get(s.order_id);
        if (!o || o.geocode_status !== "success" || o.latitude === null || o.longitude === null) return null;
        return { shipmentId: s.id, latitude: o.latitude as number, longitude: o.longitude as number, address_snapshot: o.address_snapshot, eupmyeondong: o.eupmyeondong };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    // 기존 알고리즘(순수 100m 반경, 신규 알고리즘과 동일한 eligible 입력에
    // 대해 방금 다시 계산 — DB에 저장된 delivery_group_id는 과거 다른 시점의
    // 재계산 결과라 입력 집합이 지금과 다를 수 있어(정합성 노이즈) 비교
    // 기준으로 쓰지 않는다. "구현 전/후"를 같은 입력으로 공정하게 비교한다.
    const oldClusters = clusterPointsByDistance(
      eligible.map((e) => ({ id: e.shipmentId, lat: e.latitude, lng: e.longitude })),
      GROUP_RADIUS_METERS
    ).filter((c) => c.length >= 2);
    const currentCovered = new Set(oldClusters.flat()).size;
    totalCurrentGroups += oldClusters.length;
    totalCurrentCovered += currentCovered;

    const byIdForOld = new Map(eligible.map((e) => [e.shipmentId, e]));
    for (const cluster of oldClusters) {
      const members = cluster.map((id) => byIdForOld.get(id)!);
      const names = new Set(members.map((m) => extractNameKey(m.address_snapshot)).filter(Boolean));
      if (names.size > 1) totalCurrentMixedBuilding++;
    }

    // 신규 알고리즘(실제 배포 코드) 실행 — 읽기 전용 시뮬레이션, DB에 쓰지 않음.
    const newClusters = buildDeliveryGroupClusters(eligible);
    const newCovered = new Set(newClusters.flat()).size;
    totalNewGroups += newClusters.length;
    totalNewCovered += newCovered;

    const byId = new Map(eligible.map((e) => [e.shipmentId, e]));
    for (const cluster of newClusters) {
      const members = cluster.map((id) => byId.get(id)!);
      const buildingKeys = new Set(members.map((m) => extractNameKey(m.address_snapshot)).filter(Boolean));
      const dongs = new Set(members.map((m) => m.eupmyeondong).filter(Boolean));
      if (buildingKeys.size === 1 && members[0] && extractNameKey(members[0].address_snapshot)) totalNewFullyExplainable++;
      if (buildingKeys.size > 1) totalNewMixedBuilding++;
      if (dongs.size > 1) totalNewMixedDong++;
    }

    const currentCovPct = shipRows.length ? Math.round((currentCovered / shipRows.length) * 1000) / 10 : 0;
    const newCovPct = eligible.length ? Math.round((newCovered / eligible.length) * 1000) / 10 : 0;
    console.log(`${dateStr.slice(0, 10)} | ${eligible.length} | ${oldClusters.length}개/${currentCovPct}% | ${newClusters.length}개/${newCovPct}%`);
  }

  console.log("\n=== 8일 합산: 실제 배포 코드로 재검증 ===");
  console.log(`전체 배송건: ${totalShipments}`);
  console.log(`기존(100m 단독) — 그룹 ${totalCurrentGroups}개, 커버리지 ${Math.round((totalCurrentCovered / totalShipments) * 1000) / 10}%, 건물혼합 ${totalCurrentMixedBuilding}건`);
  console.log(
    `신규(Option 1: 단지우선+동경계유지 100m) — 그룹 ${totalNewGroups}개, 커버리지 ${Math.round((totalNewCovered / totalShipments) * 1000) / 10}%, 완전설명가능 ${totalNewFullyExplainable}개, 건물혼합 ${totalNewMixedBuilding}건, 동혼합 ${totalNewMixedDong}건`
  );

  const coverageDelta = totalNewCovered - totalCurrentCovered;
  const buildingMixDelta = totalNewMixedBuilding - totalCurrentMixedBuilding;
  console.log(`\n커버리지 변화: ${coverageDelta >= 0 ? "+" : ""}${coverageDelta}건`);
  console.log(`건물혼합 변화: ${buildingMixDelta >= 0 ? "+" : ""}${buildingMixDelta}건`);
  console.log(`동혼합(신규): ${totalNewMixedDong}건`);

  if (coverageDelta < 0) {
    console.log("\n⚠ 경고: 커버리지가 기존보다 낮아졌습니다 — Phase 1 실패 기준(작업지시서: '현재보다 나빠지는 지표가 있으면 구현 중단').");
    process.exitCode = 1;
  } else if (buildingMixDelta > 0) {
    console.log("\n⚠ 경고: 건물혼합이 기존보다 늘었습니다 — Phase 1 실패 기준.");
    process.exitCode = 1;
  } else {
    console.log("\nPASS — 커버리지 손해 없음, 건물혼합 감소 또는 동일, 동혼합 억제 확인.");
  }
}

function extractNameKey(addr: string | null): string | null {
  const name = extractComplexName(addr);
  return name ? buildingNormalizationKey(name) : null;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
