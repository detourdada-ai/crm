"use client";

/**
 * P15-B: Kakao Maps JS SDK 로더 — AddressSearchInput의 Daum 우편번호
 * 스크립트 로딩 패턴(components/common/address-search-input.tsx)을 그대로
 * 재사용한다. npm 패키지를 추가하지 않고 <script> 태그로 직접 로드한다.
 *
 * NEXT_PUBLIC_KAKAO_JS_KEY가 없으면(아직 발급 전) reject하고, 호출부가
 * 이를 "지도 사용 불가" 상태로 조용히 처리해야 한다 — 배송 목록 등 기존
 * 기능은 지도 없이도 정상 동작해야 한다는 원칙(작업지시서 성능/안정성
 * 원칙) 때문에 여기서 throw하거나 콘솔에 에러를 남기지 않는다.
 */
const KAKAO_MAPS_SCRIPT_ID = "kakao-maps-sdk-script";

let loadPromise: Promise<void> | null = null;

export function loadKakaoMapsScript(): Promise<void> {
  if (typeof window !== "undefined" && window.kakao?.maps) {
    return Promise.resolve();
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const appKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
    if (!appKey) {
      reject(new Error("NEXT_PUBLIC_KAKAO_JS_KEY가 설정되지 않았습니다."));
      return;
    }

    const onReady = () => window.kakao!.maps.load(() => resolve());

    const existing = document.getElementById(KAKAO_MAPS_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (window.kakao?.maps) resolve();
      else existing.addEventListener("load", onReady);
      existing.addEventListener("error", () => reject(new Error("카카오맵 스크립트 로드에 실패했습니다.")));
      return;
    }

    const script = document.createElement("script");
    script.id = KAKAO_MAPS_SCRIPT_ID;
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false`;
    script.onload = onReady;
    script.onerror = () => reject(new Error("카카오맵 스크립트 로드에 실패했습니다."));
    document.head.appendChild(script);
  }).catch((e) => {
    loadPromise = null; // 실패 시 재시도 가능하도록 캐시를 비운다(키가 나중에 채워질 수 있음).
    throw e;
  });

  return loadPromise;
}
