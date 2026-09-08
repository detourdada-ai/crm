import { NextResponse, type NextRequest } from "next/server";
import { runImportRetentionCleanup } from "@/lib/services/import-retention.service";

/**
 * STEP19 후속 정책(CPO 확정, 2026-09-08) — 30일이 지난 엑셀 원본/이력 정리(일 1회).
 *
 * 기존 `beta-expiration` 크론에 섞지 않고 별도 라우트로 둔다. 그쪽은 "메일을 한 번
 * 보낸다"는 알림 잡이고 이쪽은 "데이터를 지운다"는 파기 잡이라, 한쪽 실패가 다른 쪽을
 * 막으면 안 된다(파기 실패로 메일이 안 나가거나, 메일 실패로 파기가 안 되는 상황).
 *
 * 인증 방식은 beta-expiration과 동일 — Vercel Cron이 붙여 보내는
 * `Authorization: Bearer $CRON_SECRET`만 통과시킨다.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runImportRetentionCleanup();
  return NextResponse.json(result);
}
