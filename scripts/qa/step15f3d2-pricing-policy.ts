/**
 * STEP15-F3D-2(CPO 승인, 2026-09-06) — 단가 정책 저장소 · Resolver · dispatch 연결 QA.
 *
 * 이 스크립트가 답해야 하는 질문은 CRUD가 아니라 이것이다.
 *   **"v1으로 발송된 메시지와 v2로 발송된 메시지가 있을 때, v1을 고치거나 지우지 않고
 *     두 거래의 가격 근거를 각각 증명할 수 있는가?"**
 *
 *   ① 스키마 실측 — 테이블/컬럼/FK/인덱스, DDL 읽기가 아니라 실제 INSERT/UPDATE/DELETE
 *   ② active 중복 방지 — 테넌트 2건 차단 / **global(owner=null) 2건 차단** / 서로 다른 범위 허용
 *   ③ lifecycle — draft 수정 허용, draft→active, active 단가·축 수정 차단, active→retired,
 *                  retired→active 차단
 *   ④ 삭제 — 참조된 정책 DELETE는 RESTRICT / 참조 없는 정책은 삭제 가능
 *   ⑤ Resolver — tenant 우선 / global fallback / 없음 / draft·retired·타 테넌트 선택 금지
 *   ⑥ dispatch — 정책 없음이면 reserve 0·provider 0·wallet 0, 정책 있으면
 *                 tenant_charge와 price_policy_id **동시 기록**
 *   ⑦ v1 → v2 — 새 가격으로 바꾼 뒤에도 과거 로그의 금액·정책 id 불변
 *   ⑧ 잔여물 0
 *
 * 운영 가격은 만들지 않는다. 여기서 쓰는 숫자는 전부 QA fixture이고 finally에서 지운다.
 * 실제 발송 0(FakeProvider) / 실제 결제 0.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step15f3d2-pricing-policy.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { dispatchMessageEventWith } from "../../src/lib/services/messaging/dispatch";
import { getTenantMessageSettings, saveTenantMessageSettings } from "../../src/lib/services/messaging/message-settings.service";
import { pricingPolicyStore } from "../../src/lib/services/messaging/pricing-policy.repository";
import { DbPricingResolver } from "../../src/lib/services/messaging/pricing";
import { walletService } from "../../src/lib/services/messaging/wallet.service";
import type { MessageBalance, MessageProvider, MessageSendResult } from "../../src/lib/services/messaging/types";

const OWNER = QA_DEFAULT_OWNER;
const OWNER_B = QA_SECONDARY_OWNER;
assertAllowedQaOwner(OWNER);
assertAllowedQaOwner(OWNER_B);
const admin = getSupabaseAdmin();
const RUN = randomUUID().slice(0, 8);
const QA_PREFIX = `QA-F3D2-${RUN}-`;

// QA fixture 단가(1/100원 단위). 운영 가격이 아니며 실행이 끝나면 사라진다.
const V1 = 111;
const V2 = 222;

const results: { step: string; pass: boolean; detail?: string }[] = [];
function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail: pass ? undefined : detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${!pass && detail ? ` (${detail})` : ""}`);
}

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

class FakeProvider implements MessageProvider {
  readonly name = "noop";
  calls = 0;
  isConfigured(): boolean {
    return true;
  }
  async send(): Promise<MessageSendResult> {
    this.calls += 1;
    return { ok: true, providerMessageId: `fake-${randomUUID().slice(0, 8)}` };
  }
  async getBalance(): Promise<MessageBalance> {
    return { alimtalk: null, sms: null, lms: null };
  }
}

/** 정책 행을 직접 만든다(상태를 자유롭게 두기 위해 store가 아닌 raw insert). */
async function insertPolicy(p: {
  owner: string | null;
  kind?: string;
  messageType?: string;
  provider?: string;
  unitPrice?: number;
  status?: string;
}): Promise<{ id?: string; error?: string }> {
  const { data, error } = await admin
    .from("message_pricing_policies")
    .insert({
      owner_username: p.owner,
      kind: (p.kind ?? "transactional") as "transactional",
      message_type: (p.messageType ?? "alimtalk") as "alimtalk",
      provider: p.provider ?? "noop",
      unit_price: p.unitPrice ?? V1,
      status: (p.status ?? "draft") as "draft",
      note: QA_PREFIX,
    })
    .select("id")
    .maybeSingle();
  return { id: data?.id, error: error?.message };
}

