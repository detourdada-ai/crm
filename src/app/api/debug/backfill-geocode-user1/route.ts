import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { geocodeBatch } from "@/lib/services/geocoding.service";

/**
 * TEMPORARY — CPO 승인 backfill(P12). user1(실사용 계정)의 geocode_status
 * ='pending' 주문에 소급 geocoding을 실행한다. P10-1.5(fc5aa4e, 2026-08-19
 * 12:39 배포) 이전에 들어온 주문이라 신규 import 경로 수정의 혜택을 못 받은
 * 건들이다. admin 세션 필수. owner_username="user1" 로 하드코딩해 대상 범위를
 * 고정한다(요청 파라미터로 확장 불가). 갱신 컬럼은 geocoding 관련 필드만 —
 * 다른 주문 데이터는 절대 건드리지 않는다. 실행 전 상태는 이미 로컬에
 * 스냅샷으로 별도 백업되어 있다(scratch-snapshots/). 실행 완료 즉시 이
 * 라우트를 제거한다.
 */
const TARGET_OWNER = "user1";

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data: targets, error: fetchErr } = await supabase
    .from("orders")
    .select("id, address_snapshot")
    .eq("owner_username", TARGET_OWNER)
    .eq("geocode_status", "pending");
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!targets || targets.length === 0) {
    return NextResponse.json({ total: 0, message: "no pending orders" });
  }

  const addressQueries = new Map<string, string>();
  for (const o of targets) {
    if (o.address_snapshot && !addressQueries.has(o.address_snapshot)) {
      addressQueries.set(o.address_snapshot, o.address_snapshot);
    }
  }

  const geoResults = await geocodeBatch(addressQueries);

  let success = 0;
  let failed = 0;
  let skippedNoAddress = 0;
  const failures: { id: string }[] = [];

  for (const o of targets) {
    if (!o.address_snapshot) {
      skippedNoAddress += 1;
      continue;
    }
    const geo = geoResults.get(o.address_snapshot);
    if (!geo) continue;

    const { error: updateErr } = await supabase
      .from("orders")
      .update({
        latitude: geo.latitude,
        longitude: geo.longitude,
        sido: geo.sido,
        sigungu: geo.sigungu,
        eupmyeondong: geo.eupmyeondong,
        sido_code: geo.sido_code,
        sigungu_code: geo.sigungu_code,
        eupmyeondong_code: geo.eupmyeondong_code,
        geocode_status: geo.geocode_status,
        geocoded_at: new Date().toISOString(),
      })
      .eq("id", o.id);

    if (updateErr) {
      failed += 1;
      failures.push({ id: o.id });
      continue;
    }
    if (geo.geocode_status === "success") success += 1;
    else {
      failed += 1;
      failures.push({ id: o.id });
    }
  }

  const { count: remainingPending } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("owner_username", TARGET_OWNER)
    .eq("geocode_status", "pending");

  return NextResponse.json({
    total: targets.length,
    uniqueAddresses: addressQueries.size,
    success,
    failed,
    skippedNoAddress,
    remainingPending,
    failureIds: failures.slice(0, 10).map((f) => f.id),
  });
}
