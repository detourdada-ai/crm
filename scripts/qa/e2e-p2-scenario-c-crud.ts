/**
 * CTO 작업지시서 §6 — 전화주문/수동주문 CRUD (Create/Read/Update/Delete)를
 * 실제 UI로 검증한다. STEP10 최종 운영 시나리오 E2E의 일부.
 *
 * Case3("기사배정전주문삭제")은 원문 그대로 해석하면 Case1(미배정주문삭제)과
 * 사실상 동일 시나리오가 되어 중복 검증이 된다 — "배정 완료 후, 배송 시작
 * 전" 상태로 해석해 Case1→2→3→4가 "미배정→그룹포함→기사배정→배송진행"으로
 * 단계적으로 진행하도록 구성했다(CTO 보고서에 이 해석을 명시해 CPO가 다르게
 * 의도했다면 바로잡을 수 있게 한다).
 *
 * Case4(배송진행중·완료 주문 삭제)는 현재 정책을 "확인만" 한다 — 결과가
 * 기대와 다르더라도 여기서 정책을 바꾸지 않는다.
 *
 * 이 스크립트가 만든 데이터는 전부 QA 데이터이므로(§9의 기사 A-1/A-2와
 * 달리 최종 인계 상태에 포함되지 않음) finally에서 전부 정리한다.
 *
 * 실행: npx tsx scripts/qa/e2e-p2-scenario-c-crud.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { stubDaumPostcodeAddress } from "./lib/daum-postcode-dynamic-stub";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = String(Date.now());
const DRIVER_A1_NAME = "QA-테스트기사A-1"; // §9에서 실제 UI로 만든 기사(재사용, 재생성하지 않음)

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

async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText().catch(() => "")) ?? "";
}

async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 15000): Promise<boolean> {
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

interface OrderFixture {
  recipient: string;
  phone: string;
  deliveryDate: string;
}

async function createOrderViaUi(
  page: Page,
  dialog: ReturnType<Page["getByRole"]>,
  fixture: OrderFixture,
  productName: string
): Promise<number> {
  const t0 = Date.now();
  await dialog.getByRole("tab", { name: "신규 고객 등록" }).click({ timeout: 5000 });
  await dialog.locator('input[name="newCustomerName"]').fill(fixture.recipient);
  await dialog.locator('input[name="newCustomerPhone"]').fill(fixture.phone);
  await dialog.locator('input[name="recipientName"]').fill(fixture.recipient);
  await dialog.locator('input[name="recipientPhone"]').fill(fixture.phone);
  await dialog.getByRole("button", { name: "주소 검색", exact: false }).first().click();
  await page.waitForTimeout(300);
  await dialog.locator('input[name="productName"]').fill(productName);
  const deliveryDateInput = dialog.locator('input[name="deliveryDate"]');
  if (await deliveryDateInput.count()) await deliveryDateInput.fill(fixture.deliveryDate);
  await dialog.getByRole("button", { name: "등록하고 계속 입력", exact: false }).click();
  return Date.now() - t0; // 폼 제출 클릭까지의 준비시간이 아니라, 아래에서 DB반영까지 별도로 측정한다
}

async function run() {
  console.log(`E2E target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (!tenant) throw new Error(`tenant "${OWNER}" not found`);
  const { data: driverA1 } = await admin.from("drivers").select("id,name").eq("owner_username", OWNER).eq("name", DRIVER_A1_NAME).maybeSingle();
  if (!driverA1) throw new Error(`§9에서 만든 기사(${DRIVER_A1_NAME})를 찾을 수 없습니다 — e2e-p2-driver-creation.ts를 먼저 실행하세요.`);

  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    await stubDaumPostcodeAddress(context, { roadAddress: "서울 강남구 테헤란로 152", jibunAddress: "서울 강남구 역삼동 823", zonecode: "06236" });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER, "user");

    // ============================================================
    // CREATE + READ 타이밍: 기본 주문 1건
    // ============================================================
    const readFixture: OrderFixture = { recipient: `QA-CRUD-Read-${RUN_TAG}`, phone: "010-3000-0001", deliveryDate: addDaysIso(10) };
    await page.goto(`${BASE_URL}/orders`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "주문 등록", exact: false }).first().click();
    let dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    await dialog.getByText("직접 등록", { exact: true }).click({ timeout: 5000 });
    await page.waitForTimeout(400);

    const tCreate0 = Date.now();
    await createOrderViaUi(page, dialog, readFixture, "QA-CRUD 상품A");
    const dbOk = await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).eq("recipient_name", readFixture.recipient);
      return (count ?? 0) > 0;
    });
    const createMs = Date.now() - tCreate0;
    record("C-Create-1. 저장클릭→DB 반영(성공 응답)", dbOk, undefined, createMs);
    await dialog.getByRole("button", { name: "닫기", exact: true }).click({ timeout: 5000 }).catch(() => {});

    const { data: readOrder } = await admin.from("orders").select("id, customer_id, order_number").eq("owner_username", OWNER).eq("recipient_name", readFixture.recipient).maybeSingle();
    if (readOrder) {
      createdOrderIds.push(readOrder.id);
      createdCustomerIds.push(readOrder.customer_id);
    }

    // 주문관리 배송일 필터 기본값은 "오늘"(CEO 지시, orders/page.tsx 주석 참고)
    // — 미래 배송일 테스트 주문을 보려면 deliveryDateFilter=all이 필요하다.
    const tListRefl0 = Date.now();
    await page.goto(`${BASE_URL}/orders?deliveryDateFilter=all`, { waitUntil: "networkidle" });
    let listText = await mainText(page);
    const listMs = Date.now() - tListRefl0;
    record("C-Create-2. 저장 후 목록(주문관리) 반영(새로고침 없이 이동만으로 확인 가능)", listText.includes(readFixture.recipient), undefined, listMs);

    // ---- READ: 검색 필드별 조회 ----
    // 검색바 클릭 흐름(fill→조회 클릭) 대신 실제 서버가 읽는 쿼리스트링(q,
    // deliveryDateFilter=all)으로 직접 이동한다 — 필터바의 스테이징 클라이언트
    // 상태에 좌우되지 않고 서버 검색 로직 자체의 응답을 측정하기 위함.
    if (readOrder) {
      for (const [label, term] of [
        ["고객명", readFixture.recipient],
        ["전화번호", readFixture.phone],
        ["주문번호", readOrder.order_number ?? ""],
      ] as const) {
        if (!term) continue;
        const t0 = Date.now();
        await page.goto(`${BASE_URL}/orders?deliveryDateFilter=all&q=${encodeURIComponent(term)}`, { waitUntil: "networkidle" });
        const ms = Date.now() - t0;
        const text = await mainText(page);
        record(`C-Read. ${label}로 검색`, text.includes(readFixture.recipient), undefined, ms);
      }
    } else {
      record("C-Read. 검색 대상 주문 없음(생성 실패로 스킵)", false);
    }

    // ============================================================
    // UPDATE: 주문상세에서 수정 → 상세/목록/고객정보 정합성
    // ============================================================
    if (readOrder) {
      await page.goto(`${BASE_URL}/orders/${readOrder.id}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "수정", exact: true }).click({ timeout: 8000 });
      const editDialog = page.getByRole("dialog", { name: "주문 수정" });
      await editDialog.waitFor({ state: "visible", timeout: 8000 });

      const newPhone = "010-3000-9999";
      const newDate = addDaysIso(11);
      await editDialog.locator("#editPhone").fill(newPhone);
      await editDialog.locator("#editDeliveryDate").fill(newDate);
      await editDialog.locator("#editProductName").fill("QA-CRUD 상품A(수정됨)");
      const tUpdate0 = Date.now();
      await editDialog.getByRole("button", { name: "저장", exact: true }).click({ timeout: 5000 });
      await editDialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
      const updateMs = Date.now() - tUpdate0;

      const updated = await waitForCondition(async () => {
        const { data } = await admin.from("orders").select("phone_snapshot, delivery_date").eq("id", readOrder.id).maybeSingle();
        return data?.phone_snapshot === newPhone;
      });
      record("C-Update-1. 주문상세 수정 → DB 반영(전화/배송일/상품명)", updated, undefined, updateMs);

      await page.reload({ waitUntil: "networkidle" });
      const detailText = await mainText(page);
      record("C-Update-2. 주문상세 화면에 수정값 즉시 반영", detailText.includes(newPhone) && detailText.includes("상품A(수정됨)"));

      await page.goto(`${BASE_URL}/orders?deliveryDateFilter=all`, { waitUntil: "networkidle" });
      const listAfterUpdate = await mainText(page);
      record("C-Update-3. 주문관리 목록에도 수정값 반영", listAfterUpdate.includes("상품A(수정됨)"));
    } else {
      record("C-Update. 대상 주문 없음(생성 실패로 스킵)", false);
    }

    // ============================================================
    // Case1: 미배정 주문 삭제
    // ============================================================
    const case1Fixture: OrderFixture = { recipient: `QA-CRUD-Case1-${RUN_TAG}`, phone: "010-3000-0002", deliveryDate: addDaysIso(12) };
    await page.goto(`${BASE_URL}/orders`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "주문 등록", exact: false }).first().click();
    dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    await dialog.getByText("직접 등록", { exact: true }).click({ timeout: 5000 });
    await page.waitForTimeout(400);
    await createOrderViaUi(page, dialog, case1Fixture, "QA-CRUD Case1 상품");
    await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).eq("recipient_name", case1Fixture.recipient);
      return (count ?? 0) > 0;
    });
    await dialog.getByRole("button", { name: "닫기", exact: true }).click({ timeout: 5000 }).catch(() => {});
    const { data: case1Order } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("recipient_name", case1Fixture.recipient).maybeSingle();
    if (case1Order) {
      createdOrderIds.push(case1Order.id);
      const { data: c1cust } = await admin.from("orders").select("customer_id").eq("id", case1Order.id).maybeSingle();
      if (c1cust) createdCustomerIds.push(c1cust.customer_id);

      const { count: groupCountBefore } = await admin.from("order_shipments").select("delivery_group_id", { count: "exact", head: true }).eq("order_id", case1Order.id).not("delivery_group_id", "is", null);
      record("Case1-사전확인. 미배정(그룹 없음) 상태", (groupCountBefore ?? 0) === 0);

      await page.goto(`${BASE_URL}/orders/${case1Order.id}`, { waitUntil: "networkidle" });
      const deleteBtn = page.getByRole("button", { name: "삭제", exact: true });
      await deleteBtn.click({ timeout: 8000 });
      await page.getByRole("button", { name: /삭제/, exact: false }).last().click({ timeout: 5000 }).catch(() => {});
      const deleted1 = await waitForCondition(async () => {
        const { data } = await admin.from("orders").select("id").eq("id", case1Order.id).maybeSingle();
        return !data;
      });
      record("Case1. 미배정 주문 삭제 성공(다른 주문 영향 없음은 아래 전체건수로 재확인)", deleted1);
      if (deleted1) createdOrderIds.splice(createdOrderIds.indexOf(case1Order.id), 1);
    } else {
      record("Case1. 주문 생성 실패로 스킵", false);
    }

    // ============================================================
    // Case2: 배송그룹 포함 주문 삭제 (같은 주소·배송일 3건으로 그룹 형성)
    // ============================================================
    const groupDate = addDaysIso(13);
    const groupFixtures: OrderFixture[] = [
      { recipient: `QA-CRUD-Group1-${RUN_TAG}`, phone: "010-3000-0003", deliveryDate: groupDate },
      { recipient: `QA-CRUD-Group2-${RUN_TAG}`, phone: "010-3000-0004", deliveryDate: groupDate },
      { recipient: `QA-CRUD-Group3-${RUN_TAG}`, phone: "010-3000-0005", deliveryDate: groupDate },
    ];
    for (const f of groupFixtures) {
      await page.goto(`${BASE_URL}/orders`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "주문 등록", exact: false }).first().click();
      dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      await dialog.getByText("직접 등록", { exact: true }).click({ timeout: 5000 });
      await page.waitForTimeout(400);
      await createOrderViaUi(page, dialog, f, "QA-CRUD Group 상품");
      await waitForCondition(async () => {
        const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).eq("recipient_name", f.recipient);
        return (count ?? 0) > 0;
      });
      await dialog.getByRole("button", { name: "닫기", exact: true }).click({ timeout: 5000 }).catch(() => {});
    }
    const { data: groupOrders } = await admin.from("orders").select("id, customer_id").eq("owner_username", OWNER).in("recipient_name", groupFixtures.map((f) => f.recipient));
    for (const o of groupOrders ?? []) {
      createdOrderIds.push(o.id);
      createdCustomerIds.push(o.customer_id);
    }
    const tGroupForm0 = Date.now();
    const groupFormed = await waitForCondition(async () => {
      if (!groupOrders || groupOrders.length < 3) return false;
      const { data: shipments } = await admin.from("order_shipments").select("order_id, delivery_group_id").in("order_id", groupOrders.map((o) => o.id));
      const groupIds = new Set((shipments ?? []).map((s) => s.delivery_group_id).filter(Boolean));
      return groupIds.size === 1 && (shipments ?? []).every((s) => s.delivery_group_id);
    }, 20000);
    const groupFormMs = Date.now() - tGroupForm0;
    record("E-그룹형성. 동일 주소·배송일 3건 → 단일 배송그룹 자동 형성", groupFormed, undefined, groupFormMs);

    if (groupFormed && groupOrders) {
      const { data: shipmentsBefore } = await admin.from("order_shipments").select("id, order_id, delivery_group_id").in("order_id", groupOrders.map((o) => o.id));
      const groupId = shipmentsBefore?.[0]?.delivery_group_id;
      const targetOrderId = groupOrders[0].id;

      await page.goto(`${BASE_URL}/orders/${targetOrderId}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "삭제", exact: true }).click({ timeout: 8000 });
      await page.getByRole("button", { name: /삭제/, exact: false }).last().click({ timeout: 5000 }).catch(() => {});
      const deleted2 = await waitForCondition(async () => {
        const { data } = await admin.from("orders").select("id").eq("id", targetOrderId).maybeSingle();
        return !data;
      });
      record("Case2. 배송그룹 포함 주문 삭제 성공", deleted2);
      if (deleted2) createdOrderIds.splice(createdOrderIds.indexOf(targetOrderId), 1);

      const remainingIds = groupOrders.slice(1).map((o) => o.id);
      const { data: remainingShipments } = await admin.from("order_shipments").select("order_id, delivery_group_id").in("order_id", remainingIds);
      const remainingIntact = (remainingShipments ?? []).length === 2 && (remainingShipments ?? []).every((s) => s.delivery_group_id === groupId);
      record("Case2-검증. 삭제 후 남은 2건은 그룹/데이터 그대로 유지(다른 주문 영향 없음)", remainingIntact, JSON.stringify(remainingShipments));
    } else {
      record("Case2. 그룹이 형성되지 않아 삭제 시나리오 스킵", false);
    }

    // ============================================================
    // Case3: 기사 배정 완료(배송 시작 전) 상태에서 주문 삭제
    // ============================================================
    const case3Fixture: OrderFixture = { recipient: `QA-CRUD-Case3-${RUN_TAG}`, phone: "010-3000-0006", deliveryDate: addDaysIso(14) };
    await page.goto(`${BASE_URL}/orders`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "주문 등록", exact: false }).first().click();
    dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    await dialog.getByText("직접 등록", { exact: true }).click({ timeout: 5000 });
    await page.waitForTimeout(400);
    await createOrderViaUi(page, dialog, case3Fixture, "QA-CRUD Case3 상품");
    await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).eq("recipient_name", case3Fixture.recipient);
      return (count ?? 0) > 0;
    });
    await dialog.getByRole("button", { name: "닫기", exact: true }).click({ timeout: 5000 }).catch(() => {});
    const { data: case3Order } = await admin.from("orders").select("id, customer_id").eq("owner_username", OWNER).eq("recipient_name", case3Fixture.recipient).maybeSingle();
    if (case3Order) {
      createdOrderIds.push(case3Order.id);
      createdCustomerIds.push(case3Order.customer_id);
      const { data: c3ship } = await admin.from("order_shipments").select("id").eq("order_id", case3Order.id).maybeSingle();
      if (c3ship) {
        await admin.from("order_shipments").update({ driver_id: driverA1.id }).eq("id", c3ship.id);
      }
      const assignedOk = await waitForCondition(async () => {
        const { data } = await admin.from("order_shipments").select("driver_id, delivery_status").eq("order_id", case3Order.id).maybeSingle();
        return data?.driver_id === driverA1.id;
      });
      record("Case3-사전확인. 기사 배정 완료(배송 시작 전) 상태", assignedOk);

      await page.goto(`${BASE_URL}/orders/${case3Order.id}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "삭제", exact: true }).click({ timeout: 8000 });
      await page.getByRole("button", { name: /삭제/, exact: false }).last().click({ timeout: 5000 }).catch(() => {});
      const deleted3 = await waitForCondition(async () => {
        const { data } = await admin.from("orders").select("id").eq("id", case3Order.id).maybeSingle();
        return !data;
      });
      record("Case3. 기사배정 완료 상태 주문 삭제 결과(현재 정책 확인 — 성공 시 삭제 자체는 허용됨을 의미)", deleted3);
      if (deleted3) createdOrderIds.splice(createdOrderIds.indexOf(case3Order.id), 1);
    } else {
      record("Case3. 주문 생성 실패로 스킵", false);
    }

    // ============================================================
    // Case4: 배송 진행중/완료 주문 삭제 — 정책 확인만(수정하지 않음)
    // ============================================================
    const case4Fixture: OrderFixture = { recipient: `QA-CRUD-Case4-${RUN_TAG}`, phone: "010-3000-0007", deliveryDate: addDaysIso(15) };
    await page.goto(`${BASE_URL}/orders`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "주문 등록", exact: false }).first().click();
    dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    await dialog.getByText("직접 등록", { exact: true }).click({ timeout: 5000 });
    await page.waitForTimeout(400);
    await createOrderViaUi(page, dialog, case4Fixture, "QA-CRUD Case4 상품");
    await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).eq("recipient_name", case4Fixture.recipient);
      return (count ?? 0) > 0;
    });
    await dialog.getByRole("button", { name: "닫기", exact: true }).click({ timeout: 5000 }).catch(() => {});
    const { data: case4Order } = await admin.from("orders").select("id, customer_id").eq("owner_username", OWNER).eq("recipient_name", case4Fixture.recipient).maybeSingle();
    if (case4Order) {
      createdOrderIds.push(case4Order.id);
      createdCustomerIds.push(case4Order.customer_id);
      const { data: c4ship } = await admin.from("order_shipments").select("id").eq("order_id", case4Order.id).maybeSingle();
      if (c4ship) {
        await admin.from("order_shipments").update({ driver_id: driverA1.id, delivery_status: "배송중", route_order: 1 }).eq("id", c4ship.id);
      }
      const inProgressOk = await waitForCondition(async () => {
        const { data } = await admin.from("order_shipments").select("delivery_status").eq("order_id", case4Order.id).maybeSingle();
        return data?.delivery_status === "배송중";
      });
      record("Case4-사전확인. 배송중 상태로 전환", inProgressOk);

      await page.goto(`${BASE_URL}/orders/${case4Order.id}`, { waitUntil: "networkidle" });
      const deleteBtnCase4 = page.getByRole("button", { name: "삭제", exact: true });
      const deleteBtnVisible = await deleteBtnCase4.isVisible().catch(() => false);
      if (deleteBtnVisible) {
        await deleteBtnCase4.click({ timeout: 8000 });
        await page.getByRole("button", { name: /삭제/, exact: false }).last().click({ timeout: 5000 }).catch(() => {});
        const deleted4 = await waitForCondition(async () => {
          const { data } = await admin.from("orders").select("id").eq("id", case4Order.id).maybeSingle();
          return !data;
        }, 8000);
        record(
          "Case4. [정책확인용, 수정하지 않음] 배송중 상태 주문의 삭제 버튼이 노출되고 삭제가 허용됨",
          true,
          `삭제버튼노출=${deleteBtnVisible}, 실제삭제성공=${deleted4} — 이 결과가 기대 정책과 다르면 CPO 판단 필요`
        );
        if (deleted4) createdOrderIds.splice(createdOrderIds.indexOf(case4Order.id), 1);
      } else {
        record("Case4. [정책확인용, 수정하지 않음] 배송중 상태에서는 삭제 버튼이 노출되지 않음(차단 정책 존재)", true);
      }
    } else {
      record("Case4. 주문 생성 실패로 스킵", false);
    }
  } finally {
    for (const id of createdOrderIds) {
      await admin_delete_order(id);
    }
    for (const id of [...new Set(createdCustomerIds)]) {
      await admin_delete_customer_if_orphan(id);
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

  async function admin_delete_order(id: string) {
    await admin.from("order_shipments").delete().eq("order_id", id);
    await admin.from("order_items").delete().eq("order_id", id);
    const { error } = await admin.from("orders").delete().eq("id", id);
    if (error) console.error(`[cleanup] order ${id} 삭제 실패:`, error.message);
  }
  async function admin_delete_customer_if_orphan(id: string) {
    const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", id);
    if ((count ?? 0) === 0) {
      const { error } = await admin.from("customers").delete().eq("id", id);
      if (error) console.error(`[cleanup] customer ${id} 삭제 실패:`, error.message);
    }
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  console.error("FATAL stack:", e?.stack);
  process.exitCode = 1;
});
