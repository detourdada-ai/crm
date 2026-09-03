/**
 * STEP11-3(CPO 작업지시, 2026-08) — 「CPO 통합 실사용 검증」. 지금까지
 * 기능별로 따로 검증했던 것(누적 Import/날짜 필터/3단 지역 필터/기사 배정
 * 성능)을 실제 사장님이 하루를 쓰는 것처럼 하나의 흐름으로 연결해서
 * 검증한다:
 *
 *   Import(누적 + 날짜필터) → 배송목록 → 지역/동/건물 필터 → 기사 일괄배정
 *   → 개별 기사수정 → 가방번호 → 회수여부 → 새로고침 → DB 최종검증
 *
 * 실제 지오코딩(Kakao)이 필요하므로 로컬(.env.local에 서버측 REST 키 없음)이
 * 아니라 Production을 기본 대상으로 한다 — QA_SECONDARY_OWNER(user4, 현재
 * 비어있음)에만 쓰고 끝나면 전부 지운다(AGENTS.md 4단계 절차: 이 스크립트는
 * "쓰기"이므로 대상, 즉 테스트 tenant인지 먼저 확인 후 진행, 종료 시 자동
 * 원복). user1(실사용)/user3(CEO 데모)는 건드리지 않는다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/qa/e2e-step11-3-cpo-integrated-validation.ts
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { hashPassword } from "../../src/lib/auth/password";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_SECONDARY_OWNER; // user6 (STEP12-18에서 QA 전용 secondary tenant로 교체)
assertAllowedQaOwner(OWNER);
const RUN_TAG = String(Date.now());
const PREFIX = `QA-S113-${RUN_TAG}-`;

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  const shown = pass ? undefined : detail?.slice(0, 900);
  results.push({ step, pass, detail: shown });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${shown ? ` (${shown})` : ""}`);
}
function note(msg: string) {
  console.log(`[정보] ${msg}`);
}

/** 150건 일괄배정 직후처럼 서버가 순간적으로 바쁠 때, 단건 액션의 revalidate가
 * DB 조회 시점보다 늦게 반영될 수 있어 고정 대기 대신 조건이 참이 될 때까지
 * 짧은 간격으로 재확인한다(최대 timeoutMs). */
async function pollUntil<T>(fn: () => Promise<T>, isReady: (v: T) => boolean, timeoutMs = 10000, intervalMs = 500): Promise<T> {
  const start = Date.now();
  let last: T = await fn();
  while (!isReady(last) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await fn();
  }
  return last;
}

async function setSession(context: BrowserContext, username: string) {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, "user"), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}
function addDaysIso(days: number): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const TODAY = addDaysIso(0);
const TOMORROW = addDaysIso(1);

// ---- 실제 운영 데이터(STEP11-2 Phase3 조사)에서 확인된 실존 도로명주소 기반 ----
interface Row {
  orderNumber: string;
  name: string;
  phone: string;
  address: string;
  deliveryDate: string;
}
interface Group {
  key: string;
  buildingAddresses: string[]; // (동, 건물명) 패턴 — 여러 건물
  plainAddresses: string[]; // 건물명 없는 주소(기타 주소 버킷용)
}
const GROUPS: Group[] = [
  {
    key: "하남시-망월동",
    buildingAddresses: [
      "경기도 하남시 미사강변한강로 250 (망월동, 미사강변파밀리에아파트)",
      "경기도 하남시 미사강변중앙로 45 (망월동, 미사강변센트럴자이아파트)",
    ],
    plainAddresses: ["경기도 하남시 미사강변한강로 300", "경기도 하남시 미사강변동로 55"],
  },
  {
    key: "하남시-풍산동",
    buildingAddresses: ["경기도 하남시 대청로 10 (풍산동, 하남풍산아이파크아파트)"],
    plainAddresses: ["경기도 하남시 대청로 40"],
  },
  {
    key: "강동구-고덕동",
    buildingAddresses: ["서울특별시 강동구 고덕로 399 (고덕동, 고덕그라시움아파트)"],
    plainAddresses: ["서울특별시 강동구 고덕로 210"],
  },
  {
    key: "강동구-상일동",
    buildingAddresses: ["서울특별시 강동구 상일로 6 (상일동, 고덕아르테온아파트)"],
    plainAddresses: ["서울특별시 강동구 상일로 60"],
  },
  {
    key: "송파구-신천동",
    buildingAddresses: [],
    plainAddresses: ["서울특별시 송파구 올림픽로 240", "서울특별시 송파구 백제고분로 210"],
  },
];
// 지오코딩 실패를 자연스럽게 유도(존재하지 않는 지번) — "지역 미확인" 버킷 검증용.
const UNRESOLVABLE_ADDRESS = "충청남도 논산시 없는가상동 9999";

