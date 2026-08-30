/**
 * STEP11-9-DELIVERY-GROUP-REDESIGN(CPO 작업지시, 2026-08-30) — 배송 그룹
 * 기준 재설계 조사. 읽기 전용, 코드/DB/production 데이터 변경 없음.
 *
 * STEP11-8과 동일한 user1 실데이터(8일)를 재사용해 비교 가능하게 만들고,
 * 모델 A(반경 100/200/300/500m) / B(동일 단지 우선, 거리 무관) /
 * C(단지 우선 + 나머지 거리기반 하이브리드) / D(C + 읍면동 경계 유지 옵션)를
 * 순수 함수 시뮬레이션만으로 비교한다 — 어떤 모델도 DB에 쓰지 않는다.
 *
 * 건물명 추출/정규화는 새 규칙을 만들지 않고 기존
 * src/lib/utils/delivery-group.ts의 extractComplexName()과, 그 파일 내부
 * 비공개 함수인 buildingNormalizationKey()와 동일한 정규화(공백 제거 +
 * "아파트"/"apt" 접미사 제거 + 소문자)를 그대로 재사용한다(그 함수는
 * export되어 있지 않아 동일 로직을 이 조사 스크립트에만 복제했다 — 원본
 * 파일은 전혀 수정하지 않았다).
 *
 * 실행: npx tsx --env-file=.env.local scripts/step11-9-delivery-group-redesign-investigation.ts
 */
import { getSupabaseAdmin } from "../src/lib/supabase/admin";
import { haversineDistanceMeters, clusterPointsByDistance } from "../src/lib/services/spatial-grouping.service";
import { extractComplexName } from "../src/lib/utils/delivery-group";
import * as fs from "node:fs";
import * as path from "node:path";

const admin = getSupabaseAdmin();

// delivery-group.ts의 buildingNormalizationKey()와 완전히 동일한 로직의 복제본(원본 미수정).
function buildingNormalizationKey(name: string): string {
  return name.replace(/\s+/g, "").replace(/아파트|apt/gi, "").toLowerCase();
}

interface Point {
  id: string;
  lat: number;
  lng: number;
  sigungu: string | null;
  eupmyeondong: string | null;
  buildingRaw: string | null;
  buildingKey: string | null;
}

interface GroupResult {
  memberIds: string[];
  label: string;
}

function maxInternalDistance(members: Point[]): number {
  let max = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const d = haversineDistanceMeters(members[i], members[j]);
      if (d > max) max = d;
    }
  }
  return Math.round(max);
}

