/**
 * STEP15-F2(CPO 승인, 2026-09-05) — 메시지 지갑·원장 QA.
 *
 * 실제 결제·발송은 없다. 검증 대상은 **돈이 사라지거나 중복되지 않는가**다.
 *   charge / reserve / capture / release / adjust
 *   원장 합계 == 지갑 잔액
 *   같은 키의 연속·동시 호출에서 거래가 한 번만 생기는가(DB 레벨)
 *   append-only(과거 거래 UPDATE/DELETE 차단)
 *   음수 잔액 차단 · 잔액 초과 예약 차단
 *   테넌트 격리(user3 / user6)
 *
 * migration 0055가 아직 적용되지 않았으면 그 사실만 알리고 종료한다(실패로 세지 않음).
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step15f2-message-wallet.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { walletService, formatAmount } from "../../src/lib/services/messaging/wallet.service";

const OWNER = QA_DEFAULT_OWNER;
const OWNER_B = QA_SECONDARY_OWNER;
assertAllowedQaOwner(OWNER);
assertAllowedQaOwner(OWNER_B);
const admin = getSupabaseAdmin();
const RUN = randomUUID().slice(0, 8);

const results: { step: string; pass: boolean; detail?: string }[] = [];
function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail: pass ? undefined : detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${!pass && detail ? ` (${detail})` : ""}`);
}

async function ledgerSum(owner: string): Promise<{ available: number; reserved: number }> {
  const { data } = await admin
    .from("message_wallet_transactions")
    .select("type, amount")
    .eq("owner_username", owner);
  let available = 0;
  let reserved = 0;
  for (const tx of data ?? []) {
    if (tx.type === "charge" || tx.type === "adjust") available += tx.amount;
    else if (tx.type === "reserve") {
      available -= tx.amount;
      reserved += tx.amount;
    } else if (tx.type === "capture") reserved -= tx.amount;
    else if (tx.type === "release") {
      reserved -= tx.amount;
      available += tx.amount;
    }
  }
  return { available, reserved };
}

async function cleanup(owner: string) {
  const { data: wallet } = await admin.from("message_wallet").select("id").eq("owner_username", owner).maybeSingle();
  if (!wallet) return;
  // append-only 트리거는 UPDATE/DELETE를 막는다 — 테스트 데이터 정리는 지갑을 지워
  // 자식 거래가 cascade로 함께 사라지게 한다(원장 자체를 임의로 지우지 않는다).
  await admin.from("message_wallet").delete().eq("id", wallet.id);
}

async function run() {
  await assertTenantIsQaSafe(OWNER);
  await assertTenantIsQaSafe(OWNER_B);

  const probe = await admin.from("message_wallet").select("id").limit(1);
  if (probe.error) {
    console.log(`\n⏸ migration 0055 미적용 — 지갑 테이블이 없어 QA를 건너뜁니다. (${probe.error.message.slice(0, 60)})`);
    return;
  }

  // 실행 전 상태 확인 — QA tenant에 기존 지갑이 있으면 건드리지 않고 중단한다.
  for (const owner of [OWNER, OWNER_B]) {
    const { data } = await admin.from("message_wallet").select("id").eq("owner_username", owner).maybeSingle();
    if (data) {
      console.log(`\n⏸ ${owner}에 이미 지갑이 있습니다. 실데이터 보호를 위해 중단합니다.`);
      return;
    }
  }

  try {
    // ---- charge ----
    const c1 = await walletService.apply({ ownerUsername: OWNER, type: "charge", amount: 10_000, referenceType: "admin_adjustment", idempotencyKey: `${RUN}-c1` });
    record("charge — 잔액 증가", c1.ok && c1.availableBalance === 10_000, JSON.stringify(c1));
    record("지갑 자동 생성(테넌트당 1개)", (await walletService.getBalance(OWNER))?.availableBalance === 10_000);

    // 같은 키로 다시 → 중복 생성 없음
    const c1dup = await walletService.apply({ ownerUsername: OWNER, type: "charge", amount: 10_000, idempotencyKey: `${RUN}-c1` });
    record("charge 연속 중복 호출 — 거래 1건 유지", c1dup.ok === true && c1dup.duplicated === true, JSON.stringify(c1dup));
    record("중복 호출 후에도 잔액 그대로", (await walletService.getBalance(OWNER))?.availableBalance === 10_000);

    // ---- reserve ----
    const r1 = await walletService.apply({ ownerUsername: OWNER, type: "reserve", amount: 650, idempotencyKey: `${RUN}-msg1` });
    record("reserve — available 감소 / reserved 증가", r1.availableBalance === 9_350 && r1.reservedBalance === 650, JSON.stringify(r1));

    const r1dup = await walletService.apply({ ownerUsername: OWNER, type: "reserve", amount: 650, idempotencyKey: `${RUN}-msg1` });
    record("reserve 중복 호출 차단", r1dup.duplicated === true && (await walletService.getBalance(OWNER))?.reservedBalance === 650);

    // 동시 호출
    const raceKey = `${RUN}-msg-race`;
    await Promise.all([
      walletService.apply({ ownerUsername: OWNER, type: "reserve", amount: 100, idempotencyKey: raceKey }),
      walletService.apply({ ownerUsername: OWNER, type: "reserve", amount: 100, idempotencyKey: raceKey }),
    ]);
    const { count: raceCount } = await admin
      .from("message_wallet_transactions")
      .select("id", { count: "exact", head: true })
      .eq("owner_username", OWNER)
      .eq("idempotency_key", raceKey);
    record("reserve 동시 호출 — 거래 1건만(DB 레벨)", raceCount === 1, `${raceCount}건`);

    // ---- capture ----
    const cap = await walletService.apply({ ownerUsername: OWNER, type: "capture", amount: 650, idempotencyKey: `${RUN}-msg1` });
    record("capture — reserved 감소, available 복구 없음", cap.reservedBalance === 100 && cap.availableBalance === 9_250, JSON.stringify(cap));
    const capDup = await walletService.apply({ ownerUsername: OWNER, type: "capture", amount: 650, idempotencyKey: `${RUN}-msg1` });
    record("capture 중복 호출 차단", capDup.duplicated === true);

    // ---- release ----
    const rel = await walletService.apply({ ownerUsername: OWNER, type: "release", amount: 100, idempotencyKey: raceKey });
    record("release — reserved 감소 + available 복구", rel.reservedBalance === 0 && rel.availableBalance === 9_350, JSON.stringify(rel));

    // ---- 정합성 ----
    const sum = await ledgerSum(OWNER);
    const bal = await walletService.getBalance(OWNER);
    record(
      "원장 합계 == 지갑 잔액",
      sum.available === bal?.availableBalance && sum.reserved === bal?.reservedBalance,
      `ledger=${JSON.stringify(sum)} wallet=${JSON.stringify(bal)}`
    );

    // ---- 실패 케이스 ----
    const over = await walletService.apply({ ownerUsername: OWNER, type: "reserve", amount: 999_999, idempotencyKey: `${RUN}-over` });
    record("잔액 초과 예약 차단", !over.ok && !!over.error?.includes("insufficient_balance"), over.error);
    const overCapture = await walletService.apply({ ownerUsername: OWNER, type: "capture", amount: 500, idempotencyKey: `${RUN}-nocap` });
    record("예약보다 큰 확정 차단", !overCapture.ok, overCapture.error);
    const neg = await walletService.apply({ ownerUsername: OWNER, type: "adjust", amount: -999_999, reason: "음수 테스트", idempotencyKey: `${RUN}-neg` });
    record("음수 잔액이 되는 조정 차단", !neg.ok && !!neg.error?.includes("negative_balance"), neg.error);
    record("차단된 거래는 잔액을 바꾸지 않는다", (await walletService.getBalance(OWNER))?.availableBalance === 9_350);

    // ---- adjust(정상) ----
    const adj = await walletService.apply({ ownerUsername: OWNER, type: "adjust", amount: -350, reason: "QA 조정", createdBy: "qa-admin", idempotencyKey: `${RUN}-adj` });
    record("관리자 조정 반영", adj.ok && adj.availableBalance === 9_000, JSON.stringify(adj));
    const { data: adjRow } = await admin
      .from("message_wallet_transactions")
      .select("reason, created_by, reference_type")
      .eq("owner_username", OWNER)
      .eq("idempotency_key", `${RUN}-adj`)
      .maybeSingle();
    record("조정에 사유·관리자 기록", adjRow?.reason === "QA 조정" && adjRow?.created_by === "qa-admin");

    // ---- append-only ----
    const { data: anyTx } = await admin.from("message_wallet_transactions").select("id").eq("owner_username", OWNER).limit(1).maybeSingle();
    const upd = await admin.from("message_wallet_transactions").update({ amount: 1 }).eq("id", anyTx!.id);
    record("과거 거래 UPDATE 차단(append-only)", !!upd.error, upd.error?.message?.slice(0, 60));
    const del = await admin.from("message_wallet_transactions").delete().eq("id", anyTx!.id);
    record("과거 거래 DELETE 차단(append-only)", !!del.error, del.error?.message?.slice(0, 60));

    // ---- 테넌트 격리 ----
    const b1 = await walletService.apply({ ownerUsername: OWNER_B, type: "charge", amount: 500, idempotencyKey: `${RUN}-b1` });
    record("user6 지갑은 별도", b1.availableBalance === 500);
    record("user3 잔액은 영향 없음", (await walletService.getBalance(OWNER))?.availableBalance === 9_000);
    const bSum = await ledgerSum(OWNER_B);
    record("테넌트별 원장 분리", bSum.available === 500);

    record("표시 단위 변환(1/100원 → 원)", formatAmount(9_000) === "90원" && formatAmount(650) === "6.5원", `${formatAmount(9_000)} / ${formatAmount(650)}`);
  } finally {
    await cleanup(OWNER);
    await cleanup(OWNER_B);
  }

  const { count: leftA } = await admin.from("message_wallet").select("id", { count: "exact", head: true }).eq("owner_username", OWNER);
  const { count: leftTx } = await admin.from("message_wallet_transactions").select("id", { count: "exact", head: true }).eq("owner_username", OWNER);
  record("cleanup — 지갑/원장 잔존 0", (leftA ?? 0) === 0 && (leftTx ?? 0) === 0, `wallet=${leftA} tx=${leftTx}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== STEP15-F2 메시지 지갑·원장: ${results.length - failed.length}/${results.length} PASS =====`);
  for (const f of failed) console.log(`  FAIL — ${f.step}${f.detail ? ` (${f.detail})` : ""}`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
