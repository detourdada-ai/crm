/**
 * CTO 작업지시서 §8 — 배송그룹 자동계산(지역 A/B/C 각 5건) 실제 UI 검증.
 * STEP10 최종 운영 시나리오 E2E의 일부.
 *
 * 실행: npx tsx scripts/qa/e2e-p2-scenario-e-groups.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { stubDaumPostcodeAddress, type DaumAddress } from "./lib/daum-postcode-dynamic-stub";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = String(Date.now());

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
  ms?: number;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string, ms?: number) {
  results.push({ step, pass, detail, ms });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${ms != null ? ` (${ms}ms)` : ""}${detail ? ` [${detail}]` : ""}`);
}

async function setSession(context: BrowserContext, username: string, role: "user" | "driver") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, role), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}
async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const REGIONS: Record<"A" | "B" | "C", DaumAddress> = {
  A: { roadAddress: "서울 강남구 테헤란로 152", jibunAddress: "서울 강남구 역삼동 823", zonecode: "06236" },
  B: { roadAddress: "서울 마포구 월드컵북로 396", jibunAddress: "서울 마포구 상암동 1600", zonecode: "03925" },
  C: { roadAddress: "서울 송파구 올림픽로 300", jibunAddress: "서울 송파구 신천동 29", zonecode: "05551" },
};

async function createOrderViaUi(page: Page, recipient: string, phone: string, deliveryDate: string) {
  await page.goto(`${BASE_URL}/orders`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "주문 등록", exact: false }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  await dialog.getByText("직접 등록", { exact: true }).click({ timeout: 5000 });
  await page.waitForTimeout(400);
  await dialog.getByRole("tab", { name: "신규 고객 등록" }).click({ timeout: 5000 });
  await dialog.locator('input[name="newCustomerName"]').fill(recipient);
  await dialog.locator('input[name="newCustomerPhone"]').fill(phone);
  await dialog.locator('input[name="recipientName"]').fill(recipient);
  await dialog.locator('input[name="recipientPhone"]').fill(phone);
  await dialog.getByRole("button", { name: "주소 검색", exact: false }).first().click();
  await page.waitForTimeout(300);
  await dialog.locator('input[name="productName"]').fill("QA-E 배송그룹 테스트 상품");
  const dd = dialog.locator('input[name="deliveryDate"]');
  if (await dd.count()) await dd.fill(deliveryDate);
  await dialog.getByRole("button", { name: "등록하고 계속 입력", exact: false }).click();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click({ timeout: 5000 }).catch(() => {});
}

async function run() {
  console.log(`E2E target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const deliveryDate = addDaysIso(20);
  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER, "user");

    const recipientsByRegion: Record<"A" | "B" | "C", string[]> = { A: [], B: [], C: [] };
    let lastSaveTs = 0;
    for (const region of ["A", "B", "C"] as const) {
      await stubDaumPostcodeAddress(context, REGIONS[region]);
      for (let i = 1; i <= 5; i++) {
        const recipient = `QA-E${region}${i}-${RUN_TAG}`;
        recipientsByRegion[region].push(recipient);
        await createOrderViaUi(page, recipient, `010-500${region.charCodeAt(0)}-000${i}`, deliveryDate);
        lastSaveTs = Date.now();
        await waitForCondition(async () => {
          const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).eq("recipient_name", recipient);
          return (count ?? 0) > 0;
        });
      }
    }

    const allRecipients = [...recipientsByRegion.A, ...recipientsByRegion.B, ...recipientsByRegion.C];
    const { data: allOrders } = await admin.from("orders").select("id, customer_id, recipient_name").eq("owner_username", OWNER).in("recipient_name", allRecipients);
    for (const o of allOrders ?? []) {
      createdOrderIds.push(o.id);
      createdCustomerIds.push(o.customer_id);
    }
    record("E-생성. 지역 A/B/C 각 5건, 총 15건 생성", (allOrders?.length ?? 0) === 15, `실제=${allOrders?.length}`);

    const tGroupWait0 = Date.now();
    const groupsFormed = await waitForCondition(async () => {
      const { data: ships } = await admin
        .from("order_shipments")
        .select("order_id, delivery_group_id")
        .in("order_id", (allOrders ?? []).map((o) => o.id));
      return (ships ?? []).length === 15 && (ships ?? []).every((s) => s.delivery_group_id);
    }, 25000);
    const groupWaitMs = Date.now() - tGroupWait0 + (Date.now() - lastSaveTs > 25000 ? 0 : Date.now() - lastSaveTs);
    record("E1. 전체 배송그룹 반영 완료(마지막 주문 저장 이후)", groupsFormed, undefined, groupWaitMs);

    const byRegionOrderIds: Record<"A" | "B" | "C", string[]> = {
      A: (allOrders ?? []).filter((o) => recipientsByRegion.A.includes(o.recipient_name!)).map((o) => o.id),
      B: (allOrders ?? []).filter((o) => recipientsByRegion.B.includes(o.recipient_name!)).map((o) => o.id),
      C: (allOrders ?? []).filter((o) => recipientsByRegion.C.includes(o.recipient_name!)).map((o) => o.id),
    };
    const { data: allShipments } = await admin
      .from("order_shipments")
      .select("id, order_id, delivery_group_id")
      .in("order_id", (allOrders ?? []).map((o) => o.id));

    const groupIdsByRegion: Record<"A" | "B" | "C", Set<string>> = { A: new Set(), B: new Set(), C: new Set() };
    for (const region of ["A", "B", "C"] as const) {
      for (const oid of byRegionOrderIds[region]) {
        const s = allShipments?.find((s) => s.order_id === oid);
        if (s?.delivery_group_id) groupIdsByRegion[region].add(s.delivery_group_id);
      }
    }
    record("E2. 지역 A가 단일 그룹으로 묶임", groupIdsByRegion.A.size === 1, `groupIds=${[...groupIdsByRegion.A]}`);
    record("E3. 지역 B가 단일 그룹으로 묶임", groupIdsByRegion.B.size === 1, `groupIds=${[...groupIdsByRegion.B]}`);
    record("E4. 지역 C가 단일 그룹으로 묶임", groupIdsByRegion.C.size === 1, `groupIds=${[...groupIdsByRegion.C]}`);
    const allThreeDistinct = new Set([...groupIdsByRegion.A, ...groupIdsByRegion.B, ...groupIdsByRegion.C]).size === 3;
    record("E5. A/B/C가 서로 다른 3개 그룹(지역 간 혼합 없음)", allThreeDistinct);

    const groupAId = [...groupIdsByRegion.A][0];
    const { data: groupARow } = await admin.from("delivery_groups").select("id, order_count").eq("id", groupAId).maybeSingle();
    record("E6. 그룹A의 order_count(5)가 실제 배송건수(5)와 일치", groupARow?.order_count === 5, `order_count=${groupARow?.order_count}`);

    // ---- 주소수정후재계산: A의 주문 1건을 B 주소로 수정 ----
    const movedOrderId = byRegionOrderIds.A[0];
    await stubDaumPostcodeAddress(context, REGIONS.B);
    await page.goto(`${BASE_URL}/orders/${movedOrderId}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "수정", exact: true }).click({ timeout: 8000 });
    const editDialog = page.getByRole("dialog", { name: "주문 수정" });
    await editDialog.waitFor({ state: "visible", timeout: 8000 });
    await editDialog.getByRole("button", { name: "주소 검색", exact: false }).first().click();
    await page.waitForTimeout(300);
    const tAddrEdit0 = Date.now();
    await editDialog.getByRole("button", { name: "저장", exact: true }).click({ timeout: 5000 });
    await editDialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    const movedOk = await waitForCondition(async () => {
      const { data } = await admin.from("order_shipments").select("delivery_group_id").eq("order_id", movedOrderId).maybeSingle();
      return data?.delivery_group_id != null && data.delivery_group_id !== groupAId;
    }, 20000);
    const addrEditMs = Date.now() - tAddrEdit0;
    const { data: movedShipment } = await admin.from("order_shipments").select("delivery_group_id").eq("order_id", movedOrderId).maybeSingle();
    record("E7. 주소수정 후 재계산 → B그룹으로 이동", !!(movedOk && movedShipment?.delivery_group_id && groupIdsByRegion.B.has(movedShipment.delivery_group_id)), undefined, addrEditMs);
    const aDecrementedOk = await waitForCondition(async () => {
      const { data } = await admin.from("delivery_groups").select("order_count").eq("id", groupAId).maybeSingle();
      return data?.order_count === 4;
    }, 20000);
    const { data: groupAAfterMove } = await admin.from("delivery_groups").select("order_count").eq("id", groupAId).maybeSingle();
    record("E8. A그룹 order_count가 4로 감소", aDecrementedOk, `실제=${groupAAfterMove?.order_count}`);

    // ---- 주문삭제후재계산: C의 주문 1건 삭제 ----
    const deleteOrderId = byRegionOrderIds.C[0];
    await page.goto(`${BASE_URL}/orders/${deleteOrderId}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "삭제", exact: true }).click({ timeout: 8000 });
    await page.getByRole("button", { name: /삭제/, exact: false }).last().click({ timeout: 5000 }).catch(() => {});
    const deletedOk = await waitForCondition(async () => {
      const { data } = await admin.from("orders").select("id").eq("id", deleteOrderId).maybeSingle();
      return !data;
    });
    if (deletedOk) createdOrderIds.splice(createdOrderIds.indexOf(deleteOrderId), 1);
    const groupCId = [...groupIdsByRegion.C][0];
    const decrementedOk = await waitForCondition(async () => {
      const { data } = await admin.from("delivery_groups").select("order_count").eq("id", groupCId).maybeSingle();
      return data?.order_count === 4;
    }, 20000);
    const { data: groupCAfterDelete } = await admin.from("delivery_groups").select("order_count").eq("id", groupCId).maybeSingle();
    record("E9. 주문삭제 후 재계산 → C그룹 order_count가 4로 감소", decrementedOk, `실제=${groupCAfterDelete?.order_count}`);

    // ---- 주문추가후재계산: A에 새 주문 1건 추가 ----
    await stubDaumPostcodeAddress(context, REGIONS.A);
    const addedRecipient = `QA-EA-added-${RUN_TAG}`;
    await createOrderViaUi(page, addedRecipient, "010-5001-9999", deliveryDate);
    await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).eq("recipient_name", addedRecipient);
      return (count ?? 0) > 0;
    });
    const { data: addedOrder } = await admin.from("orders").select("id, customer_id").eq("owner_username", OWNER).eq("recipient_name", addedRecipient).maybeSingle();
    if (addedOrder) {
      createdOrderIds.push(addedOrder.id);
      createdCustomerIds.push(addedOrder.customer_id);
    }
    const addedOk = await waitForCondition(async () => {
      const { data: groupA } = await admin.from("delivery_groups").select("order_count").eq("id", groupAId).maybeSingle();
      return groupA?.order_count === 5;
    }, 20000);
    record("E10. 주문추가 후 재계산 → A그룹 order_count가 5로 복귀", addedOk);

    // ---- 수동분리 / 분리해제 / Lock유지 ----
    const lockTargetOrderId = byRegionOrderIds.B[0];
    const { data: lockShipment } = await admin.from("order_shipments").select("id").eq("order_id", lockTargetOrderId).maybeSingle();
    await page.goto(`${BASE_URL}/orders/${lockTargetOrderId}`, { waitUntil: "networkidle" });
    const dateQs = `dateFilter=custom&dateFrom=${deliveryDate}&dateTo=${deliveryDate}`;
    await page.goto(`${BASE_URL}/delivery?${dateQs}`, { waitUntil: "networkidle" });
    const lockRow = page.getByTestId(`shipment-row-${lockShipment!.id}`);
    await lockRow.getByRole("button", { name: "그룹에서 분리", exact: false }).click({ timeout: 8000 });
    await page.getByRole("button", { name: "분리하기", exact: true }).click({ timeout: 5000 });
    const lockedOk = await waitForCondition(async () => {
      const { data } = await admin.from("order_shipments").select("delivery_group_locked, delivery_group_id").eq("id", lockShipment!.id).maybeSingle();
      return data?.delivery_group_locked === true;
    });
    const { data: shipAfterLock } = await admin.from("order_shipments").select("delivery_group_locked, delivery_group_id").eq("id", lockShipment!.id).maybeSingle();
    record("E11. 수동분리 → delivery_group_locked=true", lockedOk, JSON.stringify(shipAfterLock));

    // Lock 유지 확인: B에 새 주문을 추가해 재계산을 유발해도 분리된 건은 그대로인지
    await stubDaumPostcodeAddress(context, REGIONS.B);
    const bAddedRecipient = `QA-EB-added-${RUN_TAG}`;
    await createOrderViaUi(page, bAddedRecipient, "010-5002-9999", deliveryDate);
    await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).eq("recipient_name", bAddedRecipient);
      return (count ?? 0) > 0;
    });
    const { data: bAddedOrder } = await admin.from("orders").select("id, customer_id").eq("owner_username", OWNER).eq("recipient_name", bAddedRecipient).maybeSingle();
    if (bAddedOrder) {
      createdOrderIds.push(bAddedOrder.id);
      createdCustomerIds.push(bAddedOrder.customer_id);
    }
    await waitForCondition(async () => {
      const { data } = await admin.from("order_shipments").select("delivery_group_id").eq("order_id", bAddedOrder!.id).maybeSingle();
      return data?.delivery_group_id != null;
    }, 20000);
    const { data: shipStillLocked } = await admin.from("order_shipments").select("delivery_group_locked, delivery_group_id").eq("id", lockShipment!.id).maybeSingle();
    record("E12. B 재계산 유발 후에도 분리된 건은 Lock 유지(재편입 안 됨)", shipStillLocked?.delivery_group_locked === true, JSON.stringify(shipStillLocked));

    // ---- 분리해제 ----
    await page.goto(`${BASE_URL}/delivery?${dateQs}`, { waitUntil: "networkidle" });
    const lockRow2 = page.getByTestId(`shipment-row-${lockShipment!.id}`);
    await lockRow2.getByRole("button", { name: "분리 해제", exact: true }).click({ timeout: 8000 });
    const unlockedOk = await waitForCondition(async () => {
      const { data } = await admin.from("order_shipments").select("delivery_group_locked, delivery_group_id").eq("id", lockShipment!.id).maybeSingle();
      return data?.delivery_group_locked === false && data?.delivery_group_id != null;
    }, 20000);
    const { data: shipAfterUnlock } = await admin.from("order_shipments").select("delivery_group_locked, delivery_group_id").eq("id", lockShipment!.id).maybeSingle();
    record("E13. 분리해제 → Lock 해제 + 그룹 자동계산에 재편입", unlockedOk, JSON.stringify(shipAfterUnlock));
  } finally {
    for (const id of createdOrderIds) {
      await admin.from("order_shipments").delete().eq("order_id", id);
      await admin.from("order_items").delete().eq("order_id", id);
      const { error } = await admin.from("orders").delete().eq("id", id);
      if (error) console.error(`[cleanup] order ${id} 삭제 실패:`, error.message);
    }
    for (const id of [...new Set(createdCustomerIds)]) {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", id);
      if ((count ?? 0) === 0) {
        const { error } = await admin.from("customers").delete().eq("id", id);
        if (error) console.error(`[cleanup] customer ${id} 삭제 실패:`, error.message);
      }
    }
    // order_shipments를 admin으로 직접 지우면 delivery_groups 행 자체는 앱의
    // 정식 재계산 로직을 거치지 않아 남는다(회원이 0명인 "유령 그룹" 잔여물
    // — 실제 앱 버그가 아니라 이 QA 스크립트의 admin 직접삭제 방식의 부작용).
    // 재실행 시 동일 주소·배송일에 이 잔여 그룹이 다시 섞이지 않도록 정리한다.
    const { data: ownerGroups } = await admin.from("delivery_groups").select("id").eq("owner_username", OWNER);
    for (const g of ownerGroups ?? []) {
      const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("delivery_group_id", g.id);
      if ((count ?? 0) === 0) await admin.from("delivery_groups").delete().eq("id", g.id);
    }
    await browser.close();
  }

  const fails = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - fails.length}/${results.length} PASS ===`);
  if (fails.length > 0) {
    console.log("FAILED STEPS:");
    for (const f of fails) console.log(`- ${f.step}: ${f.detail}`);
    process.exitCode = 1;
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  console.error("FATAL stack:", e?.stack);
  process.exitCode = 1;
});
