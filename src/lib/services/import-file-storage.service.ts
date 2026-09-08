import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * STEP19(CPO 지시, 2026-09-08) — 사장님이 올린 엑셀 **원본**을 보관하고 Admin만 다시 받는다.
 *
 * 원본에는 고객 이름·주소·연락처가 들어 있으므로 버킷은 private이고, 이 모듈은
 * service-role 클라이언트로만 접근한다(`server-only`). 브라우저에 오브젝트 경로나
 * storage URL을 내려보내지 않는다 — 다운로드는 서버 라우트가 바이트를 대신 읽어 흘려준다.
 */
export const IMPORT_ORIGINALS_BUCKET = "import-originals";

/** 업로드 파일명에서 확장자만 추린다. 파일명 자체는 imports.file_name에 이미 있으므로 경로에 넣지 않는다. */
function extensionOf(fileName: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim());
  return m ? `.${m[1].toLowerCase()}` : "";
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv",
};

export function importOriginalContentType(fileName: string): string {
  return CONTENT_TYPE_BY_EXT[extensionOf(fileName)] ?? "application/octet-stream";
}

/**
 * 원본을 보관하고 오브젝트 경로를 돌려준다. 실패하면 null.
 *
 * **실패해도 예외를 던지지 않는다.** 이건 운영/테스트 지원 기능이지 주문 등록의
 * 일부가 아니다 — 원본 보관이 안 됐다고 사장님의 주문 접수를 실패시키면 안 된다
 * (`saveColumnMapping`을 best-effort로 두는 것과 같은 이유). 대신 서버 로그에는 남긴다.
 */
export async function storeImportOriginal(
  tenantId: string,
  fileName: string,
  bytes: ArrayBuffer
): Promise<string | null> {
  const objectPath = `${tenantId}/${randomUUID()}${extensionOf(fileName)}`;
  try {
    const { error } = await getSupabaseAdmin()
      .storage.from(IMPORT_ORIGINALS_BUCKET)
      .upload(objectPath, bytes, { contentType: importOriginalContentType(fileName), upsert: false });
    if (error) {
      console.error("[import-original] 원본 보관 실패(등록은 계속 진행):", error.message);
      return null;
    }
    return objectPath;
  } catch (e) {
    console.error("[import-original] 원본 보관 중 예외(등록은 계속 진행):", e);
    return null;
  }
}

/** Admin 다운로드용. 오브젝트 바이트를 서버에서 직접 읽는다(서명 URL을 브라우저로 내보내지 않는다). */
export async function readImportOriginal(objectPath: string): Promise<ArrayBuffer | null> {
  const { data, error } = await getSupabaseAdmin().storage.from(IMPORT_ORIGINALS_BUCKET).download(objectPath);
  if (error || !data) return null;
  return await data.arrayBuffer();
}
