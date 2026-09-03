/**
 * STEP11-10-A(CPO 작업지시, 2026-08-30) — 배송그룹 알고리즘 재설계 조사 확장판.
 * 읽기 전용, 코드/DB 변경 없음. STEP11-9와 동일한 모델(A/B/C/D)을 재사용하되
 * 새 지표(과대그룹비율/소형그룹비율/설명가능성)와 건물명 정규화 감사를 추가한다.
 *
 * 데이터 범위: user1 실사용 데이터는 현재 정확히 8일/416건(비취소 배송건)
 * 뿐이다(사전 확인 완료) — "범위를 넓혀 조사"라는 지시에 대해, 이미 존재하는
 * 실데이터 전체(8일)를 그대로 다 쓰는 것이 최대치이며 더 넓힐 실데이터가
 * 없다는 점을 이 스크립트의 출력과 최종 보고서에 명시한다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/step11-10a-delivery-group-metrics-and-naming.ts
 */
import { getSupabaseAdmin } from "../src/lib/supabase/admin";
import { clusterPointsByDistance } from "../src/lib/services/spatial-grouping.service";
import { extractComplexName } from "../src/lib/utils/delivery-group";
import * as fs from "node:fs";
import * as path from "node:path";

const admin = getSupabaseAdmin();

// delivery-group.ts의 비공개 buildingNormalizationKey()와 동일 로직 복제(원본 미수정).
function currentNormKey(name: string): string {
  return name.replace(/\s+/g, "").replace(/아파트|apt/gi, "").toLowerCase();
}

interface Point {
  id: string;
  lat: number;
  lng: number;
  eupmyeondong: string | null;
  buildingRaw: string | null;
  buildingKey: string | null;
}
interface GroupResult {
  memberIds: string[];
  label: string;
}

