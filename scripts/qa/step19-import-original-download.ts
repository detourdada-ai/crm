/**
 * STEP19(CPO 지시, 2026-09-08) — 엑셀 원본 보관 + Admin 전용 다운로드 E2E 검증.
 *
 * CPO 지시의 검증 6항목을 그대로 따른다(대상 계정만 `user2` → `user3`으로 바꿈 —
 * user2는 실제 사장님 검증 계정이라 QA 쓰기 대상이 아니다. 시나리오는 동일하다).
 *
 *   1. 사장님(user3) 업로드
 *   2. import 생성 + file_path 연결
 *   3. Admin이 원본 다운로드
 *   4. **다운로드한 파일이 업로드한 파일과 바이트 단위로 동일한가**(sha256)
 *   5. 일반 사장님 / 타 테넌트 / 비로그인 접근 차단
 *   6. 기존 엑셀 등록 플로우 회귀(주문이 실제로 만들어졌는가)
 *
 * 4번이 이 기능의 존재 이유다 — "다운로드가 된다"가 아니라 "사장님이 올린 **그 파일**이
 * 그대로 나온다"를 확인해야 같은 파일로 재현할 수 있다.
 *
 * user3에만 쓰고 finally에서 주문/고객/배송/이력/스토리지 오브젝트까지 전부 지운다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step19-import-original-download.ts dotenv_config_path=.env.local
 */
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, makeRunTag } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";
import { IMPORT_ORIGINALS_BUCKET } from "../../src/lib/services/import-file-storage.service";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
const OTHER_TENANT = QA_SECONDARY_OWNER;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
assertAllowedQaOwner(OWNER);
assertAllowedQaOwner(OTHER_TENANT);

const RUN_TAG = makeRunTag("step19");
const UPLOAD_NAME = `QA-STEP19-원본확인-${RUN_TAG}.xlsx`;
const admin = getSupabaseAdmin();

