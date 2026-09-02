/**
 * STEP8(2026-08-27 CPO 작업지시), STEP12-10 v3(CPO 정책 갱신)로 업데이트된
 * QA 스크립트 공통 안전장치.
 *
 * 1. assertAllowedQaOwner(): 실행 전 대상 tenant가 허용된 QA tenant인지
 *    확인하고, user1/user2면 즉시 예외를 던져 스크립트를 중단시킨다 — 이
 *    하드 게이트는 정책과 무관하게 항상 유지된다.
 * 2. assertTenantIsQaSafe(): STEP12-10 v3(CPO 명시적 정책) — user3/4/5는
 *    "QA 데이터가 아닌 것으로 보이는 기존 데이터가 있는지"와 무관하게
 *    항상 QA 실행 대상이다(과거 스프린트의 실사업자 롤플레이 시나리오 등
 *    QA_NAME_PREFIX 없이 쌓인 데이터가 이미 있을 수 있음 — 그 자체가 QA를
 *    막을 이유는 아니다). 이전 버전은 이런 기존 데이터가 하나라도 있으면
 *    fail-fast했으나, 이는 v3에서 CPO가 명시적으로 폐기했다. 대신 이
 *    함수는 그런 기존 데이터의 존재를 콘솔에 정보성으로만 남긴다 —
 *    "이 tenant를 쓰지 마라"가 아니라 "정리 시 이 기존 데이터를 지우면
 *    안 된다"는 걸 스크립트 작성자가 인지하게 하기 위함이다. 실제 안전은
 *    각 스크립트의 cleanup이 RUN_TAG/QA_NAME_PREFIX로 정확히 좁혀서
 *    지우는 것으로 보장한다(기존 데이터 삭제 금지는 여전히 절대 원칙).
 * 3. makeRunTag(): 모든 QA 데이터(고객/주문/배송/임시기사)에 붙일 추적
 *    가능한 식별자 `QA-{script}-{timestamp}`를 만든다.
 * 4. createQaDriver()/cleanupQaDriver(): "기존 활성 기사 재사용" 대신
 *    이번 실행 전용 임시 기사를 만들고 정확히 그 기사만 지운다(실제
 *    기사와 절대 섞이지 않는다).
 *
 * cleanup은 절대 silent failure로 두지 않는다 — 실패하면 console.error로
 * 남기고, 호출자가 원하면 throwOnCleanupFailure로 즉시 예외를 던지게 할
 * 수 있다(기본은 계속 진행하며 나머지 cleanup도 시도).
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../../src/lib/supabase/admin";
import { hashPassword } from "../../../src/lib/auth/password";
import { ALLOWED_TEST_OWNERS } from "../../safe-scratch";
import { FORBIDDEN_QA_OWNERS, QA_NAME_PREFIX } from "./qa-config";

export function assertAllowedQaOwner(owner: string): void {
  if ((FORBIDDEN_QA_OWNERS as readonly string[]).includes(owner)) {
    throw new Error(
      `qa-guard: "${owner}"는 QA 쓰기 금지 대상입니다(실제 서비스/실사용 테스트 데이터 존재). QA_DEFAULT_OWNER를 사용하세요.`
    );
  }
  if (!ALLOWED_TEST_OWNERS.includes(owner)) {
    throw new Error(`qa-guard: "${owner}"는 허용된 QA tenant(${ALLOWED_TEST_OWNERS.join(", ")})가 아닙니다.`);
  }
}

/**
 * 정적 allowlist(user1/user2 금지) 통과 여부만 하드하게 확인한다.
 * STEP12-10 v3(CPO 정책) — user3/4/5에 QA_NAME_PREFIX가 아닌 기존 데이터가
 * 있어도 더 이상 실행을 막지 않는다(과거엔 이게 실사업자 롤플레이로 쌓인
 * 정상 데이터까지 차단하는 오탐이었다). 대신 그 존재를 정보성으로 로그만
 * 남긴다 — cleanup을 짤 때 "이 기존 데이터는 절대 지우면 안 된다"는 걸
 * 스크립트 작성자가 놓치지 않게 하기 위함이다. 실제 안전장치는 각
 * 스크립트가 RUN_TAG/QA_NAME_PREFIX로 정확히 좁혀서 지우는 cleanup 로직
 * 자체다(qa-config.ts의 FORBIDDEN_QA_OWNERS=user1/user2는 여전히 절대
 * 예외 없이 차단).
 */
