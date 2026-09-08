/**
 * STEP19 후속 정책(CPO 확정, 2026-09-08) — 엑셀 이력 7일 노출 / 원본 30일 보관 검증.
 *
 * CPO 검증 항목을 그대로 따른다.
 *   - 7일 이전 이력이 사장님 화면에 노출되지 않음 / 7일 이내는 정상 노출
 *   - 30일 이전 import + 원본 → cleanup 대상 / 30일 이내 → 유지
 *   - cleanup 후 Storage orphan = 0
 *   - 이력 삭제 시 원본 즉시 삭제(기존 동작) 유지
 *   - Admin 원본 다운로드 회귀 없음 / tenant 간 접근 차단 유지
 *
 * **경계 조건이 이 검증의 핵심이다.** "30일이 지나면 지운다"는 29일짜리를 지우지
 * 않는다는 뜻이기도 하다 — 한쪽만 확인하면 전부 지우는 버그를 못 잡는다.
 *
 * 시간 경과는 `created_at`을 과거로 심어 만든다(대기 불가). user3/user6 QA 테넌트에만
 * 쓰고 finally에서 행·오브젝트를 전부 정리한다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step19b-import-retention.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, makeRunTag } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";
import { IMPORT_ORIGINALS_BUCKET } from "../../src/lib/services/import-file-storage.service";
import { runImportRetentionCleanup } from "../../src/lib/services/import-retention.service";
import { daysAgoIso } from "../../src/lib/constants/import-retention";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
const OTHER_TENANT = QA_SECONDARY_OWNER;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
assertAllowedQaOwner(OWNER);
assertAllowedQaOwner(OTHER_TENANT);

const RUN_TAG = makeRunTag("step19b");
const admin = getSupabaseAdmin();

let pass = 0;
let fail = 0;
function record(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

interface Fixture {
  id: string;
  label: string;
  fileName: string;
  filePath: string | null;
  ageDays: number;
}

const created: Fixture[] = [];

/** 지정한 나이(일)의 이력 + (원하면) 원본 오브젝트를 만든다. */
async function seedImport(label: string, ageDays: number, withFile: boolean, tenantId: string): Promise<Fixture> {
  const id = randomUUID();
  const fileName = `QA-STEP19B-${RUN_TAG}-${label}.xlsx`;
  let filePath: string | null = null;

  if (withFile) {
    filePath = `${tenantId}/${randomUUID()}.xlsx`;
    const { error } = await admin.storage
      .from(IMPORT_ORIGINALS_BUCKET)
      .upload(filePath, new TextEncoder().encode(`step19b-${label}`), { contentType: "text/plain" });
    if (error) throw new Error(`프로브 업로드 실패(${label}): ${error.message}`);
  }

  const { error } = await admin.from("imports").insert({
    id,
    file_name: fileName,
    status: "completed",
    total_rows: 1,
    owner_username: OWNER,
    tenant_id: tenantId,
    file_path: filePath,
    created_at: daysAgoIso(ageDays),
  });
  if (error) throw new Error(`이력 생성 실패(${label}): ${error.message}`);

  const fixture = { id, label, fileName, filePath, ageDays };
  created.push(fixture);
  return fixture;
}

/**
 * /import 화면의 텍스트를 **렌더가 끝난 뒤에** 읽는다.
 * domcontentloaded 직후 innerText를 읽으면 이력 카드가 아직 붙기 전이라
 * "이력이 안 보인다"는 오탐이 난다(실제로 이 스크립트에서 T1/T3가 그렇게 깨졌다).
 * 이력 카드 제목이 보일 때까지 기다린 뒤 읽는다.
 */
async function readImportPageText(page: import("playwright").Page): Promise<string> {
  await page.goto(`${BASE_URL}/import`, { waitUntil: "domcontentloaded" });
  await dismissAnnouncementPopupIfPresent(page);
  await page.getByText("엑셀 Import 이력").first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissAnnouncementPopupIfPresent(page);
  return page.locator("body").innerText();
}

async function rowExists(id: string): Promise<boolean> {
  const { data } = await admin.from("imports").select("id").eq("id", id).maybeSingle();
  return !!data;
}

async function objectExists(path: string | null): Promise<boolean> {
  if (!path) return false;
  const { data } = await admin.storage.from(IMPORT_ORIGINALS_BUCKET).download(path);
  return data !== null;
}

