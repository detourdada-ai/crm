import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/current-session";
import { importsRepository } from "@/lib/repositories/imports.repository";
import { readImportOriginal, importOriginalContentType } from "@/lib/services/import-file-storage.service";

/**
 * STEP19(CPO 지시, 2026-09-08) — 사장님이 올린 엑셀 원본 다운로드. **Admin 전용.**
 *
 * 목적은 운영/테스트 지원이다: 실사용 사장님이 실제로 올린 파일 그대로 재현하기 위한 것.
 * 원본에는 고객 개인정보가 들어 있으므로 사장님 본인에게도 열어주지 않는다(CPO 결정) —
 * 일반 계정은 자기 것이든 남의 것이든 이 경로로 접근할 수 없다.
 *
 * storage 경로도 서명 URL도 브라우저로 내보내지 않는다. 서버가 service-role로 바이트를
 * 읽어 그대로 흘려준다.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  // 권한이 없다는 사실 자체가 "그 import가 존재한다"를 알려주지 않도록, 조회보다 먼저 막는다.
  if (session.role !== "admin") {
    return NextResponse.json({ error: "관리자만 원본 파일을 내려받을 수 있습니다." }, { status: 403 });
  }

  const { id } = await ctx.params;
  const record = await importsRepository.findById(id);
  if (!record) {
    return NextResponse.json({ error: "업로드 기록을 찾을 수 없습니다." }, { status: 404 });
  }
  if (!record.file_path) {
    return NextResponse.json(
      { error: "이 업로드는 원본 파일이 보관되지 않았습니다(원본 보관 기능 이전에 등록된 건)." },
      { status: 404 }
    );
  }

  const bytes = await readImportOriginal(record.file_path);
  if (!bytes) {
    return NextResponse.json({ error: "원본 파일을 읽을 수 없습니다." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": importOriginalContentType(record.file_name),
      "Content-Disposition": `attachment; filename="import-original"; filename*=UTF-8''${encodeURIComponent(record.file_name)}`,
      // 개인정보 원본이므로 어떤 캐시에도 남기지 않는다.
      "Cache-Control": "no-store",
    },
  });
}
