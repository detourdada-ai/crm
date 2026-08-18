import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/current-session";
import { geocodeAddress } from "@/lib/services/geocoding.service";

/**
 * Phase 2: Vercel Production에 KAKAO_REST_API_KEY가 실제로 설정/인식되는지,
 * 그리고 실제 카카오 호출이 왜 실패하는지 1회성으로 진단하기 위한 임시
 * 엔드포인트 — admin 세션 필요, 키 값이나 전체 API 응답 바디는 절대 반환하지
 * 않고 boolean/상태/HTTP status만 반환한다. 확인 후 제거 예정.
 */
export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (session.role !== "admin") {
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  const hasApiKey = !!process.env.KAKAO_REST_API_KEY;
  const geo = await geocodeAddress("서울특별시 강남구 테헤란로 152");

  let rawStatus: number | null = null;
  let rawErrorType: string | null = null;
  if (hasApiKey) {
    try {
      const res = await fetch(
        "https://dapi.kakao.com/v2/local/search/address.json?query=" + encodeURIComponent("서울특별시 강남구 테헤란로 152"),
        { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` } }
      );
      rawStatus = res.status;
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { errorType?: string } | null;
        rawErrorType = body?.errorType ?? null;
      }
    } catch {
      rawStatus = -1;
    }
  }

  return NextResponse.json({
    hasApiKey,
    geocodeStatus: geo.geocode_status,
    hasCoordinates: geo.latitude !== null && geo.longitude !== null,
    rawStatus,
    rawErrorType,
  });
}