async function run() {
  await assertTenantIsQaSafe(OWNER);
  await assertTenantIsQaSafe(OWNER_B);

  // migration 미적용이면 그 사실만 알리고 끝낸다(빈 PASS를 만들지 않는다).
  const probe = await admin.from("message_pricing_policies").select("id").limit(1);
  if (probe.error) {
    console.log(`⏸ migration 0060 미적용 — ${probe.error.message}`);
    process.exitCode = 1;
    return;
  }

  const created = { orderIds: [] as string[], customerIds: [] as string[], shipmentIds: [] as string[] };
  const settingsSnapshot: Record<string, unknown> = {};
  for (const owner of [OWNER, OWNER_B]) {
    const { data } = await admin.from("app_settings").select("value").eq("key", `message_settings:${owner}`).maybeSingle();
    settingsSnapshot[owner] = data?.value ?? null;
  }

  async function seedOrder(owner: string): Promise<string> {
    const { data: tenant } = await admin.from("tenants").select("id").eq("slug", owner).maybeSingle();
    const customerId = randomUUID();
    const orderId = randomUUID();
    await admin.from("customers").insert({
      id: customerId,
      name: `${QA_PREFIX}고객`,
      phone: "010-0000-0000",
      address: "서울 QA가격구 QA가격로 1",
      owner_username: owner,
      tenant_id: tenant!.id,
    });
    await admin.from("orders").insert({
      id: orderId,
      customer_id: customerId,
      internal_order_number: `${QA_PREFIX}${created.orderIds.length}`,
      order_date: kstToday(),
      recipient_name: `${QA_PREFIX}수취인`,
      recipient_phone_snapshot: "010-0000-0000",
      phone_snapshot: "010-0000-0000",
      address_snapshot: "서울 QA가격구 QA가격로 1",
      delivery_date: kstToday(),
      delivery_status: "배송대기" as const,
      fulfillment_method: "delivery" as const,
      owner_username: owner,
      tenant_id: tenant!.id,
    });
    created.orderIds.push(orderId);
    created.customerIds.push(customerId);
    return orderId;
  }

  async function logsFor(orderId: string) {
    const { data } = await admin
      .from("message_log")
      .select("id, status, skip_reason, tenant_charge, price_policy_id")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    return data ?? [];
  }

  const resolver = new DbPricingResolver();

  try {
    // ---------- ① 스키마 실측 ----------
    const colProbe = await admin.from("message_log").select("price_policy_id").limit(1);
    record("message_log.price_policy_id 존재", !colProbe.error, colProbe.error?.message);

    const negative = await insertPolicy({ owner: OWNER, unitPrice: 0 });
    record("unit_price = 0 차단", !!negative.error, negative.error ?? "삽입됨");
    const negative2 = await insertPolicy({ owner: OWNER, unitPrice: -1 });
    record("unit_price 음수 차단", !!negative2.error, negative2.error ?? "삽입됨");
    const badStatus = await insertPolicy({ owner: OWNER, status: "enabled" });
    record("허용되지 않은 status 차단", !!badStatus.error, badStatus.error ?? "삽입됨");
    const badKind = await insertPolicy({ owner: OWNER, kind: "delivery_notice" });
    record("허용되지 않은 kind 차단", !!badKind.error, badKind.error ?? "삽입됨");
    const badType = await insertPolicy({ owner: OWNER, messageType: "friendtalk" });
    record("허용되지 않은 message_type 차단", !!badType.error, badType.error ?? "삽입됨");

    // ---------- ② active 중복 방지 ----------
    const g1 = await insertPolicy({ owner: null, status: "active", unitPrice: V1 });
    record("global active 1건 생성", !!g1.id, g1.error);
    const g2 = await insertPolicy({ owner: null, status: "active", unitPrice: V2 });
    record("global active 2건째 차단(owner=null 중복)", !!g2.error && !g2.id, g2.error ?? "삽입됨 — NULL 중복이 열려 있다");

    const t1 = await insertPolicy({ owner: OWNER, status: "active", unitPrice: V1 });
    record("tenant active 생성(같은 축의 global과 공존)", !!t1.id, t1.error);
    const t2 = await insertPolicy({ owner: OWNER, status: "active", unitPrice: V2 });
    record("같은 tenant active 2건째 차단", !!t2.error && !t2.id, t2.error ?? "삽입됨");

    const tb = await insertPolicy({ owner: OWNER_B, status: "active", unitPrice: V2 });
    record("다른 tenant active 허용", !!tb.id, tb.error);

    const d1 = await insertPolicy({ owner: OWNER });
    const d2 = await insertPolicy({ owner: OWNER });
    record("같은 범위 draft 여러 건 허용", !!d1.id && !!d2.id, `${d1.error ?? ""} ${d2.error ?? ""}`);
    const r1 = await insertPolicy({ owner: OWNER, status: "retired" });
    const r2 = await insertPolicy({ owner: OWNER, status: "retired" });
    record("같은 범위 retired 이력 여러 건 허용", !!r1.id && !!r2.id, `${r1.error ?? ""} ${r2.error ?? ""}`);

    // ---------- ③ lifecycle / 보호 트리거 ----------
    const draftEdit = await admin.from("message_pricing_policies").update({ unit_price: V2 }).eq("id", d1.id!);
    record("draft 단가 수정 허용", !draftEdit.error, draftEdit.error?.message);
    const draftAxis = await admin.from("message_pricing_policies").update({ message_type: "sms" }).eq("id", d1.id!);
    record("draft 축 변경 허용", !draftAxis.error, draftAxis.error?.message);

    const activeEdit = await admin.from("message_pricing_policies").update({ unit_price: V2 }).eq("id", t1.id!);
    record("active 단가 직접 수정 차단", !!activeEdit.error, activeEdit.error?.message ?? "수정됨");
    const activeType = await admin.from("message_pricing_policies").update({ message_type: "sms" }).eq("id", t1.id!);
    record("active message_type 변경 차단", !!activeType.error, activeType.error?.message ?? "수정됨");
    const activeProv = await admin.from("message_pricing_policies").update({ provider: "aligo" }).eq("id", t1.id!);
    record("active provider 변경 차단", !!activeProv.error, activeProv.error?.message ?? "수정됨");
    const activeOwner = await admin.from("message_pricing_policies").update({ owner_username: OWNER_B }).eq("id", t1.id!);
    record("active owner 변경 차단", !!activeOwner.error, activeOwner.error?.message ?? "수정됨");
    const activeNote = await admin.from("message_pricing_policies").update({ note: `${QA_PREFIX}memo` }).eq("id", t1.id!);
    record("active 운영 메모 수정은 허용(가격 축이 아니다)", !activeNote.error, activeNote.error?.message);

    const reactivate = await admin.from("message_pricing_policies").update({ status: "active" }).eq("id", r1.id!);
    record("retired → active 되살리기 차단", !!reactivate.error, reactivate.error?.message ?? "되살아남");

    // ---------- ④ 삭제 경로 ----------
    const delUnref = await admin.from("message_pricing_policies").delete().eq("id", d2.id!);
    record("참조 없는 draft 정책 삭제 허용", !delUnref.error, delUnref.error?.message);
    const delRetired = await admin.from("message_pricing_policies").delete().eq("id", r2.id!);
    record("참조 없는 retired 정책 삭제 허용", !delRetired.error, delRetired.error?.message);

    // ---------- ⑤ Resolver ----------
    const rTenant = await resolver.resolve({ ownerUsername: OWNER, kind: "delivery_notice", channel: "alimtalk", provider: "noop" });
    record("tenant 정책 우선 선택", rTenant?.policyId === t1.id && rTenant?.unitPrice === V1, JSON.stringify(rTenant));

    const rGlobal = await resolver.resolve({ ownerUsername: "no-such-tenant", kind: "delivery_notice", channel: "alimtalk", provider: "noop" });
    record("tenant 정책 없으면 global fallback", rGlobal?.policyId === g1.id, JSON.stringify(rGlobal));

    const rOtherProvider = await resolver.resolve({ ownerUsername: OWNER, kind: "delivery_notice", channel: "alimtalk", provider: "aligo" });
    record("provider가 다르면 정책 없음", rOtherProvider === null, JSON.stringify(rOtherProvider));
    const rOtherChannel = await resolver.resolve({ ownerUsername: OWNER, kind: "delivery_notice", channel: "sms", provider: "noop" });
    record("message_type이 다르면 정책 없음", rOtherChannel === null, JSON.stringify(rOtherChannel));
    const rMarketing = await resolver.resolve({ ownerUsername: OWNER, kind: "marketing", channel: "alimtalk", provider: "noop" });
    record("kind가 다르면 정책 없음(kind는 별도 축)", rMarketing === null, JSON.stringify(rMarketing));

    // draft/retired는 후보가 아니다 — global을 잠시 치우고 tenant draft만 남겨 확인한다.
    await admin.from("message_pricing_policies").update({ status: "retired" }).eq("id", g1.id!);
    await admin.from("message_pricing_policies").update({ status: "retired" }).eq("id", t1.id!);
    const rNone = await resolver.resolve({ ownerUsername: OWNER, kind: "delivery_notice", channel: "alimtalk", provider: "noop" });
    record("draft·retired만 있으면 정책 없음(선택 금지)", rNone === null, JSON.stringify(rNone));

    const rIsolated = await resolver.resolve({ ownerUsername: OWNER, kind: "delivery_notice", channel: "alimtalk", provider: "noop" });
    record("다른 테넌트(user6) active 정책이 user3에 적용되지 않음", rIsolated === null, JSON.stringify(rIsolated));

    // ---------- ⑥ dispatch: 정책 없음 ----------
    const settings = await getTenantMessageSettings(OWNER);
    await saveTenantMessageSettings(OWNER, {
      ...settings,
      serviceStatus: "enabled",
      events: { ORDER_RECEIVED: true, DRIVER_ASSIGNED: true, DELIVERY_COMPLETED: true },
    });

    await admin.from("message_wallet").delete().eq("owner_username", OWNER);
    await walletService.apply({ ownerUsername: OWNER, type: "charge", amount: 100_000, idempotencyKey: `${RUN}-seed` });
    const beforeBalance = await walletService.getBalance(OWNER);

    const providerNoPrice = new FakeProvider();
    const orderNoPrice = await seedOrder(OWNER);
    await dispatchMessageEventWith(providerNoPrice, { eventType: "ORDER_RECEIVED", orderId: orderNoPrice, shipmentId: null });
    const noPriceLogs = await logsFor(orderNoPrice);
    record("정책 없음 → PRICE_NOT_CONFIGURED", noPriceLogs[0]?.skip_reason === "PRICE_NOT_CONFIGURED", JSON.stringify(noPriceLogs));
    record("정책 없음 → Provider 호출 0", providerNoPrice.calls === 0, `calls=${providerNoPrice.calls}`);
    const afterNoPrice = await walletService.getBalance(OWNER);
    record(
      "정책 없음 → 잔액·예약 변동 0",
      afterNoPrice?.availableBalance === beforeBalance?.availableBalance && afterNoPrice?.reservedBalance === beforeBalance?.reservedBalance,
      `${JSON.stringify(beforeBalance)} → ${JSON.stringify(afterNoPrice)}`
    );
    const { count: ledgerNoPrice } = await admin
      .from("message_wallet_transactions")
      .select("id", { count: "exact", head: true })
      .eq("reference_type", "message");
    record("정책 없음 → 원장 message 기록 0", (ledgerNoPrice ?? 0) === 0, `${ledgerNoPrice}`);

    // ---------- ⑦ v1 발송 → v2로 교체 → 과거 불변 ----------
    const v1 = await insertPolicy({ owner: OWNER, status: "active", unitPrice: V1 });
    record("v1 정책 활성화", !!v1.id, v1.error);

    const providerV1 = new FakeProvider();
    const orderV1 = await seedOrder(OWNER);
    await dispatchMessageEventWith(providerV1, { eventType: "ORDER_RECEIVED", orderId: orderV1, shipmentId: null });
    const logsV1 = await logsFor(orderV1);
    record("v1 발송 성공", logsV1[0]?.status === "sent", JSON.stringify(logsV1));
    record("v1 로그에 tenant_charge 기록", logsV1[0]?.tenant_charge === V1, JSON.stringify(logsV1[0]));
    record("v1 로그에 price_policy_id 기록(동시 기록)", logsV1[0]?.price_policy_id === v1.id, JSON.stringify(logsV1[0]));

    const afterV1 = await walletService.getBalance(OWNER);
    record(
      "발송 성공 → capture로 잔액 차감",
      (beforeBalance?.availableBalance ?? 0) - (afterV1?.availableBalance ?? 0) === V1 && afterV1?.reservedBalance === 0,
      JSON.stringify(afterV1)
    );

    // 참조된 정책은 지울 수 없다.
    const delRef = await admin.from("message_pricing_policies").delete().eq("id", v1.id!);
    record("참조된 정책 DELETE는 RESTRICT로 차단", !!delRef.error, delRef.error?.message ?? "삭제됨 — 증빙이 끊긴다");

    // 가격 변경: v1 은퇴 → v2 활성.
    const retire = await pricingPolicyStore.retirePolicy(v1.id!);
    record("v1 active → retired 전환 허용", retire.ok, retire.error);
    const v2 = await insertPolicy({ owner: OWNER, status: "active", unitPrice: V2 });
    record("v2 정책 활성화(같은 범위, v1 은퇴 후)", !!v2.id, v2.error);

    const providerV2 = new FakeProvider();
    const orderV2 = await seedOrder(OWNER);
    await dispatchMessageEventWith(providerV2, { eventType: "ORDER_RECEIVED", orderId: orderV2, shipmentId: null });
    const logsV2 = await logsFor(orderV2);
    record("v2 발송 로그의 금액 = v2 단가", logsV2[0]?.tenant_charge === V2, JSON.stringify(logsV2[0]));
    record("v2 발송 로그의 정책 id = v2", logsV2[0]?.price_policy_id === v2.id, JSON.stringify(logsV2[0]));

    const logsV1After = await logsFor(orderV1);
    record("가격 변경 후에도 과거 로그 금액 불변", logsV1After[0]?.tenant_charge === V1, JSON.stringify(logsV1After[0]));
    record("가격 변경 후에도 과거 로그 정책 id 불변(v1)", logsV1After[0]?.price_policy_id === v1.id, JSON.stringify(logsV1After[0]));

    const { data: v1Row } = await admin.from("message_pricing_policies").select("unit_price, status").eq("id", v1.id!).maybeSingle();
    record("은퇴한 v1의 단가가 그대로 남아 조회 가능", v1Row?.unit_price === V1 && v1Row?.status === "retired", JSON.stringify(v1Row));

    const retiredEdit = await admin.from("message_pricing_policies").update({ unit_price: V2 }).eq("id", v1.id!);
    record("은퇴한 v1의 단가 수정 차단(과거 재해석 불가)", !!retiredEdit.error, retiredEdit.error?.message ?? "수정됨");

    // ---------- FK/시스템 정리 경로 ----------
    // 정책을 참조하던 로그를 지우면 그 뒤에는 정책을 지울 수 있어야 한다.
    // (0055·0058처럼 보호 로직이 정상 정리까지 막지 않는지 실측한다.)
    await admin.from("message_log").delete().eq("order_id", orderV1);
    const delAfterLogGone = await admin.from("message_pricing_policies").delete().eq("id", v1.id!);
    record("참조 로그 정리 후에는 정책 삭제 가능(보호 로직이 정상 정리를 막지 않음)", !delAfterLogGone.error, delAfterLogGone.error?.message);

    const orderDelete = await admin.from("orders").delete().eq("id", orderV2);
    record("정책을 참조하는 로그가 있어도 주문 삭제는 정상 동작", !orderDelete.error, orderDelete.error?.message);
  } finally {
    // ---------- ⑧ cleanup ----------
    if (created.orderIds.length > 0) {
      await admin.from("message_log").delete().in("order_id", created.orderIds);
      if (created.shipmentIds.length > 0) await admin.from("order_shipments").delete().in("id", created.shipmentIds);
      await admin.from("orders").delete().in("id", created.orderIds);
    }
    if (created.customerIds.length > 0) await admin.from("customers").delete().in("id", created.customerIds);
    // 로그를 먼저 지운 뒤에야 정책을 지울 수 있다(RESTRICT). 순서가 곧 설계의 증명이다.
    await admin.from("message_log").delete().eq("owner_username", OWNER).not("price_policy_id", "is", null);
    await admin.from("message_pricing_policies").delete().eq("note", QA_PREFIX);
    await admin.from("message_wallet").delete().eq("owner_username", OWNER);
    await admin.from("message_wallet").delete().eq("owner_username", OWNER_B);
    for (const owner of [OWNER, OWNER_B]) {
      const before = settingsSnapshot[owner];
      if (before === null) await admin.from("app_settings").delete().eq("key", `message_settings:${owner}`);
      else
        await admin
          .from("app_settings")
          .upsert({ key: `message_settings:${owner}`, value: before as Record<string, unknown>, updated_at: new Date().toISOString() }, { onConflict: "key" });
    }
  }

  const { count: leftPolicies } = await admin.from("message_pricing_policies").select("id", { count: "exact", head: true });
  const { count: leftLogs } = await admin.from("message_log").select("id", { count: "exact", head: true });
  const { count: leftWallet } = await admin.from("message_wallet").select("id", { count: "exact", head: true });
  record(
    "cleanup 잔존 0 (정책/로그/지갑)",
    (leftPolicies ?? 0) === 0 && (leftLogs ?? 0) === 0 && (leftWallet ?? 0) === 0,
    `policies=${leftPolicies} logs=${leftLogs} wallet=${leftWallet}`
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== STEP15-F3D-2 Pricing Policy: ${results.length - failed.length}/${results.length} PASS =====`);
  for (const f of failed) console.log(`  FAIL — ${f.step}${f.detail ? ` (${f.detail})` : ""}`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