async function main() {
  if (!ADMIN_USERNAME) throw new Error("ADMIN_USERNAME 환경변수가 필요합니다.");
  await assertTenantIsQaSafe(OWNER);

  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant!.id as string;

  console.log(`\n===== STEP19-B 보관정책 검증 (${BASE_URL}) =====\n`);

  const browser = await chromium.launch();
  try {
    // ── 화면 노출 경계: 3일 / 10일 ──────────────────────────────────
    const fresh = await seedImport("3일된건", 3, true, tenantId);
    const stale = await seedImport("10일된건", 10, true, tenantId);

    const ownerCtx = await browser.newContext();
    await ownerCtx.addCookies([
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
    const ownerPage = await ownerCtx.newPage();
    await registerAnnouncementPopupHandler(ownerPage);
    const ownerText = await readImportPageText(ownerPage);

    record("T1. 7일 이내(3일) 이력은 사장님 화면에 보인다", ownerText.includes(fresh.fileName));
    record("T2. 7일 이전(10일) 이력은 사장님 화면에 보이지 않는다", !ownerText.includes(stale.fileName));
    record(
      "T3. 사장님 화면에 7일 안내 문구가 있다",
      ownerText.includes("최근 7일만 확인할 수 있습니다"),
      ownerText.includes("최근 7일만 확인할 수 있습니다") ? "" : "문구 없음"
    );

    // ── Admin은 기간 제한 없이 본다(30일 보관분 재현용) ────────────
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
    const adminPage = await adminCtx.newPage();
    await registerAnnouncementPopupHandler(adminPage);
    const adminText = await readImportPageText(adminPage);
    record("T4. Admin 화면에는 7일 이전(10일) 이력도 보인다", adminText.includes(stale.fileName));

    // ── Admin 원본 다운로드 회귀 + 테넌트 격리 ──────────────────────
    const dlUrl = `${BASE_URL}/api/import/${stale.id}/original`;
    const adminDl = await adminCtx.request.get(dlUrl);
    const adminBody = adminDl.status() === 200 ? (await adminDl.body()).toString() : "";
    record("T5. 회귀 — Admin은 여전히 원본을 받는다", adminDl.status() === 200 && adminBody === "step19b-10일된건", `HTTP ${adminDl.status()}`);

    const ownerDl = await ownerCtx.request.get(dlUrl);
    record("T6. 회귀 — 사장님 본인은 여전히 차단된다", ownerDl.status() === 403, `HTTP ${ownerDl.status()}`);

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
    const otherDl = await otherCtx.request.get(dlUrl);
    record("T7. 회귀 — 타 테넌트는 여전히 차단된다", otherDl.status() === 403, `HTTP ${otherDl.status()}`);
    await otherCtx.close();
    await ownerCtx.close();

    // ── 보관기간 경계: 29일(유지) / 31일(삭제) / 31일+원본없음 ──────
    const keep29 = await seedImport("29일된건", 29, true, tenantId);
    const drop31 = await seedImport("31일된건", 31, true, tenantId);
    const drop31NoFile = await seedImport("31일원본없음", 31, false, tenantId);

    // 운영 테넌트를 건드리지 않도록 QA 테넌트로 범위를 좁혀 돌린다.
    const result = await runImportRetentionCleanup(new Date(), OWNER);
    console.log(`\n  [cleanup] ${JSON.stringify(result)}\n`);

    record("T8. 30일 이내(29일) 이력은 유지된다", await rowExists(keep29.id));
    record("T9. 30일 이내(29일) 원본 파일도 유지된다", await objectExists(keep29.filePath));
    record("T10. 30일 초과(31일) 이력은 삭제된다", !(await rowExists(drop31.id)));
    record("T11. 30일 초과(31일) 원본 파일도 삭제된다", !(await objectExists(drop31.filePath)));
    record("T12. file_path=null인 과거 이력도 행만 정리된다", !(await rowExists(drop31NoFile.id)));
    record("T13. cleanup에 실패로 남겨둔 건이 없다(deferred=0)", result.deferred === 0, `deferred=${result.deferred}`);

    // ── cleanup 후 orphan 0 ────────────────────────────────────────
    const { data: refRows } = await admin.from("imports").select("file_path").not("file_path", "is", null);
    const referenced = new Set((refRows ?? []).map((r) => r.file_path as string));
    const roots = await admin.storage.from(IMPORT_ORIGINALS_BUCKET).list("", { limit: 1000 });
    const allObjects: string[] = [];
    for (const r of roots.data ?? []) {
      const sub = await admin.storage.from(IMPORT_ORIGINALS_BUCKET).list(r.name, { limit: 1000 });
      for (const o of sub.data ?? []) allObjects.push(`${r.name}/${o.name}`);
    }
    const orphans = allObjects.filter((p) => !referenced.has(p));
    record("T14. cleanup 후 Storage orphan = 0", orphans.length === 0, `오브젝트 ${allObjects.length} / orphan ${orphans.length}`);

    // ── 수동 이력 삭제 시 원본 즉시 삭제(기존 동작 유지) ────────────
    const manual = await seedImport("수동삭제대상", 1, true, tenantId);
    const { deleteImport } = await import("../../src/lib/services/import.service");
    await deleteImport(manual.id, OWNER);
    record("T15. 회귀 — 수동 이력 삭제 시 이력이 지워진다", !(await rowExists(manual.id)));
    record("T16. 회귀 — 수동 이력 삭제 시 원본도 즉시 지워진다", !(await objectExists(manual.filePath)));

    await adminCtx.close();
  } finally {
    for (const f of created) {
      await admin.from("imports").delete().eq("id", f.id);
      if (f.filePath) await admin.storage.from(IMPORT_ORIGINALS_BUCKET).remove([f.filePath]);
    }
    const { data: leftRows } = await admin
      .from("imports")
      .select("id")
      .like("file_name", `QA-STEP19B-${RUN_TAG}-%`);
    const roots = await admin.storage.from(IMPORT_ORIGINALS_BUCKET).list("", { limit: 1000 });
    let leftObjects = 0;
    for (const r of roots.data ?? []) {
      const sub = await admin.storage.from(IMPORT_ORIGINALS_BUCKET).list(r.name, { limit: 1000 });
      leftObjects += (sub.data ?? []).length;
    }
    console.log(`\n[cleanup] 잔여 이력 ${(leftRows ?? []).length} / 버킷 전체 오브젝트 ${leftObjects}`);
    await browser.close();
  }

  console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