function majorityDong(members: Point[]): string | null {
  const counts = new Map<string, number>();
  for (const m of members) if (m.eupmyeondong) counts.set(m.eupmyeondong, (counts.get(m.eupmyeondong) ?? 0) + 1);
  let best: string | null = null, bestCount = 0;
  for (const [k, c] of counts) if (c > bestCount) { best = k; bestCount = c; }
  return best;
}
function modelA(points: Point[], radiusM: number): GroupResult[] {
  const byId = new Map(points.map((p) => [p.id, p]));
  return clusterPointsByDistance(points, radiusM)
    .filter((c) => c.length >= 2)
    .map((ids) => {
      const members = ids.map((id) => byId.get(id)!);
      const dong = majorityDong(members);
      return { memberIds: ids, label: dong ? `${dong} 인근 · ${ids.length}건` : `${ids.length}건` };
    });
}
function modelB(points: Point[]): { groups: GroupResult[]; leftover: Point[] } {
  const byKey = new Map<string, Point[]>();
  const leftover: Point[] = [];
  for (const p of points) {
    if (!p.buildingKey) { leftover.push(p); continue; }
    const list = byKey.get(p.buildingKey) ?? [];
    list.push(p);
    byKey.set(p.buildingKey, list);
  }
  const groups: GroupResult[] = [];
  for (const [, members] of byKey) {
    if (members.length < 2) { leftover.push(...members); continue; }
    groups.push({ memberIds: members.map((m) => m.id), label: `${members[0].buildingRaw} · ${members.length}건` });
  }
  return { groups, leftover };
}
function modelC(points: Point[], radiusM: number, restrictToSameDong: boolean): GroupResult[] {
  const { groups: buildingGroups, leftover } = modelB(points);
  let radiusGroups: GroupResult[];
  if (!restrictToSameDong) radiusGroups = modelA(leftover, radiusM);
  else {
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

interface ExtMetrics {
  model: string;
  groupCount: number;
  coveragePct: number;
  oversizedGroups: number; // >=10건
  smallGroups: number; // <=2건, "추천 가치 낮음"
  fullyExplainableGroups: number; // 구성원 전원이 같은 buildingKey(단일 단지로 100% 설명 가능)
  mixedBuildingGroups: number;
  mixedDongGroups: number;
}
function evaluateExt(model: string, groups: GroupResult[], allPoints: Point[]): ExtMetrics {
  const byId = new Map(allPoints.map((p) => [p.id, p]));
  const covered = new Set(groups.flatMap((g) => g.memberIds)).size;
  let oversized = 0, small = 0, fullyExplainable = 0, mixedBuilding = 0, mixedDong = 0;
  for (const g of groups) {
    const members = g.memberIds.map((id) => byId.get(id)!);
    if (members.length >= 10) oversized++;
    if (members.length <= 2) small++;
    const buildingKeys = new Set(members.map((m) => m.buildingKey));
    if (buildingKeys.size === 1 && members[0].buildingKey !== null) fullyExplainable++;
    if (new Set(members.map((m) => m.buildingKey).filter(Boolean)).size > 1) mixedBuilding++;
    if (new Set(members.map((m) => m.eupmyeondong).filter(Boolean)).size > 1) mixedDong++;
  }
  return {
    model,
    groupCount: groups.length,
    coveragePct: allPoints.length === 0 ? 0 : Math.round((covered / allPoints.length) * 1000) / 10,
    oversizedGroups: oversized,
    smallGroups: small,
    fullyExplainableGroups: fullyExplainable,
    mixedBuildingGroups: mixedBuilding,
    mixedDongGroups: mixedDong,
  };
}

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
  console.log(`=== 데이터 범위 확인 ===`);
  console.log(`${targetOwner}의 실사용 배송일은 전체 기간 통틀어 정확히 ${dates.length}개뿐이다(더 넓힐 실데이터 없음): ${dates.join(", ")}\n`);

  const allMetrics = new Map<string, ExtMetrics[]>();
  const rawBuildingNamesByKey = new Map<string, Set<string>>();
  const allDistinctKeys = new Set<string>();

  for (const dateStr of dates) {
    const { data: shipRows } = await admin
      .from("order_shipments")
      .select("id, order_id")
      .eq("owner_username", targetOwner)
      .eq("delivery_date", dateStr)
      .neq("delivery_status", "취소");
    if (!shipRows || shipRows.length === 0) continue;
    const orderIds = [...new Set(shipRows.map((s) => s.order_id))];
    const { data: orderRows } = await admin
      .from("orders")
      .select("id, latitude, longitude, eupmyeondong, address_snapshot, geocode_status")
      .in("id", orderIds);
    const orderById = new Map((orderRows ?? []).map((o) => [o.id, o]));
    const totalShipments = shipRows.length;

    const points: Point[] = shipRows
      .map((s) => {
        const o = orderById.get(s.order_id);
        if (!o || o.geocode_status !== "success" || o.latitude === null || o.longitude === null) return null;
        const buildingRaw = extractComplexName(o.address_snapshot);
        const buildingKey = buildingRaw ? currentNormKey(buildingRaw) : null;
        if (buildingRaw && buildingKey) {
          const set = rawBuildingNamesByKey.get(buildingKey) ?? new Set<string>();
          set.add(buildingRaw);
          rawBuildingNamesByKey.set(buildingKey, set);
          allDistinctKeys.add(buildingKey);
        }
        return { id: s.id, lat: o.latitude as number, lng: o.longitude as number, eupmyeondong: o.eupmyeondong, buildingRaw, buildingKey };
      })
      .filter((p): p is Point => p !== null);
    const geocodeFailedCount = totalShipments - points.length;
    if (points.length === 0) continue;

    const variants: [string, GroupResult[]][] = [
      ["현재(A-100)", modelA(points, 100)],
      ["A-200", modelA(points, 200)],
      ["A-300", modelA(points, 300)],
      ["B(단지전용)", modelB(points).groups],
      ["C-100", modelC(points, 100, false)],
      ["C-300", modelC(points, 300, false)],
      ["D-100(동경계유지)", modelC(points, 100, true)],
      ["D-300(동경계유지)", modelC(points, 300, true)],
    ];
    console.log(`--- ${dateStr}: 전체배송건 ${totalShipments}, 지오코딩실패 ${geocodeFailedCount}, 좌표확보 ${points.length} ---`);
    for (const [name, groups] of variants) {
      const m = evaluateExt(name, groups, points);
      const list = allMetrics.get(name) ?? [];
      list.push(m);
      allMetrics.set(name, list);
    }
  }

  console.log("\n=== 전체 기간 합산 (신규 지표 포함) ===");
  console.log("모델 | 총그룹 | 평균커버리지% | 과대그룹(>=10) | 소형그룹(<=2) | 완전설명가능그룹 | 건물혼합 | 동혼합");
  const summaryRows: Record<string, unknown>[] = [];
  for (const [name, list] of allMetrics) {
    const totalGroups = list.reduce((s, m) => s + m.groupCount, 0);
    const avgCoverage = Math.round((list.reduce((s, m) => s + m.coveragePct, 0) / list.length) * 10) / 10;
    const oversized = list.reduce((s, m) => s + m.oversizedGroups, 0);
    const small = list.reduce((s, m) => s + m.smallGroups, 0);
    const explainable = list.reduce((s, m) => s + m.fullyExplainableGroups, 0);
    const mixedB = list.reduce((s, m) => s + m.mixedBuildingGroups, 0);
    const mixedD = list.reduce((s, m) => s + m.mixedDongGroups, 0);
    const explainablePct = totalGroups === 0 ? 0 : Math.round((explainable / totalGroups) * 1000) / 10;
    console.log(`${name} | ${totalGroups} | ${avgCoverage}% | ${oversized} | ${small} | ${explainable}(${explainablePct}%) | ${mixedB} | ${mixedD}`);
    summaryRows.push({ model: name, totalGroups, avgCoveragePct: avgCoverage, oversizedGroups: oversized, smallGroups: small, fullyExplainableGroups: explainable, fullyExplainablePct: explainablePct, mixedBuildingGroups: mixedB, mixedDongGroups: mixedD });
  }

  console.log("\n=== 건물명 정규화 감사 ===");
  console.log(`전체 distinct 정규화 키: ${allDistinctKeys.size}개`);
  const multiVariantKeys = [...rawBuildingNamesByKey.entries()].filter(([, set]) => set.size > 1);
  console.log(`현재 정규화 규칙이 실제로 통합한 표기 차이 사례(같은 키, 다른 원문): ${multiVariantKeys.length}건`);
  for (const [key, variants] of multiVariantKeys) console.log(`  [${key}] ← ${[...variants].join(" / ")}`);

  // 컨테인먼트 기반 잠재적 미통합 후보(정규화 후에도 서로 다른 키인데, 한쪽이 다른 쪽 부분 문자열)
  const keys = [...allDistinctKeys];
  const containmentCandidates: { a: string; b: string }[] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i], b = keys[j];
      if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) {
        containmentCandidates.push({ a: [...rawBuildingNamesByKey.get(a)!][0], b: [...rawBuildingNamesByKey.get(b)!][0] });
      }
    }
  }
  console.log(`\n정규화로 안 묶였지만 부분문자열 포함관계라 사람이 봐야 할 후보(자동 병합 아님, 참고용): ${containmentCandidates.length}건`);
  for (const c of containmentCandidates.slice(0, 15)) console.log(`  "${c.a}" ⊂/⊃ "${c.b}"`);

  const outDir = path.join(__dirname, "..", "docs", "investigation", "STEP11-10-DELIVERY-GROUP-REDEFINITION");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "step11-10a-raw-data.json"),
    JSON.stringify({ targetOwner, totalRealDeliveryDates: dates.length, dates, generatedAt: new Date().toISOString(), summaryRows, normalizationAudit: { totalDistinctKeys: allDistinctKeys.size, multiVariantKeys: multiVariantKeys.map(([k, s]) => ({ key: k, variants: [...s] })), containmentCandidates } }, null, 2)
  );
  console.log(`\nEvidence written: docs/investigation/STEP11-10-DELIVERY-GROUP-REDEFINITION/step11-10a-raw-data.json`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  console.error(e?.stack);
  process.exitCode = 1;
});
