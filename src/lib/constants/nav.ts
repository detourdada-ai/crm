import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, ShoppingCart, Users, Upload, UserSearch, BarChart3, Settings } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/orders", label: "주문관리", icon: ShoppingCart },
  { href: "/customers", label: "고객관리", icon: Users },
  { href: "/import", label: "엑셀 업로드", icon: Upload },
  { href: "/duplicates", label: "동일인 검토", icon: UserSearch },
  { href: "/stats", label: "통계", icon: BarChart3 },
  { href: "/settings", label: "설정", icon: Settings },
];
