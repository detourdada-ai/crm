"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DriverManagementCard } from "@/components/settings/driver-management-card";
import type { DriverWithAccount } from "@/actions/drivers";

type KnownRegion = { sido: string; sigungu: string | null; eupmyeondong: string | null };

/** Sprint 14-I UI/UX 리뉴얼 2차 (UI-4): 기사 관리를 Sidebar 메뉴가 아니라 배송 화면의 secondary action으로 — 설정 화면의 동일 컴포넌트를 그대로 재사용해 로직은 완전히 동일하게 유지한다. */
export function DriverManagementDialog({
  drivers,
  isAdmin,
  accountUsernames,
  knownRegions,
}: {
  drivers: DriverWithAccount[];
  isAdmin: boolean;
  accountUsernames: string[];
  knownRegions: KnownRegion[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Users className="size-4" />
          배송기사 관리
        </Button>
      </DialogTrigger>
      {/* F-P4UX: 기존엔 DialogContent 전체가 통째로 스크롤돼 헤더까지 같이
          밀려나고 리스트가 잘려 보였다 — Header/Footer는 고정하고 목록
          영역만 내부 스크롤되도록 flex 레이아웃으로 바꾼다. */}
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>배송기사 관리</DialogTitle>
          <DialogDescription>배송 기사와 로그인 계정을 관리합니다. 건당 배송비는 정산관리에 사용됩니다.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DriverManagementCard
            drivers={drivers}
            isAdmin={isAdmin}
            accountUsernames={accountUsernames}
            knownRegions={knownRegions}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
