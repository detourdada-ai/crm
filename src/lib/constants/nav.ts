import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ShoppingCart,
  Truck,
  Wallet,
  Users,
  BarChart3,
  Settings,
  HelpCircle,
  Megaphone,
  MessageSquare,
} from "lucide-react";

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

// Sprint 14-I UI/UX 리뉴얼 2차 (Phase UI-1): "무엇을 관리할까"가 아니라
// "오늘 무엇을 처리할까"를 기준으로 메뉴를 다시 묶는다 — 홈/업무/분석/관리
// 4개 섹션 + 도움말. "엑셀 업로드"/"동일인 검토"/"기사 관리"는 여전히 1급
// 메뉴가 아니다 — 라우트(/import, /duplicates)는 유지하되 각 업무 화면의
// 다이얼로그/버튼 안에서 처리한다.
export const NAV_ENTRIES: NavEntry[] = [
  { section: "홈", items: [{ href: "/dashboard", label: "대시보드", icon: LayoutDashboard }] },
  {
    section: "업무",
    items: [
      { href: "/orders", label: "주문관리", icon: ShoppingCart },
      { href: "/delivery", label: "배송관리", icon: Truck },
      { href: "/customers", label: "고객관리", icon: Users },
      { href: "/settlements", label: "정산관리", icon: Wallet },
    ],
  },
  { section: "분석", items: [{ href: "/stats", label: "통계", icon: BarChart3 }] },
  {
    // STEP15-B: 메시지 관리는 아직 준비 중이라 admin에게만 보인다. adminOnly
    // 플래그와 필터링은 nav-links.tsx에 이미 있었고(사용처가 0개였다), 여기서
    // 처음 쓴다 — 일반 사장님 네비게이션은 전혀 바뀌지 않는다.
    section: "관리",
    items: [
      { href: "/settings", label: "설정", icon: Settings },
      { href: "/messages", label: "메시지 관리", icon: MessageSquare, adminOnly: true },
    ],
  },
];

export const NAV_HELP_ENTRY: NavSection = {
  section: "도움말",
  items: [
    { href: "/announcements", label: "공지사항", icon: Megaphone },
    { href: "/contact", label: "문의하기", icon: HelpCircle },
  ],
};

/** Flat form of NAV_ENTRIES (+ 설정), for places that need a plain list (e.g. active-path matching, mobile search) rather than the sectioned rendering. */
export const NAV_ITEMS: NavItem[] = NAV_ENTRIES.flatMap((entry) => (isNavSection(entry) ? entry.items : [entry]));

// 기사(driver) 계정은 본인 배송 목록과 자기가 받을 정산 금액만 보면 된다 — proxy.ts가
// /driver 밖으로 나가는 것 자체를 막지만, 사이드바에도 이 두 메뉴만 노출한다.
export const DRIVER_NAV_ITEMS: NavItem[] = [
  { href: "/driver", label: "내 배송", icon: Truck },
  { href: "/driver/settlements", label: "정산관리", icon: Wallet },
];