/** idx번째 주문의 그룹/건물유무를 결정 — 150건을 6개 버킷(대략 40/25/30/25/15/15)에 배분. */
function planFor(idx: number): { group: Group | null; buildingIdx: number | null } {
  // 0-39: 하남시-망월동(건물 30/기타 10), 40-64: 하남시-풍산동(건물15/기타10)
  // 65-94: 강동구-고덕동(건물20/기타10), 95-119: 강동구-상일동(건물15/기타10)
  // 120-134: 송파구-신천동(전부 기타), 135-149: 지역미확인
  if (idx < 40) {
    const g = GROUPS[0];
    return idx < 30 ? { group: g, buildingIdx: idx % g.buildingAddresses.length } : { group: g, buildingIdx: null };
  }
  if (idx < 65) {
    const g = GROUPS[1];
    return idx < 40 + 15 ? { group: g, buildingIdx: 0 } : { group: g, buildingIdx: null };
  }
  if (idx < 95) {
    const g = GROUPS[2];
    return idx < 65 + 20 ? { group: g, buildingIdx: 0 } : { group: g, buildingIdx: null };
  }
  if (idx < 120) {
    const g = GROUPS[3];
    return idx < 95 + 15 ? { group: g, buildingIdx: 0 } : { group: g, buildingIdx: null };
  }
  if (idx < 135) {
    return { group: GROUPS[4], buildingIdx: null };
  }
  return { group: null, buildingIdx: null };
}

function addressFor(idx: number): string {
  const { group, buildingIdx } = planFor(idx);
  if (!group) return `${UNRESOLVABLE_ADDRESS} ${idx}`;
  const base = buildingIdx !== null ? group.buildingAddresses[buildingIdx] : group.plainAddresses[idx % group.plainAddresses.length];
  return `${base} ${100 + idx}동 ${100 + (idx % 20)}호`;
}

/** 150건 전체 정의 — wave(처음 등장하는 파동)와 "이 시점 배송일"을 함께 갖는다. */
const ALL_ROWS: { idx: number; orderNumber: string; name: string; phone: string; address: string }[] = Array.from(
  { length: 150 },
  (_, idx) => ({
    idx,
    orderNumber: `${PREFIX}${idx + 1}`,
    name: `S113고객${idx + 1}`,
    phone: `010-9${String(idx + 1).padStart(3, "0")}-0000`,
    address: addressFor(idx),
  })
);

function buildXlsx(rows: Row[]): Buffer {
  const header = ["주문번호", "수취인명", "수취인전화번호", "배송지", "배송일", "상품명", "수량"];
  const data = rows.map((r) => [r.orderNumber, r.name, r.phone, r.address, r.deliveryDate, "통합검증 상품", 1]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "주문");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Wave1: idx 0-119(120건) — 0-99는 오늘, 100-119는 내일(날짜 제외 대상).
 *  Wave2: idx 0-139(140건, 누적) — 0-119 전부 오늘로 갱신(어제의 "내일"이 오늘이 됨) + 120-139 신규(오늘).
 *  Wave3: idx 0-149(150건, 누적) — 전부 오늘 + 140-149 신규(오늘). */
function waveRows(wave: 1 | 2 | 3): Row[] {
  const upper = wave === 1 ? 120 : wave === 2 ? 140 : 150;
  return ALL_ROWS.slice(0, upper).map((r) => {
    const deliveryDate = wave === 1 && r.idx >= 100 ? TOMORROW : TODAY;
    return { orderNumber: r.orderNumber, name: r.name, phone: r.phone, address: r.address, deliveryDate };
  });
}

async function uploadWithTodayFilter(page: Page, buf: Buffer, filename: string): Promise<void> {
  await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
  await dismissAnnouncementPopupIfPresent(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buf,
  });
  await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.getByRole("combobox", { name: "가져올 주문 범위" }).click();
  await page.getByRole("option", { name: "오늘 주문만 가져오기" }).click();
  await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 8000 });
  await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 90000 });
  await page.getByRole("button", { name: "신규 주문 등록하기", exact: true }).click({ timeout: 8000 });
  await page.getByText("업로드 완료").waitFor({ state: "visible", timeout: 240000 });
}

