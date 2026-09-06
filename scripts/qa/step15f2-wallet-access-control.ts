/**
 * STEP15-F2 보안 검증(CPO 지적, 2026-09-05) — 지갑 데이터 접근 경로 점검.
 *
 * "RLS 켜고 정책 0개"라는 기존 관례를 **말로 믿지 않고 실제로 두드려 본다.**
 * Wallet은 고객 돈과 직결되므로, 공개된 anon 키로 밖에서 직접 읽거나 쓸 수 있으면
 * 서버 코드의 권한 검사와 무관하게 뚫린다.
 *
 * 검사 대상(실제 공격 경로):
 *   ① anon 키로 message_wallet / message_wallet_transactions 조회·삽입 시도
 *   ② anon 키로 message_log · app_settings(메시지 설정) · orders 조회 시도
 *   ③ anon 키로 지갑 RPC 직접 호출 시도
 * 0055 적용 전이면 ①③은 "테이블 없음"으로 건너뛰고 ②만 검증한다.
 *
 * 쓰기 시도는 전부 **차단되는 것이 정상**이며, 혹시 성공하면 즉시 되돌린다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step15f2-wallet-access-control.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner } from "./lib/qa-guard";

const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const results: { step: string; pass: boolean; detail?: string }[] = [];
function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail: pass ? undefined : detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${!pass && detail ? ` (${detail})` : ""}`);
}

async function run() {
  if (!SUPABASE_URL || !ANON_KEY) {
    console.log("⏸ anon 키가 없어 외부 접근 검증을 건너뜁니다.");
    return;
  }
  const admin = getSupabaseAdmin();
  // 브라우저에 노출되는 것과 동일한 공개 키 — 실제 공격자가 쓸 수 있는 경로다.
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

  const walletExists = !(await admin.from("message_wallet").select("id").limit(1)).error;

  // ---- ② 기존 테이블: 공개 키로 읽히면 안 된다 ----
  // STEP15-F3A: 결제 테이블도 같은 기준으로 확인한다(돈과 직결되는 데이터).
  for (const table of [
    "message_log",
    "app_settings",
    "orders",
    "customers",
    "payments",
    "payment_events",
    "message_charge_intents",
    // STEP15-F3D-2 — 단가 정책은 플랫폼 과금 규칙이다. 밖에서 읽히면 가격 구조가 노출되고,
    // 쓰기가 열려 있으면 남의 발송 단가를 바꿀 수 있다.
    "message_pricing_policies",
  ] as const) {
    const { data, error } = await anon.from(table).select("*").limit(1);
    const blocked = !!error || (data?.length ?? 0) === 0;
    record(`anon 키로 ${table} 조회 차단`, blocked, error ? error.message.slice(0, 60) : `rows=${data?.length}`);
  }

  // 쓰기도 막혀야 한다.
  const anonInsert = await anon.from("app_settings").insert({ key: `attack-${Date.now()}`, value: {} });
  record("anon 키로 app_settings 삽입 차단", !!anonInsert.error, anonInsert.error?.message?.slice(0, 60));
  if (!anonInsert.error) {
    // 혹시 뚫렸다면 즉시 정리한다.
    await admin.from("app_settings").delete().like("key", "attack-%");
  }

  // ---- ①③ 지갑 ----
  if (!walletExists) {
    console.log("⏸ migration 0055 미적용 — 지갑 테이블 접근 검증은 적용 후 실행합니다.");
  } else {
    for (const table of ["message_wallet", "message_wallet_transactions"] as const) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      record(`anon 키로 ${table} 조회 차단`, !!error || (data?.length ?? 0) === 0, error ? error.message.slice(0, 60) : `rows=${data?.length}`);
    }
    const anonTx = await anon.from("message_wallet_transactions").insert({
      wallet_id: "00000000-0000-0000-0000-000000000000",
      owner_username: OWNER,
      type: "charge",
      amount: 999999,
      available_after: 999999,
      reserved_after: 0,
    });
    record("anon 키로 원장 직접 삽입 차단", !!anonTx.error, anonTx.error?.message?.slice(0, 60));

    const anonRpc = await anon.rpc("message_wallet_apply_transaction", {
      p_owner_username: OWNER,
      p_type: "charge",
      p_amount: 999999,
    });
    record("anon 키로 지갑 RPC 직접 호출 차단", !!anonRpc.error, anonRpc.error?.message?.slice(0, 80));

    // STEP15-F3C: 지급 RPC도 같은 기준으로 본다 — 테이블만 막고 함수가 열려 있으면 뚫린다.
    const anonGrant = await anon.rpc("message_charge_intent_grant", {
      p_intent_id: "00000000-0000-0000-0000-000000000000",
      p_performed_by: "attacker",
    });
    record("anon 키로 지급 RPC 직접 호출 차단", !!anonGrant.error, anonGrant.error?.message?.slice(0, 80));

    // STEP15-F3D-2 — 테이블만 막고 쓰기 경로가 열려 있으면 의미가 없다. 네 가지를 다 찔러본다.
    const anonPolicyInsert = await anon.from("message_pricing_policies").insert({
      owner_username: null,
      kind: "transactional" as const,
      message_type: "alimtalk" as const,
      provider: "attack",
      unit_price: 1,
    });
    record("anon 키로 단가 정책 삽입 차단", !!anonPolicyInsert.error, anonPolicyInsert.error?.message?.slice(0, 60));

    // UPDATE/DELETE는 "에러가 났는가"로 볼 수 없다. RLS는 행을 안 보이게 하는 방식이라
    // 대상이 0건이면 **성공으로 응답한다**(처음엔 이걸 오탐으로 잡았다). 확인해야 하는 것은
    // 응답이 아니라 **실제로 값이 바뀌었는가**이므로, 표적을 하나 만들어 두고 대조한다.
    const targetId = randomUUID();
    await admin.from("message_pricing_policies").insert({
      id: targetId,
      owner_username: OWNER,
      kind: "transactional" as const,
      message_type: "alimtalk" as const,
      provider: "qa-access",
      unit_price: 111,
      status: "draft" as const,
      note: "QA-ACCESS-CONTROL",
    });
    try {
      await anon.from("message_pricing_policies").update({ unit_price: 999_999 }).eq("id", targetId);
      const { data: afterUpdate } = await admin.from("message_pricing_policies").select("unit_price").eq("id", targetId).maybeSingle();
      record("anon 키로 단가 정책 수정 불가(값 실제 불변)", afterUpdate?.unit_price === 111, `unit_price=${afterUpdate?.unit_price}`);

      await anon.from("message_pricing_policies").delete().eq("id", targetId);
      const { data: afterDelete } = await admin.from("message_pricing_policies").select("id").eq("id", targetId).maybeSingle();
      record("anon 키로 단가 정책 삭제 불가(행 실제 잔존)", !!afterDelete, afterDelete ? "" : "행이 사라졌다");
    } finally {
      await admin.from("message_pricing_policies").delete().eq("id", targetId);
    }

    // 서버(service_role)에서는 정상 동작해야 한다 — 잠긴 게 아니라 "밖에서만" 잠긴 것.
    const { error: adminReadError } = await admin.from("message_wallet").select("id").limit(1);
    record("service_role은 정상 조회 가능", !adminReadError, adminReadError?.message?.slice(0, 60));
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== STEP15-F2 지갑 접근 통제: ${results.length - failed.length}/${results.length} PASS =====`);
  for (const f of failed) console.log(`  FAIL — ${f.step}${f.detail ? ` (${f.detail})` : ""}`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
