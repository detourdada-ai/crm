/**
 * STD-5/6/7: 주문관리/배송관리가 공유하는 "현재 필터링된 목록 기준" 상품별
 * 수량 집계. 전역 랭킹(top_products RPC, /stats 전용)과는 별개 — 여긴 항상
 * 호출한 화면의 현재 필터 결과(order_items 배열)를 그대로 넘겨받아 그
 * 범위 안에서만 합산한다.
 *
 * STEP12-10(R06/R08): "세트" / "[세트]봄날반찬 맛있는 건강반찬"처럼 같은
 * 실제 상품이 다른 문자열로 들어와도 R05의 별칭 매핑으로 order_items.product_id가
 * 채워져 있으면 그 product_id 기준으로 하나로 합친다. product_id가 없는
 * (별칭이 아직 없거나 과거 주문) 행은 기존처럼 product_name 문자열 기준으로
 * 집계한다 — 소급 적용하지 않는다는 R05 원칙과 동일.
 */
export interface ProductSummaryEntry {
  /** 필터 select의 value로 쓰는 키 — product_id가 있으면 그 값, 없으면 productName. */
  groupKey: string;
  /** 화면에 보여줄 이름 — product_id로 묶였으면 표준 상품명, 아니면 원본 product_name. */
  productName: string;
  totalQuantity: number;
  /** 이 상품이 포함된 주문(또는 배송건) 수 — 상품 라인 수가 아니라 distinct 주문 수. */
  orderCount: number;
}

export function aggregateProductSummary(
  items: { product_name: string; product_id?: string | null; quantity: number; order_id: string; shipment_id?: string | null }[],
  groupBy: "order_id" | "shipment_id" = "order_id",
  /** product_id → 표준 상품명. 넘기지 않으면 product_id로 묶여도 처음 만난 행의 product_name을 그대로 표시한다. */
  standardProductNameById?: Map<string, string>
): ProductSummaryEntry[] {
  const byGroup = new Map<string, { productName: string; totalQuantity: number; groupIds: Set<string> }>();
  for (const item of items) {
    const key = item.product_id ?? item.product_name;
    const groupId = (groupBy === "shipment_id" ? item.shipment_id : item.order_id) ?? item.order_id;
    const displayName = item.product_id ? (standardProductNameById?.get(item.product_id) ?? item.product_name) : item.product_name;
    const entry = byGroup.get(key) ?? { productName: displayName, totalQuantity: 0, groupIds: new Set<string>() };
    entry.totalQuantity += item.quantity;
    entry.groupIds.add(groupId);
    byGroup.set(key, entry);
  }
  return Array.from(byGroup.entries())
    .map(([groupKey, v]) => ({ groupKey, productName: v.productName, totalQuantity: v.totalQuantity, orderCount: v.groupIds.size }))
    .sort((a, b) => b.totalQuantity - a.totalQuantity);
}
