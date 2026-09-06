/**
 * STEP15-F3C(CPO 승인, 2026-09-06) — Charge Intent 저장소 & 지급 원자성 QA.
 *
 * 실제 PG·결제창·충전 상품·가격 정책 없음. 검증 대상은 **돈의 경계**다.
 *   ① DB 제약 실측 — 금액 부호 / total = wallet + bonus / owner+key unique /
 *                     같은 payment + kind='payment' unique / 다른 kind는 막히지 않음
 *   ② Payment 연결 — payment 없는 admin_grant 가능 / payment pending이면 차단 /
 *                     confirmed면 지급 / 다른 테넌트 payment 차단
 *   ③ 멱등성 — 같은 intent grant 연속·동시 호출 → Wallet charge 1건
 *   ④ 원자성 — Wallet이 실패하면 Intent도 granted가 되지 않는다
 *   ⑤ granted 이후 금액·payment·소유자 변경 차단
 *   ⑥ 정합성 — granted 합계 == charge_intent를 참조한 wallet charge 합계
 *   ⑦ 테넌트 격리 / cleanup 잔존 0
 *
 * migration 0058 미적용이면 그 사실만 알리고 종료한다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step15f3c-charge-intent.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { chargeIntentService } from "../../src/lib/services/payment/charge-intent.service";
import { walletService } from "../../src/lib/services/messaging/wallet.service";

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

async function tenantId(owner: string): Promise<string> {
  const { data } = await admin.from("tenants").select("id").eq("slug", owner).maybeSingle();
  return data!.id;
}

/** 테스트용 결제 1건 생성(실제 PG 없음 — 상태만 만든다). */
async function seedPayment(owner: string, amount: number, status: "pending" | "confirmed"): Promise<string> {
  const id = randomUUID();
  await admin.from("payments").insert({
    id,
    tenant_id: await tenantId(owner),
    owner_username: owner,
    amount,
    status,
    provider: "qa",
    idempotency_key: `${RUN}-${id}`,
  });
  return id;
}

async function cleanup() {
  await admin.from("message_charge_intents").delete().in("owner_username", [OWNER, OWNER_B]);
  await admin.from("payments").delete().in("owner_username", [OWNER, OWNER_B]);
  await admin.from("message_wallet").delete().in("owner_username", [OWNER, OWNER_B]);
}

