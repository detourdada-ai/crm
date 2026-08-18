/**
 * Phase 4: 좌표 기반 배송 그룹화 — 순수 함수 모듈(DB/Next.js 의존 없음).
 *
 * CPO 승인 사항(P4-1 조사 후 논의): 현재 Beta 규모(하루 주문 수 적음, 단순
 * 50m 기준)에서는 PostGIS SQL 클러스터링 대신 애플리케이션 레이어에서
 * Haversine 실거리 계산 + Union-Find(서로소집합) connected-component로
 * 구현한다. 나중에 주문량이 커지면 이 모듈만 PostGIS 기반 구현으로 교체하면
 * 되도록 순수 함수로 분리해 두었다 — 호출부(actions/repository)는
 * clusterPointsByDistance()의 입출력 형태에만 의존한다.
 *
 * 핵심 요구사항: "50m 격자"가 아니라 "주문 간 실거리가 50m 이내면 연결"이다.
 * 단순 pairwise 매칭이 아니라 연쇄 연결(A-B 40m, B-C 40m → A-C 80m이어도
 * 하나의 그룹)을 Union-Find로 처리한다.
 */

export interface SpatialPoint {
  id: string;
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6371000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 두 좌표 간 실제 지표 거리(미터) — Haversine 공식. 위경도 단순 숫자 차이가 아니다. */
export function haversineDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

class UnionFind {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootA] = rootB;
  }
}

/**
 * 좌표 간 실거리가 epsMeters 이내면 같은 connected-component로 묶는다
 * ("50m마다 격자로 자르는 것"이 아니라 "주문 간 거리가 50m 이내인 주문들을
 * 하나의 후보로 묶는 것" — CPO 작업지시서 원문). 반환값에는 다른 어떤
 * 주문과도 eps 이내로 연결되지 않은 singleton(크기 1) 컴포넌트도 포함된다
 * — 그룹(크기 2 이상)과 미그룹 주문(크기 1)을 구분하는 것은 호출부의 책임이다.
 *
 * O(n²) pairwise 거리 계산 — 하루 배송 주문 규모(수십~수백 건)에서는 충분히
 * 빠르다. 주문량이 커지면 이 함수만 공간 인덱스/PostGIS 기반으로 교체한다.
 */
export function clusterPointsByDistance(points: SpatialPoint[], epsMeters: number): string[][] {
  const n = points.length;
  if (n === 0) return [];
  const uf = new UnionFind(n);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (haversineDistanceMeters(points[i], points[j]) <= epsMeters) {
        uf.union(i, j);
      }
    }
  }

  const componentsByRoot = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    const bucket = componentsByRoot.get(root);
    if (bucket) bucket.push(points[i].id);
    else componentsByRoot.set(root, [points[i].id]);
  }
  return Array.from(componentsByRoot.values());
}

/** 그룹 중심점 — 단순 산술 평균(대량 지도 렌더링용이 아니라 화면 표시/라벨링용이므로 측지선 정밀도는 불필요). */
export function computeCentroid(points: { lat: number; lng: number }[]): { lat: number; lng: number } {
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

/** 그룹의 대표 행정구역 — 구성원 중 다수결(읍면동 > 시군구 > 시도 순으로 시도). */
export function representativeRegion(
  members: { sido: string | null; sigungu: string | null; eupmyeondong: string | null }[]
): { sido: string | null; sigungu: string | null; eupmyeondong: string | null } {
  function majority<T extends string | null>(values: T[]): T | null {
    const counts = new Map<T, number>();
    for (const v of values) {
      if (v === null) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let best: T | null = null;
    let bestCount = 0;
    for (const [v, count] of counts) {
      if (count > bestCount) {
        best = v;
        bestCount = count;
      }
    }
    return best;
  }

  const sido = majority(members.map((m) => m.sido));
  // 읍면동/시군구는 대표 시/도 내의 구성원만 대상으로 다수결(다른 시/도 값이 섞여 표결에 끼는 것을 막는다).
  const withinSido = sido ? members.filter((m) => m.sido === sido) : members;
  const sigungu = majority(withinSido.map((m) => m.sigungu));
  const withinSigungu = sigungu ? withinSido.filter((m) => m.sigungu === sigungu) : withinSido;
  const eupmyeondong = majority(withinSigungu.map((m) => m.eupmyeondong));

  return { sido, sigungu, eupmyeondong };
}