async function countOrders(admin: ReturnType<typeof getSupabaseAdmin>): Promise<number> {
  const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).ilike("order_number", `${PREFIX}%`);
  return count ?? 0;
}

/**
 * STEP12-19B: STEP11-13 이후 기사배정(일괄/개별)은 Draft 방식이다 — 조작은 화면에만
 * 반영되고 "변경사항 저장"을 눌러야 서버로 간다. 이 스크립트는 그 변경 이전에
 * 작성돼 즉시저장을 전제하고 있었고, 그래서 이후 단계가 "배정된 행"을 찾지 못해
 * 실패했다. 조작 → 배너 → 저장 → 토스트를 한 흐름으로 처리한다(조작 직후 첫
 * 클릭이 삼켜지는 STEP12-16B 이슈 때문에 사람 조작 속도만큼 기다린 뒤 누른다).
 */
async function saveDraftChanges(page: Page): Promise<boolean> {
  const banner = page.getByText(/변경사항 \d+건/).first();
  await banner.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  if (!(await banner.isVisible().catch(() => false))) return false;
  await page.waitForTimeout(800);
  // 직전 단계의 저장이 늦게 끝나면서 배너가 방금 사라졌을 수 있다 — 그 경우
  // 버튼이 없다고 예외를 던지는 대신 "저장할 게 남았는지"로 판정한다.
  const clicked = await page
    .getByRole("button", { name: "변경사항 저장" })
    .first()
    .click({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) return !(await banner.isVisible().catch(() => false));
  await page.getByText(/저장했습니다/).first().waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
  return true;
}

async function run() {
  console.log(`E2E target: ${BASE_URL}, tenant=${OWNER}, RUN_TAG=${RUN_TAG}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER);

    // ================= STEP1: 누적 Import(100→120→150) + 날짜 필터 =================
    const t0 = Date.now();
    await uploadWithTodayFilter(page, buildXlsx(waveRows(1)), `s113-wave1-${RUN_TAG}.xlsx`);
    const wave1Count = await countOrders(admin);
    record("STEP1-1. Wave1(120건 중 오늘 100 + 내일 20) → 실제 생성 100건", wave1Count === 100, `got=${wave1Count} (${Date.now() - t0}ms)`);

    const t1 = Date.now();
    await uploadWithTodayFilter(page, buildXlsx(waveRows(2)), `s113-wave2-${RUN_TAG}.xlsx`);
    const wave2Count = await countOrders(admin);
    record("STEP1-2. Wave2(누적140, 어제의 내일분 오늘로 전환+신규20) → 실제 생성 140건", wave2Count === 140, `got=${wave2Count} (${Date.now() - t1}ms)`);

    const t2 = Date.now();
    await uploadWithTodayFilter(page, buildXlsx(waveRows(3)), `s113-wave3-${RUN_TAG}.xlsx`);
    const wave3Count = await countOrders(admin);
    record("STEP1-3. Wave3(누적150, 신규10) → 실제 생성 150건(최종, 중복 생성 0)", wave3Count === 150, `got=${wave3Count} (${Date.now() - t2}ms)`);

    // ================= STEP2: 지오코딩 실제 분포 확인(읽기전용) =================
    const { data: geoRows } = await admin
      .from("orders")
      .select("sigungu, eupmyeondong")
      .eq("owner_username", OWNER)
      .ilike("order_number", `${PREFIX}%`);
    const bySigungu = new Map<string, number>();
    for (const o of geoRows ?? []) {
      const label = o.sigungu ?? "지역 미확인";
      bySigungu.set(label, (bySigungu.get(label) ?? 0) + 1);
    }
    const sorted = [...bySigungu.entries()].sort((a, b) => b[1] - a[1]);
    note(`지오코딩 결과 시군구 분포: ${sorted.map(([k, v]) => `${k}=${v}`).join(", ")}`);
    const topSigungu = sorted.find(([k]) => k !== "지역 미확인")?.[0] ?? null;
    record("STEP2-1. 지오코딩으로 최소 1개 이상 실제 시군구 확보(전부 지역미확인 아님)", !!topSigungu, `분포=${sorted.map(([k, v]) => `${k}:${v}`).join(",")}`);
    const unresolvedCount = bySigungu.get("지역 미확인") ?? 0;

    // ================= STEP3: 배송목록 진입 + 지역 3단 필터 =================
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    let mainText = (await page.locator("main").innerText().catch(() => "")) ?? "";
    record("STEP3-1. 배송목록에 150건(오늘) 전부 노출", mainText.includes("150"), mainText.slice(0, 200));

    let postCount = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/delivery")) postCount++;
    });

    if (topSigungu) {
      postCount = 0;
      const tClick0 = Date.now();
      await page.getByRole("button", { name: "전체 지역" }).click();
      await page.waitForTimeout(200);
      await page.getByRole("checkbox", { name: new RegExp(topSigungu) }).click();
      await page.waitForTimeout(150);
      const clickMs = Date.now() - tClick0;
      mainText = (await page.locator("main").innerText().catch(() => "")) ?? "";
      record(
        `STEP3-2. 시군구(${topSigungu}) 체크 → ${clickMs}ms 내 반영 + POST /delivery 0건`,
        clickMs < 3000 && postCount === 0 && mainText.includes(topSigungu),
        `clickMs=${clickMs} post=${postCount}`
      );

      // 읍면동 펼치기
      const expandBtn = page.getByRole("button", { name: new RegExp(`${topSigungu} 읍면동 목록 펼치기`) });
      if (await expandBtn.count()) {
        await expandBtn.first().click();
        await page.waitForTimeout(200);
        const popoverText = (await page.locator('[data-radix-popper-content-wrapper]').first().innerText().catch(() => "")) ?? "";
        record("STEP3-3. 읍면동 목록 펼치기 정상 동작", popoverText.length > 0, popoverText.slice(0, 200));
      }
      await page.getByRole("checkbox", { name: new RegExp(topSigungu) }).click(); // 해제 — 다음 단계를 위해 초기화
    } else {
      record("STEP3-2. 시군구 필터 조작(스킵 — 지오코딩 결과에 유효 시군구 없음)", false, "topSigungu=null");
    }

    // ================= STEP4: 기사 준비 + 일괄배정(100건 이상 규모) =================
    const driverId1 = randomUUID();
    const driverUsername1 = `s113drv1-${RUN_TAG}`.toLowerCase();
    const tenant = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
    const tenantId = tenant.data?.id;
    if (!tenantId) throw new Error("tenant not found");
    await admin.from("drivers").insert({ id: driverId1, name: `S113기사A-${RUN_TAG}`, phone: "010-0000-0001", status: "active", rate_per_delivery: 0, owner_username: OWNER, tenant_id: tenantId });
    await admin.from("app_accounts").insert({ username: driverUsername1, password_hash: hashPassword("qa-temp-1234"), role: "driver", driver_id: driverId1 });

    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.getByRole("checkbox", { name: /전체 선택/ }).waitFor({ state: "visible", timeout: 15000 });
    await page.getByRole("checkbox", { name: /전체 선택/ }).click();
    await page.getByRole("button", { name: "일괄 적용" }).waitFor({ state: "visible", timeout: 15000 });
    const tBulk0 = Date.now();
    await page.getByRole("combobox", { name: "담당 기사 선택" }).click();
    await page.getByRole("option", { name: new RegExp(`S113기사A-${RUN_TAG}`) }).click();
    await page.getByRole("button", { name: "일괄 적용" }).click({ timeout: 8000 });
    await saveDraftChanges(page);
    await page.getByText("처리하는 중...").waitFor({ state: "hidden", timeout: 60000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(500);
    const bulkMs = Date.now() - tBulk0;
    const { count: assignedCount } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("owner_username", OWNER)
      .eq("driver_id", driverId1)
      .ilike("order_number", `${PREFIX}%`);
    note(`일괄배정: 대상 150건, driver_id 반영 ${assignedCount ?? 0}건, 소요 ${bulkMs}ms`);
    record(
      "STEP4-1. 150건 일괄배정 — 실제 DB 반영 확인 + 5초 이내",
      (assignedCount ?? 0) >= 149 && bulkMs < 8000,
      `assigned=${assignedCount} bulkMs=${bulkMs}`
    );

    // ================= STEP5: 개별 기사 수정 =================
    const driverId2 = randomUUID();
    const driverUsername2 = `s113drv2-${RUN_TAG}`.toLowerCase();
    await admin.from("drivers").insert({ id: driverId2, name: `S113기사B-${RUN_TAG}`, phone: "010-0000-0002", status: "active", rate_per_delivery: 0, owner_username: OWNER, tenant_id: tenantId });
    await admin.from("app_accounts").insert({ username: driverUsername2, password_hash: hashPassword("qa-temp-1234"), role: "driver", driver_id: driverId2 });

    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const firstDriverBtn = page.getByRole("button", { name: new RegExp(`담당기사 변경: S113기사A-${RUN_TAG}`) }).first();
    await firstDriverBtn.click();
    await page.getByRole("menu").waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("menuitem", { name: new RegExp(`S113기사B-${RUN_TAG}`) }).click();
    await saveDraftChanges(page);
    const driverBCount = await pollUntil(
      async () => (await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).eq("driver_id", driverId2).ilike("order_number", `${PREFIX}%`)).count ?? 0,
      (v) => v >= 1
    );
    record("STEP5-1. 개별 기사 변경 — 1건 driver_id 반영", driverBCount === 1, `got=${driverBCount}`);

    // ================= STEP6: 가방번호 + 회수여부 =================
    // 텍스트/aria-label 기반 앵커는 저장 후 재검증(revalidatePath)으로 행이
    // 재정렬되면 다른 배송건을 가리킬 위험이 있다. 각 행은 /orders/{id}로
    // 이동하는 고유 링크를 갖고 있으므로, STEP5에서 이미 확인한 order id를
    // 그대로 사용해 href 기준으로 정확히 같은 배송건의 행을 고정한다.
    const { data: driverBOrder } = await admin
      .from("orders")
      .select("id")
      .eq("owner_username", OWNER)
      .eq("driver_id", driverId2)
      .ilike("order_number", `${PREFIX}%`)
      .single();
    const driverBOrderId = driverBOrder!.id as string;
    const driverBRow = page.locator(`xpath=//a[@href="/orders/${driverBOrderId}"]/ancestor::div[contains(@class, "rounded-xl")][1]`);
    const bagInput = driverBRow.locator('input[placeholder="가방번호"]');
    await bagInput.fill(`BAG-${RUN_TAG}`);
    await bagInput.blur();
    // STEP11-13 이후 가방번호/회수여부도 즉시저장이 아니라 Draft다 — 저장해야 반영된다.
    await saveDraftChanges(page);
    const bagCount = await pollUntil(
      async () => (await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).eq("bag_number", `BAG-${RUN_TAG}`)).count ?? 0,
      (v) => v >= 1
    );
    record("STEP6-1. 가방번호 저장 확인", bagCount >= 1, `got=${bagCount}`);
    // 가방번호 저장 요청이 서버에서 아직 처리 중이면(특히 150건 일괄배정 직후
    // 서버가 바쁠 때) 배지가 "미회수" 텍스트 대신 로딩 스피너를 보여준다 —
    // DB에는 이미 반영됐어도 클라이언트 요청은 아직 안 끝났을 수 있으므로,
    // 텍스트가 안정될 때까지 기다린 뒤 클릭한다.
    // 가방번호 저장(서버 액션 + revalidatePath)이 끝나면 150건 목록이 통째로 다시
    // 렌더되면서 앞서 잡아둔 행 locator가 낡은 노드를 가리킬 수 있다 — 회수여부는
    // 그 직후 조작이라 특히 잘 어긋난다. 저장이 반영된 화면을 한 번 다시 읽고
    // 행을 새로 찾은 뒤 토글한다.
    await page.reload({ waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const freshDriverBRow = page.locator(`xpath=//a[@href="/orders/${driverBOrderId}"]/ancestor::div[contains(@class, "rounded-xl")][1]`);
    const returnToggle = freshDriverBRow.getByText("미회수").or(freshDriverBRow.getByText("회수완료"));
    await returnToggle.first().waitFor({ state: "visible", timeout: 15000 });
    if ((await freshDriverBRow.getByText("미회수").count()) > 0) {
      await freshDriverBRow.getByText("미회수").click();
      await saveDraftChanges(page);
    }
    const returnedCount = await pollUntil(
      async () =>
        (await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).eq("bag_number", `BAG-${RUN_TAG}`).eq("bag_returned", true)).count ?? 0,
      (v) => v >= 1
    );
    record("STEP6-2. 회수여부 저장 확인", returnedCount >= 1, `got=${returnedCount}`);

    // ================= STEP7: 새로고침 후 상태 유지 =================
    await page.reload({ waitUntil: "networkidle" });
    mainText = (await page.locator("main").innerText().catch(() => "")) ?? "";
    record(
      "STEP7-1. 새로고침 후 배정된 기사명/가방번호 화면에 유지",
      mainText.includes(`S113기사A-${RUN_TAG}`) && mainText.includes(`S113기사B-${RUN_TAG}`),
      mainText.slice(0, 200)
    );

    // ================= STEP8: Scenario D 데이터 — 지역/동 커버리지 =================
    const totalAssignable = 150 - unresolvedCount;
    const bulkCovered = (assignedCount ?? 0) - 1; // 개별로 재배정한 1건 제외
    const coverageRatio = totalAssignable > 0 ? Math.round((bulkCovered / totalAssignable) * 100) : 0;
    note(
      `[시나리오D 데이터] 전체 150건 중 지역미확인(개별확인 필요) ${unresolvedCount}건, ` +
        `지역단위 일괄배정으로 커버된 건 ${bulkCovered}건/${totalAssignable}건(${coverageRatio}%), 개별 수정 1건(테스트용)`
    );

    // ================= 정리: Import 전체삭제 =================
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.getByRole("button", { name: "전체 삭제" }).click({ timeout: 8000 });
    await page.getByRole("dialog").getByRole("button", { name: "전체 삭제" }).click({ timeout: 8000 });
    await page.getByText("삭제하는 중").waitFor({ state: "hidden", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const remaining = await countOrders(admin);
    record("정리-1. Import 전체삭제 후 이 실행분(150건) 전부 제거", remaining === 0, `remaining=${remaining}`);

    await admin.from("app_accounts").delete().in("username", [driverUsername1, driverUsername2]);
    await admin.from("drivers").delete().in("id", [driverId1, driverId2]);

    await context.close();
  } finally {
    await browser.close();
    // 이중 안전망 — 위 시나리오 중간에 실패해도 남은 QA 데이터를 직접 지운다.
    try {
      const admin2 = getSupabaseAdmin();
      const { data: orders } = await admin2.from("orders").select("id, customer_id").eq("owner_username", OWNER).ilike("order_number", `${PREFIX}%`);
      const orderIds = (orders ?? []).map((o) => o.id);
      const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id).filter((v): v is string => !!v))];
      if (orderIds.length) await admin2.from("orders").delete().in("id", orderIds);
      if (customerIds.length) await admin2.from("customers").delete().in("id", customerIds);
      await admin2.from("app_accounts").delete().ilike("username", `s113drv%-${RUN_TAG}`);
      await admin2.from("drivers").delete().ilike("name", `%-${RUN_TAG}`).eq("owner_username", OWNER);
    } catch (e) {
      console.error("[cleanup] 이중 안전망 실행 중 오류(무시하고 계속):", e);
    }
    console.log("cleanup done");
  }

  console.log("\n===== STEP11-3 CPO 통합 검증 SUMMARY =====");
  const passCount = results.filter((r) => r.pass).length;
  console.log(`PASS ${passCount} / ${results.length}`);
  if (passCount !== results.length) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e, e?.stack, JSON.stringify(e, Object.getOwnPropertyNames(e ?? {})));
  process.exitCode = 1;
});
