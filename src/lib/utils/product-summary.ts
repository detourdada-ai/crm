/**
 * STD-5/6/7: 주문관리/배송관리가 공유하는 "현재 필터링된 목록 기준" 상품별
 * 수량 집계. 전역 랭킹(top_products RPC, /stats 전용)과는 별개 — 여긴 항상
 * 호출한 화면의 현재 필터 결과(order_items 배열)를 그대로 넘겨받아 그
 * 범위 안에서만 합산한다.
 */
export interface ProductSummaryEntry {
  productName: string;
  totalQuantity: number;
  /** 이 상품이 포함된 주문(또는 배송건) 수 — 상품 라인 수가 아니라 distinct 주문 수. */
  orderCount: number;
}

export function aggregateProductSummary(
  items: { product_name: string; quantity: number; order_id: string; shipment_id?: string | null }[],
  groupBy: "order_id" | "shipment_id" = "order_id"
): ProductSummaryEntry[] {
  const byProduct = new Map<string, { totalQuantity: number; groupIds: Set<string> }>();
  for (const item of items) {
    const groupId = (groupBy === "shipment_id" ? item.shipment_id : item.order_id) ?? item.order_id;
    const entry = byProduct.get(item.product_name) ?? { totalQuantity: 0, groupIds: new Set<string>() };
    entry.totalQuantity += item.quantity;
    entry.groupIds.add(groupId);
    byProduct.set(item.product_name, entry);
  }
  return Array.from(byProduct.entries())
    .map(([productName, v]) => ({ productName, totalQuantity: v.totalQuantity, orderCount: v.groupIds.size }))
    .sort((a, b) => b.totalQuantity - a.totalQuantity);
}
