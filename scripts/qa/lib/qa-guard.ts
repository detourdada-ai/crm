/**
 * STEP8(2026-08-27 CPO 작업지시) — QA 스크립트 공통 안전장치.
 *
 * 1. assertAllowedQaOwner(): 실행 전 대상 tenant가 허용된 QA tenant인지
 *    확인하고, user1/user2면 즉시 예외를 던져 스크립트를 중단시킨다.
 * 2. makeRunTag(): 모든 QA 데이터(고객/주문/배송/임시기사)에 붙일 추적
 *    가능한 식별자 `QA-{script}-{timestamp}`를 만든다.
 * 3. createQaDriver()/cleanupQaDriver(): "기존 활성 기사 재사용" 대신
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
import { FORBIDDEN_QA_OWNERS } from "./qa-config";

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