async function run() {
  await assertTenantIsQaSafe(OWNER);
  await assertTenantIsQaSafe(OWNER_B);

  const probe = await admin.from("message_charge_intents").select("id").limit(1);
  if (probe.error) {
    console.log(`\n⏸ migration 0058 미적용 — Charge Intent QA를 건너뜁니다. (${probe.error.message.slice(0, 60)})`);
    return;
  }
  const { count: preIntents } = await admin.from("message_charge_intents").select("id", { count: "exact", head: true });
  const { count: preWallets } = await admin.from("message_wallet").select("id", { count: "exact", head: true });
  if ((preIntents ?? 0) > 0 || (preWallets ?? 0) > 0) {
    console.log("\n⏸ 기존 intent/지갑이 남아 있습니다. 실데이터 보호를 위해 중단합니다.");
    return;
  }

  try {
    // ---- ① DB 제약 ----
    const t3 = await tenantId(OWNER);
    const badTotal = await admin.from("message_charge_intents").insert({
      tenant_id: t3, owner_username: OWNER, kind: "admin_grant", wallet_amount: 1000, bonus_amount: 0, total_amount: 999, idempotency_key: `${RUN}-bt`,
    });
    record("total ≠ wallet + bonus 차단", !!badTotal.error, badTotal.error?.message?.slice(0, 50));

    const negative = await admin.from("message_charge_intents").insert({
      tenant_id: t3, owner_username: OWNER, kind: "admin_grant", wallet_amount: -1, bonus_amount: 0, total_amount: -1, idempotency_key: `${RUN}-neg`,
    });
    record("음수 금액 차단", !!negative.error, negative.error?.message?.slice(0, 50));

    const zero = await chargeIntentService.create({ ownerUsername: OWNER, kind: "admin_grant", walletAmount: 0, idempotencyKey: `${RUN}-zero` });
    record("총액 0 차단", !zero.ok && zero.error === "invalid_total_amount", JSON.stringify(zero));

    // ---- ② admin_grant (결제 없는 지급) ----
    const grantIntent = await chargeIntentService.create({
      ownerUsername: OWNER, kind: "admin_grant", walletAmount: 500_000, reason: "QA 베타 크레딧", idempotencyKey: `${RUN}-admin`,
    });
    record("결제 없는 admin_grant 생성", grantIntent.ok && grantIntent.intent?.paymentId === null, JSON.stringify(grantIntent.error));

    const dup = await chargeIntentService.create({
      ownerUsername: OWNER, kind: "admin_grant", walletAmount: 500_000, idempotencyKey: `${RUN}-admin`,
    });
    record("같은 owner+idempotency_key는 새로 만들지 않음", dup.duplicated === true && dup.intent?.id === grantIntent.intent?.id);

    const g1 = await chargeIntentService.grant(grantIntent.intent!.id, "qa-admin");
    record("admin_grant 지급 성공", g1.ok && !g1.duplicated, JSON.stringify(g1));
    const bal1 = await walletService.getBalance(OWNER);
    record("지급액이 잔액에 반영", bal1?.availableBalance === 500_000, JSON.stringify(bal1));

    // ---- ③ 멱등성: 연속 grant ----
    for (let i = 0; i < 3; i++) await chargeIntentService.grant(grantIntent.intent!.id, "qa-admin");
    const bal2 = await walletService.getBalance(OWNER);
    record("grant 연속 4회 — 잔액은 1회분", bal2?.availableBalance === 500_000, JSON.stringify(bal2));
    const { count: chargeCount } = await admin
      .from("message_wallet_transactions")
      .select("id", { count: "exact", head: true })
      .eq("owner_username", OWNER)
      .eq("reference_id", grantIntent.intent!.id);
    record("Wallet charge 거래 1건", chargeCount === 1, `${chargeCount}건`);

    // ---- ③ 멱등성: 동시 grant (DB 실측) ----
    const raceIntent = await chargeIntentService.create({
      ownerUsername: OWNER, kind: "admin_grant", walletAmount: 100_000, idempotencyKey: `${RUN}-race`,
    });
    await Promise.all([
      chargeIntentService.grant(raceIntent.intent!.id, "qa"),
      chargeIntentService.grant(raceIntent.intent!.id, "qa"),
      chargeIntentService.grant(raceIntent.intent!.id, "qa"),
    ]);
    const { count: raceCharges } = await admin
      .from("message_wallet_transactions")
      .select("id", { count: "exact", head: true })
      .eq("reference_id", raceIntent.intent!.id);
    record("동시 grant 3회 — Wallet charge 1건", raceCharges === 1, `${raceCharges}건`);
    record("동시 grant 후 상태는 granted 1건", (await chargeIntentService.findById(raceIntent.intent!.id))?.status === "granted");

    // ---- ② Payment 연결 ----
    const pendingPayment = await seedPayment(OWNER, 1_000_000, "pending");
    const pendingIntent = await chargeIntentService.create({
      ownerUsername: OWNER, kind: "payment", walletAmount: 1_000_000, paymentId: pendingPayment, idempotencyKey: `${RUN}-pend`,
    });
    const pendGrant = await chargeIntentService.grant(pendingIntent.intent!.id);
    record("Payment pending이면 지급 차단", !pendGrant.ok && !!pendGrant.error?.includes("payment_not_confirmed"), pendGrant.error);
    record("차단 시 Intent는 granted가 아니다", (await chargeIntentService.findById(pendingIntent.intent!.id))?.status !== "granted");

    const confirmedPayment = await seedPayment(OWNER, 1_000_000, "confirmed");
    const paidIntent = await chargeIntentService.create({
      ownerUsername: OWNER, kind: "payment", walletAmount: 1_000_000, paymentId: confirmedPayment, idempotencyKey: `${RUN}-paid`,
    });
    const paidGrant = await chargeIntentService.grant(paidIntent.intent!.id, "system");
    record("Payment confirmed면 지급 성공", paidGrant.ok, JSON.stringify(paidGrant));

    // 같은 payment로 두 번째 충전 intent → DB가 막는다.
    const secondForSamePayment = await admin.from("message_charge_intents").insert({
      tenant_id: t3, owner_username: OWNER, kind: "payment", wallet_amount: 1_000_000, bonus_amount: 0, total_amount: 1_000_000,
      payment_id: confirmedPayment, idempotency_key: `${RUN}-paid2`,
    });
    record("같은 Payment로 충전 Intent 2건 차단", !!secondForSamePayment.error, secondForSamePayment.error?.message?.slice(0, 50));

    // 다른 kind는 같은 payment를 참조해도 막히지 않는다(미래 확장 슬롯).
    const compensation = await admin.from("message_charge_intents").insert({
      tenant_id: t3, owner_username: OWNER, kind: "compensation", wallet_amount: 1000, bonus_amount: 0, total_amount: 1000,
      payment_id: confirmedPayment, idempotency_key: `${RUN}-comp`,
    });
    record("다른 kind는 같은 Payment 참조 가능(미래 확장)", !compensation.error, compensation.error?.message?.slice(0, 50));

    // 다른 테넌트 Payment 연결 → 지급 차단
    const bPayment = await seedPayment(OWNER_B, 1_000, "confirmed");
    const crossIntent = await chargeIntentService.create({
      ownerUsername: OWNER, kind: "payment", walletAmount: 1_000, paymentId: bPayment, idempotencyKey: `${RUN}-cross`,
    });
    const crossGrant = await chargeIntentService.grant(crossIntent.intent!.id);
    record("다른 테넌트 Payment 연결 지급 차단", !crossGrant.ok && !!crossGrant.error?.includes("payment_owner_mismatch"), crossGrant.error);

    // ---- ④ 원자성: Wallet 실패 시 Intent도 granted가 되지 않는다 ----
    const ghost = await chargeIntentService.grant(randomUUID());
    record("없는 Intent grant는 실패", !ghost.ok && !!ghost.error?.includes("charge_intent_not_found"), ghost.error);

    // Wallet RPC가 실제로 실패하는 조건을 만든다 — owner_username이 실제 tenant가 아니면
    // 지갑 생성 단계에서 tenant_not_found 예외가 나고, 같은 트랜잭션이므로 Intent도 롤백된다.
    const ghostOwner = `no-such-tenant-${RUN}`;
    const ghostIntentId = randomUUID();
    await admin.from("message_charge_intents").insert({
      id: ghostIntentId, tenant_id: t3, owner_username: ghostOwner, kind: "admin_grant",
      wallet_amount: 5_000, bonus_amount: 0, total_amount: 5_000, idempotency_key: `${RUN}-ghost`,
    });
    const atomic = await chargeIntentService.grant(ghostIntentId, "qa");
    const afterAtomic = await chargeIntentService.findById(ghostIntentId);
    const { count: ghostTx } = await admin
      .from("message_wallet_transactions")
      .select("id", { count: "exact", head: true })
      .eq("reference_id", ghostIntentId);
    record("Wallet 실패 시 grant도 실패", !atomic.ok, atomic.error);
    record("원자성 — Intent가 granted로 남지 않음", afterAtomic?.status !== "granted", afterAtomic?.status);
    record("원자성 — Wallet 거래 0건(반쪽 상태 없음)", (ghostTx ?? 0) === 0, `${ghostTx}건`);
    await admin.from("message_charge_intents").delete().eq("owner_username", ghostOwner);

    // 동시 grant 10회 — 애플리케이션 락이 아니라 DB만으로 성립하는지 확인.
    const race10 = await chargeIntentService.create({
      ownerUsername: OWNER, kind: "admin_grant", walletAmount: 1_000, idempotencyKey: `${RUN}-race10`,
    });
    await Promise.all(Array.from({ length: 10 }, () => chargeIntentService.grant(race10.intent!.id, "qa")));
    const { count: race10Charges } = await admin
      .from("message_wallet_transactions")
      .select("id", { count: "exact", head: true })
      .eq("reference_id", race10.intent!.id);
    record("동시 grant 10회 — Wallet charge 1건", race10Charges === 1, `${race10Charges}건`);

    // ---- ⑤ granted 이후 보호 ----
    const mutate = await admin
      .from("message_charge_intents")
      .update({ wallet_amount: 1, total_amount: 1 })
      .eq("id", grantIntent.intent!.id);
    record("granted 이후 금액 변경 차단", !!mutate.error, mutate.error?.message?.slice(0, 60));
    const mutateReason = await admin
      .from("message_charge_intents")
      .update({ reason: "운영 메모 추가" })
      .eq("id", grantIntent.intent!.id);
    record("granted 이후에도 운영 메모는 수정 가능", !mutateReason.error, mutateReason.error?.message?.slice(0, 60));

    // granted Intent가 참조하는 payment 삭제 — FK 정리(on delete set null)가 막히면 안 된다.
    // 0055/0058에서 트리거를 넓게 걸어 정상 운영까지 막았던 실수를 여기서 잡는다.
    const fkPayment = await seedPayment(OWNER, 2_000, "confirmed");
    const fkIntent = await chargeIntentService.create({
      ownerUsername: OWNER, kind: "payment", walletAmount: 2_000, paymentId: fkPayment, idempotencyKey: `${RUN}-fk`,
    });
    await chargeIntentService.grant(fkIntent.intent!.id, "qa");
    const delPayment = await admin.from("payments").delete().eq("id", fkPayment);
    record("granted Intent가 참조하는 payment 삭제 허용(FK 정리)", !delPayment.error, delPayment.error?.message?.slice(0, 60));

    // ---- ⑥ 정합성 ----
    const { data: grantedIntents } = await admin
      .from("message_charge_intents")
      .select("id, total_amount")
      .eq("status", "granted");
    const { data: charges } = await admin
      .from("message_wallet_transactions")
      .select("amount, reference_id")
      .eq("type", "charge")
      .eq("reference_type", "charge_intent");
    const intentSum = (grantedIntents ?? []).reduce((a, r) => a + r.total_amount, 0);
    const chargeSum = (charges ?? []).reduce((a, r) => a + r.amount, 0);
    record("granted 합계 == charge_intent 참조 charge 합계", intentSum === chargeSum, `intent=${intentSum} charge=${chargeSum}`);
    record("granted 건수 == charge 건수", (grantedIntents ?? []).length === (charges ?? []).length, `${grantedIntents?.length} vs ${charges?.length}`);

    // ---- ⑦ 테넌트 격리 ----
    const bIntent = await chargeIntentService.create({
      ownerUsername: OWNER_B, kind: "admin_grant", walletAmount: 3_000, idempotencyKey: `${RUN}-admin`,
    });
    record("같은 키라도 다른 테넌트는 별도 Intent", bIntent.ok && bIntent.duplicated !== true);
    await chargeIntentService.grant(bIntent.intent!.id, "qa");
    const balB = await walletService.getBalance(OWNER_B);
    record("user6 잔액은 자기 지급분만", balB?.availableBalance === 3_000, JSON.stringify(balB));
    // 기대값을 상수로 적으면 케이스를 추가할 때마다 어긋난다 — 이 테넌트의 granted 합계와 비교한다.
    const { data: myGranted } = await admin
      .from("message_charge_intents")
      .select("total_amount")
      .eq("owner_username", OWNER)
      .eq("status", "granted");
    const expectedA = (myGranted ?? []).reduce((sum, r) => sum + r.total_amount, 0);
    const balA = await walletService.getBalance(OWNER);
    record("user3 잔액 = 자기 granted 합계(다른 테넌트 지급 영향 없음)", balA?.availableBalance === expectedA, `잔액=${balA?.availableBalance} 기대=${expectedA}`);
  } finally {
    await cleanup();
  }

  const { count: leftI } = await admin.from("message_charge_intents").select("id", { count: "exact", head: true });
  const { count: leftP } = await admin.from("payments").select("id", { count: "exact", head: true });
  const { count: leftW } = await admin.from("message_wallet").select("id", { count: "exact", head: true });
  record("cleanup 잔존 0", (leftI ?? 0) === 0 && (leftP ?? 0) === 0 && (leftW ?? 0) === 0, `intent=${leftI} payment=${leftP} wallet=${leftW}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== STEP15-F3C Charge Intent: ${results.length - failed.length}/${results.length} PASS =====`);
  for (const f of failed) console.log(`  FAIL — ${f.step}${f.detail ? ` (${f.detail})` : ""}`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
