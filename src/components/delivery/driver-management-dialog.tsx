"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>배송기사 관리</DialogTitle>
          <DialogDescription>배송 기사와 로그인 계정을 관리합니다. 건당 배송비는 정산관리에 사용됩니다.</DialogDescription>
        </DialogHeader>
        <DriverManagementCard
          drivers={drivers}
          isAdmin={isAdmin}
          accountUsernames={accountUsernames}
          knownRegions={knownRegions}
        />
      </DialogContent>
    </Dialog>
  );
}
