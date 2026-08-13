import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, ShoppingCart, Truck, Wallet, Users, BarChart3, Settings } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export interface NavSection {
  section: string;
  items: NavItem[];
}

export type NavEntry = NavItem | NavSection;

export function isNavSection(entry: NavEntry): entry is NavSection {
  return "section" in entry;
}

// Sprint 14-I UI/UX 리뉴얼: "엑셀 업로드"/"동일인 검토"는 더 이상 1급
// 메뉴가 아니다 — 라우트(/import, /duplicates)는 그대로 유지하되, 사용자의
// 작업 맥락(주문 등록 다이얼로그의 "Excel로 등록", 고객관리의 "동일인 확인"
// 버튼) 안으로 옮긴다. 실제 운영 흐름(주문 확인 → 배송일 기준 분류 →
// 기사 배정/완료 → 정산 확인)은 "운영" 섹션 순서에 그대로 반영되어 있다.
export const NAV_ENTRIES: NavEntry[] = [
  { href: "/dashboard", label: "대시보드", icon: LayoutDashboard },
  {
    section: "운영",
    items: [
      { href: "/orders", label: "주문", icon: ShoppingCart },
      { href: "/delivery", label: "배송", icon: Truck },
      { href: "/settlements", label: "정산", icon: Wallet },
    ],
  },
  { href: "/customers", label: "고객", icon: Users },
  { href: "/stats", label: "통계", icon: BarChart3 },
];

export const NAV_SETTINGS_ITEM: NavItem = { href: "/settings", label: "설정", icon: Settings };

/** Flat form of NAV_ENTRIES (+ 설정), for places that need a plain list (e.g. active-path matching, mobile search) rather than the sectioned rendering. */
export const NAV_ITEMS: NavItem[] = NAV_ENTRIES.flatMap((entry) => (isNavSection(entry) ? entry.items : [entry])).concat(
  NAV_SETTINGS_ITEM
);

// 기사(driver) 계정은 본인 배송 목록과 자기가 받을 정산 금액만 보면 된다 — proxy.ts가
// /driver 밖으로 나가는 것 자체를 막지만, 사이드바에도 이 두 메뉴만 노출한다.
export const DRIVER_NAV_ITEMS: NavItem[] = [
  { href: "/driver", label: "내 배송", icon: Truck },
  { href: "/driver/settlements", label: "정산관리", icon: Wallet },
];
