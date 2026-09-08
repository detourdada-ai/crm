/**
 * STEP19(CPO 지시, 2026-09-08) — 엑셀 원본 보관 버킷의 **접근 격리** 검증.
 *
 * 원본 엑셀에는 고객 이름·주소·연락처가 그대로 들어 있다. 그래서 "Admin만 받을 수 있다"를
 * 앱 코드(라우트 권한 체크)에만 기대면 안 된다 — **버킷 자체가 잠겨 있어야** 한다.
 * 이 스크립트는 그 마지막 방어선을 확인한다.
 *
 *   1. 버킷이 존재하고 public = false 인가
 *   2. service_role(서버)로는 업로드/다운로드가 되는가
 *   3. **anon 키(브라우저에 노출되는 키)로는 읽을 수 없는가**  ← 핵심
 *   4. anon 키로 목록 조회도 막히는가
 *
 * 테넌트 데이터에 손대지 않는다. 프로브 오브젝트만 만들고 finally에서 반드시 지운다.
 *
 * 실행: npx tsx -r dotenv/config scripts/qa/step19-import-original-storage-isolation.ts \
 *         dotenv_config_path=.env.local
 */
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { IMPORT_ORIGINALS_BUCKET } from "../../src/lib/services/import-file-storage.service";

const admin = getSupabaseAdmin();
const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

const PROBE_PATH = `__qa-step19-probe/${Date.now()}.txt`;
const PROBE_BODY = "step19-isolation-probe";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log(`\n===== STEP19 원본 버킷 격리 검증 (${IMPORT_ORIGINALS_BUCKET}) =====\n`);

  // 1. 버킷 존재 + private
  const buckets = await admin.storage.listBuckets();
  const bucket = buckets.data?.find((b) => b.name === IMPORT_ORIGINALS_BUCKET);
  check("버킷이 존재한다", !!bucket, bucket ? "" : "버킷 없음 — 마이그레이션 0061 미적용");
  if (!bucket) return;
  check("버킷이 private이다 (public = false)", bucket.public === false, `public=${bucket.public}`);

  try {
    // 2. service_role 업로드/다운로드
    const up = await admin.storage
      .from(IMPORT_ORIGINALS_BUCKET)
      .upload(PROBE_PATH, new TextEncoder().encode(PROBE_BODY), { contentType: "text/plain" });
    check("service_role로 업로드된다", !up.error, up.error?.message ?? "");

    const down = await admin.storage.from(IMPORT_ORIGINALS_BUCKET).download(PROBE_PATH);
    const downText = down.data ? await down.data.text() : "";
    check("service_role로 다운로드되고 내용이 같다", downText === PROBE_BODY, down.error?.message ?? "");

    // 3. anon 키로 읽기 — 반드시 실패해야 한다
    const anonDown = await anon.storage.from(IMPORT_ORIGINALS_BUCKET).download(PROBE_PATH);
    const anonText = anonDown.data ? await anonDown.data.text() : null;
    check(
      "anon 키로는 다운로드가 차단된다",
      anonText !== PROBE_BODY,
      anonText === PROBE_BODY ? "!!! 원본이 anon 키로 읽힌다 — 개인정보 노출" : (anonDown.error?.message ?? "차단됨")
    );

    // 4. anon 키로 목록 조회도 막혀야 한다
    const anonList = await anon.storage.from(IMPORT_ORIGINALS_BUCKET).list("");
    const leaked = (anonList.data ?? []).length;
    check("anon 키로는 목록이 보이지 않는다", leaked === 0, leaked > 0 ? `${leaked}건 노출` : "0건");

    // 5. public URL을 직접 때려도 막혀야 한다(버킷이 private이므로)
    const publicUrl = admin.storage.from(IMPORT_ORIGINALS_BUCKET).getPublicUrl(PROBE_PATH).data.publicUrl;
    const res = await fetch(publicUrl);
    const body = res.ok ? await res.text() : "";
    check("public URL 직접 호출이 차단된다", body !== PROBE_BODY, `HTTP ${res.status}`);
  } finally {
    await admin.storage.from(IMPORT_ORIGINALS_BUCKET).remove([PROBE_PATH]);
    const left = await admin.storage.from(IMPORT_ORIGINALS_BUCKET).list("__qa-step19-probe");
    console.log(`\n[cleanup] 프로브 잔여: ${(left.data ?? []).length}건`);
  }

  console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
