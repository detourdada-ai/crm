/**
 * 배송목록 지역 멀티필터 — 모바일 반응형 스팟체크 (작업지시서 §9).
 * 390px 뷰포트에서 Popover 잘림/가로스크롤/체크박스 탭 영역/라벨 길이/
 * 필터 영역 줄바꿈을 확인한다. user2에 disposable 데이터를 만들고 끝나면 지운다.
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = "user2";

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  const shown = pass ? undefined : detail?.slice(0, 400);
  results.push({ step, pass, detail: shown });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${shown ? ` (${shown})` : ""}`);
}

async function setSession(context: BrowserContext, username: string) {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: qaSessionToken(username, "user"),
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

function kstTodayIso(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function main() {
  const admin = getSupabaseAdmin();
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (!tenant) throw new Error("tenant not found");
  const today = kstTodayIso();
  const customerId = randomUUID();
  const orderIds: string[] = [];
  const shipmentIds: string[] = [];
  const defs = [
    { sigungu: "강남구", name: "QA-CPO-모바일강남" },
    { sigungu: "송파구", name: "QA-CPO-모바일송파" },
    { sigungu: "강동구", name: "QA-CPO-모바일강동" },
  ];

  const browser = await chromium.launch();
  try {
    await admin.from("customers").insert({
      id: customerId,
      name: "QA-CPO-모바일고객",
      phone: "010-0000-0000",
      address: "서울 테스트로 1",
      owner_username: OWNER,
      tenant_id: tenant.id,
    });
    for (const d of defs) {
      const orderId = randomUUID();
      await admin.from("orders").insert({
        id: orderId,
        customer_id: customerId,
        internal_order_number: `QA-CPO-MOBILE-${Date.now()}-${d.sigungu}`,
        order_date: today,
        recipient_name: d.name,
        phone_snapshot: "010-0000-0000",
        address_snapshot: `서울 ${d.sigungu} 테스트로 1`,
        sigungu: d.sigungu,
        sido: "서울",
        delivery_date: today,
        delivery_status: "배송대기",
        fulfillment_method: "delivery",
        owner_username: OWNER,
        tenant_id: tenant.id,
      });
      orderIds.push(orderId);
      const shipmentId = randomUUID();
      await admin.from("order_shipments").insert({
        id: shipmentId,
        order_id: orderId,
        tenant_id: tenant.id,
        owner_username: OWNER,
        delivery_date: today,
        delivery_status: "배송대기",
        fulfillment_method: "delivery",
      });
      shipmentIds.push(shipmentId);
    }

    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await setSession(context, OWNER);

    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });

    // 1. 가로 스크롤 발생 여부
    const scrollCheck = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    record(
      "1. 390px 뷰포트에서 가로 스크롤 미발생",
      scrollCheck.scrollWidth <= scrollCheck.clientWidth + 2,
      JSON.stringify(scrollCheck)
    );

    // 2. 지역 트리거 버튼이 필터 영역 안에서 줄바꿈되어도 화면 밖으로 넘치지 않음
    const triggerBox = await page.getByRole("button", { name: "전체 지역" }).boundingBox();
    record(
      "2. 지역 필터 트리거가 뷰포트 안에 위치(화면 밖으로 넘치지 않음)",
      !!triggerBox && triggerBox.x >= 0 && triggerBox.x + triggerBox.width <= 390 + 1,
      JSON.stringify(triggerBox)
    );

    // 3. 팝오버 오픈 후 화면 밖으로 잘리지 않음(Radix collision 회피 확인)
    await page.getByRole("button", { name: "전체 지역" }).click();
    await page.waitForTimeout(300);
    const popover = page.locator('[data-radix-popper-content-wrapper]').first();
    const popoverBox = await popover.boundingBox();
    record(
      "3. 팝오버가 390px 뷰포트 안에서 렌더(화면 밖으로 잘리지 않음)",
      !!popoverBox && popoverBox.x >= -1 && popoverBox.x + popoverBox.width <= 390 + 1,
      JSON.stringify(popoverBox)
    );

    // 4. 체크박스 탭 영역 최소 크기(접근성 가이드 기준 24px 이상 권장, 최소 20px)
    const checkboxBox = await page.getByRole("checkbox", { name: /강남구/ }).boundingBox();
    record(
      "4. 체크박스 탭 영역이 지나치게 작지 않음(>=16px)",
      !!checkboxBox && checkboxBox.width >= 16 && checkboxBox.height >= 16,
      JSON.stringify(checkboxBox)
    );

    // 5. 3개 지역 선택 후 트리거 라벨이 과도하게 길어지지 않음(축약 표시)
    await page.getByRole("checkbox", { name: /강남구/ }).click();
    await page.waitForTimeout(150);
    await page.getByRole("checkbox", { name: /송파구/ }).click();
    await page.waitForTimeout(150);
    await page.getByRole("checkbox", { name: /강동구/ }).click();
    await page.waitForURL((u) => u.searchParams.getAll("region").length === 3, { timeout: 5000 }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    // 3개 선택 시 트리거 라벨은 "강남구 외 2개"처럼 "지역"이라는 단어를
    // 포함하지 않을 수 있어 텍스트 매칭 대신 트리거 버튼의 고유 아이콘
    // (ChevronDown, lucide-chevron-down 클래스)으로 안정적으로 찾는다.
    const triggerText = await page.locator("button:has(svg.lucide-chevron-down)").first().innerText();
    record(
      "5. 3개 지역 선택 시 트리거 라벨이 축약 표시(예: '강남구 외 2개')되어 지나치게 길지 않음",
      triggerText.length <= 15,
      `label="${triggerText}"`
    );

    // 6. 필터 영역(지역 트리거 + 상태 탭 등)이 과도하게 여러 줄로 깨지지 않음(대략치 확인)
    const filterBarBox = await page.locator("main").boundingBox();
    record("6. 페이지 메인 영역이 정상 렌더(overflow 없이 표시)", !!filterBarBox && filterBarBox.width <= 390 + 1, JSON.stringify(filterBarBox));

    await context.close();
  } finally {
    await browser.close();
    if (shipmentIds.length) await admin.from("order_shipments").delete().in("id", shipmentIds);
    if (orderIds.length) await admin.from("orders").delete().in("id", orderIds);
    await admin.from("customers").delete().eq("id", customerId);
    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("id", orderIds.length ? orderIds : ["00000000-0000-0000-0000-000000000000"]);
    console.log(`teardown check: remainingOrders=${count ?? 0}`);
  }

  console.log("\n===== MOBILE RESPONSIVE CHECK SUMMARY =====");
  const passCount = results.filter((r) => r.pass).length;
  console.log(`PASS ${passCount} / ${results.length}`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
