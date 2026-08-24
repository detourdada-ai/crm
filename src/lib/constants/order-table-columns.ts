/**
 * STD-8/9: 주문관리 리스트의 선택적 컬럼 목록. 주문번호/구매자/상품명/배송일/
 * 상태/금액은 "3초 안에 무슨 주문이 어느 단계인지 파악"하는 핵심 정보라
 * order-table.tsx의 원래 설계 의도대로 항상 노출하고, 여기 없다 — 이 목록은
 * 그 외 "필요할 때만 보면 되는" 컬럼만 다룬다.
 */
export interface OrderTableColumnDef {
  id: string;
  label: string;
}

export const ORDER_TABLE_TOGGLEABLE_COLUMNS: OrderTableColumnDef[] = [
  { id: "orderDate", label: "주문일" },
  { id: "quantity", label: "수량" },
  { id: "phone", label: "연락처" },
  { id: "address", label: "배송지주소" },
  { id: "memo", label: "배송메세지" },
  { id: "bag", label: "가방번호 / 회수" },
  { id: "driver", label: "담당기사" },
  { id: "customerLink", label: "고객" },
  { id: "owner", label: "담당자" },
];

export const ORDER_TABLE_TOGGLEABLE_COLUMN_IDS = ORDER_TABLE_TOGGLEABLE_COLUMNS.map((c) => c.id);