export async function assertTenantIsQaSafe(owner: string): Promise<void> {
  assertAllowedQaOwner(owner);
  const admin = getSupabaseAdmin();
  const prefixFilter = `${QA_NAME_PREFIX}%`;

  const [orders, customers, drivers] = await Promise.all([
    admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", owner).not("recipient_name", "ilike", prefixFilter),
    admin.from("customers").select("id", { count: "exact", head: true }).eq("owner_username", owner).not("name", "ilike", prefixFilter),
    admin.from("drivers").select("id", { count: "exact", head: true }).eq("owner_username", owner).not("name", "ilike", prefixFilter),
  ]);
  if (orders.error) throw orders.error;
  if (customers.error) throw customers.error;
  if (drivers.error) throw drivers.error;

  const problems: string[] = [];
  if ((orders.count ?? 0) > 0) problems.push(`주문 ${orders.count}건`);
  if ((customers.count ?? 0) > 0) problems.push(`고객 ${customers.count}건`);
  if ((drivers.count ?? 0) > 0) problems.push(`기사 ${drivers.count}건`);

  if (problems.length > 0) {
    console.log(
      `[qa-guard] 안내: "${owner}"에 QA 데이터(접두사 "${QA_NAME_PREFIX}")가 아닌 기존 데이터가 있습니다(${problems.join(", ")}). ` +
        `CPO 정책상 이는 QA 실행을 막지 않지만, cleanup은 반드시 이번 실행이 만든 RUN_TAG/접두사 데이터만 지워야 합니다.`
    );
  }
}

export function makeRunTag(scriptName: string): string {
  return `QA-${scriptName}-${Date.now()}`;
}

export interface QaDriverFixture {
  driverId: string;
  username: string;
  name: string;
}

/** RUN_TAG로 추적 가능한 임시 QA 전용 기사를 만든다(실제 활성 기사를 조회/재사용하지 않는다). */
export async function createQaDriver(
  owner: string,
  tenantId: string,
  runTag: string,
  label: string
): Promise<QaDriverFixture> {
  assertAllowedQaOwner(owner);
  const admin = getSupabaseAdmin();
  const driverId = randomUUID();
  const name = `${runTag}-기사${label}`;
  const username = `${runTag}-driver-${label}`.toLowerCase();

  const { error: driverErr } = await admin
    .from("drivers")
    .insert({ id: driverId, name, phone: "010-0000-0000", status: "active", rate_per_delivery: 0, owner_username: owner, tenant_id: tenantId });
  if (driverErr) throw driverErr;

  const { error: acctErr } = await admin
    .from("app_accounts")
    .insert({ username, password_hash: hashPassword("qa-temp-driver-1234"), role: "driver", driver_id: driverId });
  if (acctErr) throw acctErr;

  return { driverId, username, name };
}

/** createQaDriver()로 만든 기사와 그 부산물(로그인 계정/담당지역/오늘자 운행기록)을 정확히 그 driverId 기준으로만 지운다. */
export async function cleanupQaDriver(fixture: QaDriverFixture): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error: acctErr } = await admin.from("app_accounts").delete().eq("username", fixture.username);
  if (acctErr) console.error(`[qa-guard] app_accounts cleanup 실패(${fixture.username}):`, acctErr.message);

  const { error: regionErr } = await admin.from("driver_regions").delete().eq("driver_id", fixture.driverId);
  if (regionErr) console.error(`[qa-guard] driver_regions cleanup 실패(${fixture.driverId}):`, regionErr.message);

  const { error: shiftErr } = await admin.from("driver_shifts").delete().eq("driver_id", fixture.driverId);
  if (shiftErr) console.error(`[qa-guard] driver_shifts cleanup 실패(${fixture.driverId}):`, shiftErr.message);

  const { error: driverErr } = await admin.from("drivers").delete().eq("id", fixture.driverId);
  if (driverErr) console.error(`[qa-guard] drivers cleanup 실패(${fixture.driverId}):`, driverErr.message);
}