function majorityDong(members: Point[]): string | null {
  const counts = new Map<string, number>();
  for (const m of members) {
    if (!m.eupmyeondong) continue;
    counts.set(m.eupmyeondong, (counts.get(m.eupmyeondong) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}

/** 모델 A: 순수 반경 클러스터링(현재 production 알고리즘과 동일한 함수). */
function modelA(points: Point[], radiusM: number): GroupResult[] {
  const byId = new Map(points.map((p) => [p.id, p]));
  const clusters = clusterPointsByDistance(points, radiusM).filter((c) => c.length >= 2);
  return clusters.map((ids) => {
    const members = ids.map((id) => byId.get(id)!);
    const dong = majorityDong(members);
    return { memberIds: ids, label: dong ? `${dong} 인근 · ${ids.length}건` : `${ids.length}건` };
  });
}

/** 모델 B: 동일 단지(정규화 키 일치)만 후보로 본다 — 거리 무관, 건물명 없으면 그룹 없음. */
function modelB(points: Point[]): { groups: GroupResult[]; leftover: Point[] } {
  const byKey = new Map<string, Point[]>();
  const leftover: Point[] = [];
  for (const p of points) {
    if (!p.buildingKey) {
      leftover.push(p);
      continue;
    }
    const list = byKey.get(p.buildingKey) ?? [];
    list.push(p);
    byKey.set(p.buildingKey, list);
  }
  const groups: GroupResult[] = [];
  for (const [, members] of byKey) {
    if (members.length < 2) {
      leftover.push(...members);
      continue;
    }
    groups.push({ memberIds: members.map((m) => m.id), label: `${members[0].buildingRaw} · ${members.length}건` });
  }
  return { groups, leftover };
}

/** 모델 C: B로 단지 그룹을 먼저 만들고, 나머지(단지 미상)만 반경 클러스터링. restrictToSameDong이면 나머지 클러스터링을 같은 읍면동 내부로 제한. */
function modelC(points: Point[], radiusM: number, restrictToSameDong: boolean): GroupResult[] {
  const { groups: buildingGroups, leftover } = modelB(points);
  let radiusGroups: GroupResult[];
  if (!restrictToSameDong) {
    radiusGroups = modelA(leftover, radiusM);
  } else {
    const byDong = new Map<string, Point[]>();
    for (const p of leftover) {
      const key = p.eupmyeondong ?? "동미상";
      const list = byDong.get(key) ?? [];
      list.push(p);
      byDong.set(key, list);
    }
    radiusGroups = [];
    for (const [, members] of byDong) radiusGroups.push(...modelA(members, radiusM));
  }
  return [...buildingGroups, ...radiusGroups];
}

interface ModelMetrics {
  model: string;
  groupCount: number;
  coveragePct: number;
  avgGroupSize: number;
  maxGroupSize: number;
  mixedDongGroups: number;
  mixedBuildingGroups: number;
  maxInternalDistanceOverallM: number;
  sameComplexSplitCount: number; // 같은 단지가 2개 이상 그룹/미분류로 쪼개진 단지 수
}

function evaluate(model: string, groups: GroupResult[], allPoints: Point[]): ModelMetrics {
  const byId = new Map(allPoints.map((p) => [p.id, p]));
  const totalCovered = new Set(groups.flatMap((g) => g.memberIds)).size;
  let mixedDong = 0;
  let mixedBuilding = 0;
  let maxDistOverall = 0;
  for (const g of groups) {
    const members = g.memberIds.map((id) => byId.get(id)!);
    const dongSet = new Set(members.map((m) => m.eupmyeondong).filter(Boolean));
    if (dongSet.size > 1) mixedDong++;
    const buildingKeySet = new Set(members.map((m) => m.buildingKey).filter(Boolean));
    if (buildingKeySet.size > 1) mixedBuilding++;
    const d = maxInternalDistance(members);
    if (d > maxDistOverall) maxDistOverall = d;
  }
  // 동일 단지 분리: buildingKey별로 그룹 소속(또는 미분류) 개수를 센다.
  const groupIndexByPointId = new Map<string, number>();
  groups.forEach((g, idx) => g.memberIds.forEach((id) => groupIndexByPointId.set(id, idx)));
  const bucketsByBuildingKey = new Map<string, Set<number | "ungrouped">>();
  for (const p of allPoints) {
    if (!p.buildingKey) continue;
    const bucket = bucketsByBuildingKey.get(p.buildingKey) ?? new Set();
    bucket.add(groupIndexByPointId.get(p.id) ?? "ungrouped");
    bucketsByBuildingKey.set(p.buildingKey, bucket);
  }
  let sameComplexSplit = 0;
  for (const [, buckets] of bucketsByBuildingKey) {
    if (buckets.size > 1) sameComplexSplit++;
  }

  return {
    model,
    groupCount: groups.length,
    coveragePct: allPoints.length === 0 ? 0 : Math.round((totalCovered / allPoints.length) * 1000) / 10,
    avgGroupSize: groups.length === 0 ? 0 : Math.round((totalCovered / groups.length) * 10) / 10,
    maxGroupSize: groups.reduce((m, g) => Math.max(m, g.memberIds.length), 0),
    mixedDongGroups: mixedDong,
    mixedBuildingGroups: mixedBuilding,
    maxInternalDistanceOverallM: maxDistOverall,
    sameComplexSplitCount: sameComplexSplit,
  };
}

async function main() {
  const { data: groupCounts } = await admin.from("delivery_groups").select("owner_username");
  const byOwner = new Map<string, number>();
  for (const r of groupCounts ?? []) byOwner.set(r.owner_username, (byOwner.get(r.owner_username) ?? 0) + 1);
  const targetOwner = [...byOwner.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!targetOwner) throw new Error("no delivery_groups data found");

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: existingGroups } = await admin
    .from("delivery_groups")
    .select("delivery_date")
    .eq("owner_username", targetOwner)
    .gte("delivery_date", since);
  const dates = [...new Set((existingGroups ?? []).map((g) => g.delivery_date as string))].sort().reverse();
  console.log(`조사 대상: ${targetOwner}, ${dates.length}개 배송일\n`);

  const allMetricsByModel = new Map<string, ModelMetrics[]>();
  const caseExamples: Record<string, unknown>[] = [];

  for (const dateStr of dates) {
    const { data: shipRows } = await admin
      .from("order_shipments")
      .select("id, order_id, delivery_date, owner_username, delivery_status")
      .eq("owner_username", targetOwner)
      .eq("delivery_date", dateStr)
      .neq("delivery_status", "취소");
    if (!shipRows || shipRows.length === 0) continue;
    const orderIds = [...new Set(shipRows.map((s) => s.order_id))];
    const { data: orderRows } = await admin
      .from("orders")
      .select("id, latitude, longitude, sigungu, eupmyeondong, address_snapshot, geocode_status")
      .in("id", orderIds);
    const orderById = new Map((orderRows ?? []).map((o) => [o.id, o]));

    const points: Point[] = shipRows
      .map((s) => {
        const o = orderById.get(s.order_id);
        if (!o || o.geocode_status !== "success" || o.latitude === null || o.longitude === null) return null;
        const buildingRaw = extractComplexName(o.address_snapshot);
        return {
          id: s.id,
          lat: o.latitude as number,
          lng: o.longitude as number,
          sigungu: o.sigungu,
          eupmyeondong: o.eupmyeondong,
          buildingRaw,
          buildingKey: buildingRaw ? buildingNormalizationKey(buildingRaw) : null,
        };
      })
      .filter((p): p is Point => p !== null);
    if (points.length === 0) continue;

    const variants: [string, GroupResult[]][] = [
      ["현재(A-100)", modelA(points, 100)],
      ["A-200", modelA(points, 200)],
      ["A-300", modelA(points, 300)],
      ["A-500", modelA(points, 500)],
      ["B(단지전용)", modelB(points).groups],
      ["C-100(단지+반경100)", modelC(points, 100, false)],
      ["C-200(단지+반경200)", modelC(points, 200, false)],
      ["C-300(단지+반경300)", modelC(points, 300, false)],
      ["D-100(단지+반경100,동경계유지)", modelC(points, 100, true)],
      ["D-300(단지+반경300,동경계유지)", modelC(points, 300, true)],
    ];

    console.log(`\n--- ${dateStr} (좌표확보 ${points.length}건) ---`);
    for (const [name, groups] of variants) {
      const m = evaluate(name, groups, points);
      const list = allMetricsByModel.get(name) ?? [];
      list.push(m);
      allMetricsByModel.set(name, list);
      console.log(
        `  ${name}: 그룹${m.groupCount}개, 커버리지${m.coveragePct}%, 평균${m.avgGroupSize}건, 최대${m.maxGroupSize}건, 동혼합${m.mixedDongGroups}, 건물혼합${m.mixedBuildingGroups}, 단지분리${m.sameComplexSplitCount}, 최대내부거리${m.maxInternalDistanceOverallM}m`
      );
    }

    // 사례 채집: 현재(A-100) vs B/C-100/C-300에서 같은 건물명이 어떻게 갈리는지 기록.
    const byId = new Map(points.map((p) => [p.id, p]));
    const a100 = modelA(points, 100);
    const groupIdxA100 = new Map<string, number>();
    a100.forEach((g, idx) => g.memberIds.forEach((id) => groupIdxA100.set(id, idx)));
    const buildingCounts = new Map<string, Point[]>();
    for (const p of points) {
      if (!p.buildingKey) continue;
      const list = buildingCounts.get(p.buildingKey) ?? [];
      list.push(p);
      buildingCounts.set(p.buildingKey, list);
    }
    for (const [, members] of buildingCounts) {
      if (members.length < 3) continue; // 사례로 의미있는 것만(3건 이상)
      const groupsInA100 = new Set(members.map((m) => groupIdxA100.get(m.id) ?? "ungrouped"));
      if (groupsInA100.size > 1) {
        caseExamples.push({
          type: "good_improvement_candidate",
          date: dateStr,
          building: members[0].buildingRaw,
          totalOrders: members.length,
          currentA100SplitInto: groupsInA100.size,
          modelB_C_wouldMergeInto: 1,
        });
      }
    }
    // 잘못된 혼합 사례: A-300에서 서로 다른 단지가 섞인 그룹.
    const a300 = modelA(points, 300);
    for (const g of a300) {
      const members = g.memberIds.map((id) => byId.get(id)!);
      const namedBuildings = [...new Set(members.map((m) => m.buildingKey).filter(Boolean))];
      if (namedBuildings.length >= 2) {
        const maxDist = maxInternalDistance(members);
        caseExamples.push({
          type: "bad_mixing_at_300m",
          date: dateStr,
          buildings: [...new Set(members.map((m) => m.buildingRaw).filter(Boolean))],
          orderCount: members.length,
          maxInternalDistanceM: maxDist,
        });
      }
    }
  }

  console.log("\n\n=== 전체 기간 합산 비교표 ===");
  console.log("모델 | 총그룹수 | 평균커버리지% | 평균그룹크기 | 최대그룹 | 동혼합건수 | 건물혼합건수 | 단지분리건수");
  const summaryRows: Record<string, unknown>[] = [];
  for (const [name, list] of allMetricsByModel) {
    const totalGroups = list.reduce((s, m) => s + m.groupCount, 0);
    const avgCoverage = Math.round((list.reduce((s, m) => s + m.coveragePct, 0) / list.length) * 10) / 10;
    const avgSize = Math.round((list.reduce((s, m) => s + m.avgGroupSize, 0) / list.length) * 10) / 10;
    const maxSize = Math.max(...list.map((m) => m.maxGroupSize));
    const mixedDong = list.reduce((s, m) => s + m.mixedDongGroups, 0);
    const mixedBuilding = list.reduce((s, m) => s + m.mixedBuildingGroups, 0);
    const splitCount = list.reduce((s, m) => s + m.sameComplexSplitCount, 0);
    console.log(`${name} | ${totalGroups} | ${avgCoverage} | ${avgSize} | ${maxSize} | ${mixedDong} | ${mixedBuilding} | ${splitCount}`);
    summaryRows.push({ model: name, totalGroups, avgCoveragePct: avgCoverage, avgGroupSize: avgSize, maxGroupSize: maxSize, mixedDongGroups: mixedDong, mixedBuildingGroups: mixedBuilding, sameComplexSplitCount: splitCount });
  }

  const outDir = path.join(__dirname, "..", "docs", "investigation", "STEP11-9-DELIVERY-GROUP-REDESIGN");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "raw-data.json"),
    JSON.stringify({ targetOwner, generatedAt: new Date().toISOString(), summaryRows, caseExamples }, null, 2)
  );
  console.log(`\n사례 채집: ${caseExamples.length}건 (good_improvement_candidate + bad_mixing_at_300m)`);
  console.log(`Evidence written: docs/investigation/STEP11-9-DELIVERY-GROUP-REDESIGN/raw-data.json`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  console.error(e?.stack);
  process.exitCode = 1;
});
