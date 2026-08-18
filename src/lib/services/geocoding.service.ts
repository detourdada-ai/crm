import "server-only";

/**
 * Phase 1: 서버 전용 카카오 로컬 API(주소 검색) 클라이언트. 이 함수는 절대
 * throw하지 않는다 — 지오코딩 실패가 주문/고객 저장을 막으면 안 된다는
 * 작업지시서 원칙(7번)에 따라, API 키 미설정/네트워크 오류/응답 없음 등
 * 모든 실패 경로가 동일하게 geocode_status="failed" 결과로 수렴한다.
 *
 * 지역 코드는 카카오가 반환하는 법정동코드(b_code, 10자리)에서 파생한다
 * (앞 2자리=시도코드, 앞 5자리=시군구코드, 10자리 전체=읍면동코드) — 지번
 * 주소(`address`) 응답에만 b_code가 포함되므로 이를 우선 사용한다.
 */

export interface GeocodeFields {
  latitude: number | null;
  longitude: number | null;
  sido: string | null;
  sigungu: string | null;
  eupmyeondong: string | null;
  sido_code: string | null;
  sigungu_code: string | null;
  eupmyeondong_code: string | null;
  geocode_status: "success" | "failed";
}

const FAILED_RESULT: GeocodeFields = {
  latitude: null,
  longitude: null,
  sido: null,
  sigungu: null,
  eupmyeondong: null,
  sido_code: null,
  sigungu_code: null,
  eupmyeondong_code: null,
  geocode_status: "failed",
};

interface KakaoRegion {
  region_1depth_name: string;
  region_2depth_name: string;
  region_3depth_name: string;
  b_code?: string;
}

interface KakaoAddressDocument {
  x: string; // longitude
  y: string; // latitude
  address: KakaoRegion | null;
  road_address: KakaoRegion | null;
}

interface KakaoAddressSearchResponse {
  documents: KakaoAddressDocument[];
}

const KAKAO_ADDRESS_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/address.json";
const REQUEST_TIMEOUT_MS = 5000;

export async function geocodeAddress(roadAddress: string): Promise<GeocodeFields> {
  const apiKey = process.env.KAKAO_REST_API_KEY;
  const query = roadAddress.trim();
  if (!apiKey || !query) return { ...FAILED_RESULT };

  try {
    const url = `${KAKAO_ADDRESS_SEARCH_URL}?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { ...FAILED_RESULT };

    const data = (await res.json()) as KakaoAddressSearchResponse;
    const doc = data.documents?.[0];
    if (!doc) return { ...FAILED_RESULT };

    const latitude = Number(doc.y);
    const longitude = Number(doc.x);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { ...FAILED_RESULT };

    // 지번(address)에만 법정동코드(b_code)가 실리므로 지역명/코드 모두
    // 우선 여기서 취하고, 없으면 도로명(road_address) 지역명으로 대체한다.
    const region = doc.address ?? doc.road_address;
    const bCode = doc.address?.b_code || null;

    return {
      latitude,
      longitude,
      sido: region?.region_1depth_name ?? null,
      sigungu: region?.region_2depth_name || null,
      eupmyeondong: region?.region_3depth_name || null,
      sido_code: bCode ? bCode.slice(0, 2) : null,
      sigungu_code: bCode ? bCode.slice(0, 5) : null,
      eupmyeondong_code: bCode,
      geocode_status: "success",
    };
  } catch {
    return { ...FAILED_RESULT };
  }
}