let pass = 0;
let fail = 0;
function record(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function sha256(b: ArrayBuffer | Buffer | Uint8Array): string {
  return createHash("sha256").update(Buffer.from(b as Buffer)).digest("hex");
}

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** STD-2 표준 템플릿 헤더 그대로 — 매핑 화면에서 자동 인식되어 별도 조작이 필요 없다. */
function buildXlsx(recipients: string[]): Buffer {
  const rows = recipients.map((name, i) => ({
    주문번호: `${RUN_TAG}-${i}`,
    수취인명: name,
    "수취인 연락처": `010-7777-${String(1000 + i).slice(-4)}`,
    "배송지 주소": "서울 QA구 QA로 19",
    배송일: kstToday(),
    상품명: "QA상품",
    수량: 1,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "주문템플릿");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function main() {
  if (!ADMIN_USERNAME) throw new Error("ADMIN_USERNAME 환경변수가 필요합니다(Admin 다운로드 검증).");
  await assertTenantIsQaSafe(OWNER);

  const recipients = [`QA-STEP19-${RUN_TAG}-수령1`, `QA-STEP19-${RUN_TAG}-수령2`];
  const uploaded = buildXlsx(recipients);
  const uploadedHash = sha256(uploaded);
  console.log(`\n===== STEP19 원본 다운로드 E2E (${BASE_URL}) =====`);
  console.log(`  업로드 파일 ${UPLOAD_NAME} / ${uploaded.byteLength} bytes / sha256 ${uploadedHash.slice(0, 16)}…\n`);

  const browser = await chromium.launch();
  let importId: string | null = null;
  let filePath: string | null = null;

  try {
    // ---- 1. 사장님(user3)이 엑셀을 올린다 ----
    const ctx = await browser.newContext();
    await ctx.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: qaSessionToken(OWNER, "user"),
        domain: new URL(BASE_URL).hostname,
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    const page = await ctx.newPage();
    await registerAnnouncementPopupHandler(page);
    await page.goto(`${BASE_URL}/import`, { waitUntil: "domcontentloaded" });
    await dismissAnnouncementPopupIfPresent(page);

    await page.locator('input[type="file"]').setInputFiles({
      name: UPLOAD_NAME,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: uploaded,
    });
    await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 30000 });
    await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 15000 });
    await page.getByRole("button", { name: "신규 주문 등록하기", exact: true }).click({ timeout: 20000 });
    await page.getByText(/업로드가 완료|등록 결과|처리 결과/).first().waitFor({ state: "visible", timeout: 60000 }).catch(() => {});

    // ---- 2. import 레코드에 file_path가 연결됐는가 ----
    const { data: imp } = await admin
      .from("imports")
      .select("id, file_name, file_path, owner_username, tenant_id, status")
      .eq("owner_username", OWNER)
      .eq("file_name", UPLOAD_NAME)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    record("T1. 업로드가 import 이력으로 생성된다", !!imp, imp ? `status=${imp.status}` : "이력 없음");
    if (!imp) return;
    importId = imp.id as string;
    filePath = (imp.file_path as string | null) ?? null;

    record("T2. imports.file_path에 원본 경로가 연결된다", !!filePath, filePath ?? "null");
    record(
      "T3. 원본 경로가 tenant_id로 시작한다(경로 레벨 격리)",
      !!filePath && filePath.startsWith(`${imp.tenant_id}/`),
      filePath ?? ""
    );

    // ---- 6. 회귀: 기존 등록 플로우가 그대로 동작하는가 ----
    const { data: madeOrders } = await admin
      .from("orders")
      .select("id")
      .eq("owner_username", OWNER)
      .in("recipient_name", recipients);
    record("T4. 회귀 — 주문이 정상 등록된다(원본 보관이 등록을 방해하지 않음)", (madeOrders ?? []).length === recipients.length, `${(madeOrders ?? []).length}/${recipients.length}건`);

    // ---- 3·4. Admin이 원본을 받고, 업로드한 파일과 바이트가 같은가 ----
    const downloadUrl = `${BASE_URL}/api/import/${importId}/original`;
    const adminCtx = await browser.newContext();
    await adminCtx.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: qaSessionToken(ADMIN_USERNAME, "admin"),
        domain: new URL(BASE_URL).hostname,
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    const adminRes = await adminCtx.request.get(downloadUrl);
    record("T5. Admin은 원본을 다운로드할 수 있다", adminRes.status() === 200, `HTTP ${adminRes.status()}`);

    if (adminRes.status() === 200) {
      const got = await adminRes.body();
      record(
        "T6. ★ 다운로드한 파일이 업로드한 파일과 바이트 단위로 동일하다",
        sha256(got) === uploadedHash,
        `${got.byteLength} bytes / sha256 ${sha256(got).slice(0, 16)}…`
      );
      const disposition = adminRes.headers()["content-disposition"] ?? "";
      record(
        "T7. 원래 파일명으로 첨부 다운로드된다",
        disposition.includes("attachment") && disposition.includes(encodeURIComponent(UPLOAD_NAME)),
        disposition.slice(0, 120)
      );
      record("T8. 개인정보 원본이 캐시되지 않는다(no-store)", (adminRes.headers()["cache-control"] ?? "").includes("no-store"), adminRes.headers()["cache-control"] ?? "");
    }
    await adminCtx.close();

    // ---- 5. 권한 차단 ----
    const ownerRes = await ctx.request.get(downloadUrl);
    record("T9. 업로드한 사장님 본인(비-Admin)도 차단된다", ownerRes.status() === 403, `HTTP ${ownerRes.status()}`);

    const otherCtx = await browser.newContext();
    await otherCtx.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: qaSessionToken(OTHER_TENANT, "user"),
        domain: new URL(BASE_URL).hostname,
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    const otherRes = await otherCtx.request.get(downloadUrl);
    record("T10. 타 테넌트 사장님은 차단된다", otherRes.status() === 403, `HTTP ${otherRes.status()}`);
    const otherBody = await otherRes.text();
    record("T11. 차단 응답에 원본 내용이 섞이지 않는다", !otherBody.includes("PK") && otherBody.length < 500, `${otherBody.length}자`);
    await otherCtx.close();

    const anonCtx = await browser.newContext();
    const anonRes = await anonCtx.request.get(downloadUrl, { maxRedirects: 0 });
    record("T12. 비로그인 접근은 차단된다", anonRes.status() !== 200, `HTTP ${anonRes.status()}`);
    await anonCtx.close();

    // ---- Admin UI에 버튼이 실제로 보이는가 ----
    const adminPageCtx = await browser.newContext();
    await adminPageCtx.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: qaSessionToken(ADMIN_USERNAME, "admin"),
        domain: new URL(BASE_URL).hostname,
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    const adminPage = await adminPageCtx.newPage();
    await registerAnnouncementPopupHandler(adminPage);
    await adminPage.goto(`${BASE_URL}/import`, { waitUntil: "domcontentloaded" });
    await dismissAnnouncementPopupIfPresent(adminPage);
    const linkCount = await adminPage.locator(`a[href="/api/import/${importId}/original"]`).count();
    record("T13. Admin 이력 화면에 '원본 다운로드' 링크가 보인다", linkCount > 0, `${linkCount}개`);
    await adminPageCtx.close();

    // ---- 사장님 화면에는 그 링크가 없어야 한다 ----
    await page.goto(`${BASE_URL}/import`, { waitUntil: "domcontentloaded" });
    await dismissAnnouncementPopupIfPresent(page);
    const ownerLinkCount = await page.locator('a[href*="/original"]').count();
    record("T14. 사장님 화면에는 원본 다운로드 링크가 없다", ownerLinkCount === 0, `${ownerLinkCount}개`);

    // ---- 이력을 삭제하면 보관된 원본도 함께 사라지는가 ----
    // 행만 지우고 파일이 남으면, 사장님이 이력을 지워도 고객 개인정보가 든 엑셀이
    // 참조 없이 버킷에 남는다(첫 회귀 실행에서 실제로 orphan이 남아 발견된 항목).
    await page.getByRole("button", { name: /삭제/ }).first().click({ timeout: 15000 }).catch(async () => {
      await page.locator("button.text-destructive").first().click({ timeout: 15000 });
    });
    await page.getByRole("button", { name: "삭제", exact: true }).last().click({ timeout: 15000 });
    await page.getByText(/삭제했습니다/).first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});

    const stillThere = filePath
      ? (await admin.storage.from(IMPORT_ORIGINALS_BUCKET).download(filePath)).data !== null
      : true;
    record("T15. 이력을 삭제하면 보관된 원본도 함께 삭제된다(개인정보 잔존 없음)", !stillThere, stillThere ? "!!! 원본이 버킷에 남았다" : "삭제됨");

    await ctx.close();
  } finally {
    // ---- cleanup: 이번 실행이 만든 것만 지운다 ----
    const { data: orders } = await admin
      .from("orders")
      .select("id, customer_id")
      .eq("owner_username", OWNER)
      .like("recipient_name", `QA-STEP19-${RUN_TAG}-%`);
    const orderIds = (orders ?? []).map((o) => o.id as string);
    const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id as string).filter(Boolean))];
    if (orderIds.length > 0) {
      await admin.from("order_items").delete().in("order_id", orderIds);
      await admin.from("order_shipments").delete().in("order_id", orderIds);
      await admin.from("orders").delete().in("id", orderIds);
    }
    if (customerIds.length > 0) await admin.from("customers").delete().in("id", customerIds);
    if (importId) await admin.from("imports").delete().eq("id", importId);
    if (filePath) await admin.storage.from(IMPORT_ORIGINALS_BUCKET).remove([filePath]);

    const { data: leftOrders } = await admin
      .from("orders")
      .select("id")
      .eq("owner_username", OWNER)
      .like("recipient_name", `QA-STEP19-${RUN_TAG}-%`);
    const { data: leftImports } = await admin.from("imports").select("id").eq("file_name", UPLOAD_NAME);
    const leftObject = filePath
      ? (await admin.storage.from(IMPORT_ORIGINALS_BUCKET).download(filePath)).data !== null
      : false;
    console.log(
      `\n[cleanup] 잔여 주문 ${(leftOrders ?? []).length} / 이력 ${(leftImports ?? []).length} / 스토리지 오브젝트 ${leftObject ? "남음" : "없음"}`
    );
    await browser.close();
  }

  console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
