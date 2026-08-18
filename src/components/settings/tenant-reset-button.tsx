"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { resetTenantTestDataAction } from "@/actions/admin";

/**
 * P5-3: Admin 전용 "테스트 데이터 초기화" — 계정/로그인정보/사업장 기본정보/
 * 플랜·구독정보는 그대로 두고, 고객/주문/상품/기사/배송그룹/엑셀이력 등
 * 실제 업무 데이터만 지운다(tenant-reset.service.ts 참고). 회사명을 정확히
 * 입력해야 버튼이 활성화되는 이중 확인 안전장치.
 */
export function TenantResetButton({ username, tenantName }: { username: string; tenantName: string }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleReset() {
    startTransition(async () => {
      const result = await resetTenantTestDataAction(username, confirmText);
      if (!result.ok) {
        toast.error(result.error ?? "초기화 중 오류가 발생했습니다.");
        return;
      }
      const r = result.result;
      toast.success(
        r
          ? `초기화 완료 — 고객 ${r.deletedCustomers} · 주문 ${r.deletedOrders} · 상품 ${r.deletedProducts} · 기사 ${r.deletedDrivers} · 배송그룹 ${r.deletedDeliveryGroups} · 엑셀이력 ${r.deletedImports}건 삭제`
          : "초기화를 완료했습니다."
      );
      setOpen(false);
      setConfirmText("");
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmText("");
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
          테스트 데이터 초기화
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            &quot;{tenantName}&quot; 테스트 데이터를 초기화하시겠습니까?
          </DialogTitle>
          <DialogDescription>
            고객/주문/상품/기사/담당지역/배송그룹/엑셀 Import 이력/동일인 후보를 모두 삭제합니다. 계정 로그인 정보,
            사업장 기본정보, 플랜·구독 정보는 유지됩니다. <strong>삭제된 데이터는 복구할 수 없습니다.</strong>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`confirm-${username}`}>계속하려면 회사명 &quot;{tenantName}&quot;을(를) 입력하세요</Label>
          <Input
            id={`confirm-${username}`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={tenantName}
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              취소
            </Button>
          </DialogClose>
          <Button variant="destructive" disabled={isPending || confirmText !== tenantName} onClick={handleReset}>
            {isPending ? "초기화하는 중..." : "초기화"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
