import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ShoppingCart,
  Truck,
  Wallet,
  Users,
  Upload,
  UserSearch,
  BarChart3,
  Settings,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

// 주문관리 → 배송관리 → 정산관리 → 고객관리 순서로, 실제 운영 흐름(주문 확인 →
// 배송일 기준 분류 → 기사 배정/완료 → 정산 확인)을 그대로 반영한다.
// 정산관리는 기사 비용/지급 정보라 관리자만 접근 가능 — 담당자 계정에는 노출하지 않는다.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/orders", label: "주문관리", icon: ShoppingCart },
  { href: "/delivery", label: "배송관리", icon: Truck },
  { href: "/settlements", label: "정산관리", icon: Wallet, adminOnly: true },
  { href: "/customers", label: "고객관리", icon: Users },
  { href: "/import", label: "엑셀 업로드", icon: Upload },
  { href: "/duplicates", label: "동일인 검토", icon: UserSearch },
  { href: "/stats", label: "통계", icon: BarChart3 },
  { href: "/settings", label: "설정", icon: Settings },
];

// 기사(driver) 계정은 본인 배송 목록 외에는 아무것도 볼 필요가 없다 — proxy.ts가
// /driver 밖으로 나가는 것 자체를 막지만, 사이드바에도 다른 메뉴를 아예 노출하지 않는다.
export const DRIVER_NAV_ITEMS: NavItem[] = [{ href: "/driver", label: "내 배송", icon: Truck }];
