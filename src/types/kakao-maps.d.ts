/**
 * P15-B: Kakao Maps JS SDK의 최소 타입 선언 — 공식 @types 패키지를 새로
 * 추가하지 않고(작업지시서: npm 패키지 추가 금지), 이 프로젝트가 실제로
 * 쓰는 API 표면(Map/LatLng/LatLngBounds/CustomOverlay/event.addListener)만
 * 최소한으로 선언한다.
 */
declare namespace kakao.maps {
  class LatLng {
    constructor(lat: number, lng: number);
    getLat(): number;
    getLng(): number;
  }

  class LatLngBounds {
    constructor();
    extend(latlng: LatLng): void;
    isEmpty(): boolean;
  }

  interface MapOptions {
    center: LatLng;
    level?: number;
  }

  class Map {
    constructor(container: HTMLElement, options: MapOptions);
    setBounds(bounds: LatLngBounds): void;
    setCenter(latlng: LatLng): void;
    setLevel(level: number): void;
    relayout(): void;
  }

  interface CustomOverlayOptions {
    position: LatLng;
    content: HTMLElement | string;
    yAnchor?: number;
    xAnchor?: number;
    zIndex?: number;
  }

  class CustomOverlay {
    constructor(options: CustomOverlayOptions);
    setMap(map: Map | null): void;
  }

  namespace event {
    function addListener(target: unknown, type: string, handler: () => void): void;
  }

  function load(callback: () => void): void;
}

interface Window {
  kakao?: typeof kakao;
}
