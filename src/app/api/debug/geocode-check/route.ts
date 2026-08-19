import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { geocodeAddress } from "@/lib/services/geocoding.service";

/**
 * TEMPORARY — P10-7-14 Production Geocoding read-only 검증용. admin 세션
 * 필수, DB를 전혀 건드리지 않고(읽기/쓰기 모두 없음) 고정된 테스트 주소를
 * Kakao API로 조회해 boolean/상태값만 반환한다. 주소 원문·API 키·전체 응답은
 * 절대 반환/로그하지 않는다. 검증 완료 즉시 이 파일을 삭제한다.
 */
const TEST_ADDRESS = "서울특별시 강남구 테헤란로 152";

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await geocodeAddress(TEST_ADDRESS);

  return NextResponse.json({
    hasApiKey: !!process.env.KAKAO_REST_API_KEY,
    geocodeStatus: result.geocode_status,
    hasLatitude: result.latitude !== null,
    hasLongitude: result.longitude !== null,
    sido: result.sido,
  });
}
