"use client";

import { useState } from "react";
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

/**
 * P7 1번: 삭제/초기화류 액션의 확인 UX를 한 곳으로 모은다 — "삭제 대상"을
 * 항상 명시하는 동일한 틀을 쓰고, requireTextConfirm이 주어지면(전체 데이터
 * 초기화처럼 위험도가 높은 작업) 정확한 문구를 입력해야만 버튼이 활성화된다.
 */
export function ConfirmDialog({
  trigger,
  title,
  target,
  description,
  requireTextConfirm,
  confirmLabel = "삭제",
  pendingLabel = "삭제하는 중...",
  isPending,
  onConfirm,
  open,
  onOpenChange,
}: {
  trigger: React.ReactNode;
  title: string;
  target: string;
  description?: string;
  /** 정확히 이 문구를 입력해야 확인 버튼이 활성화된다 — 위험도가 높은 작업에만 지정. */
  requireTextConfirm?: string;
  confirmLabel?: string;
  pendingLabel?: string;
  isPending: boolean;
  onConfirm: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const locked = requireTextConfirm !== undefined && confirmText !== requireTextConfirm;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setConfirmText("");
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            {title}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1.5 text-sm text-muted-foreground">
              <p>
                삭제 대상: <strong className="text-text-strong">{target}</strong>
              </p>
              {description ? <p>{description}</p> : null}
              <p className="font-medium text-destructive">삭제된 데이터는 복구할 수 없습니다.</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        {requireTextConfirm ? (
          <div className="space-y-2">
            <Label htmlFor="confirm-dialog-text">계속하려면 &quot;{requireTextConfirm}&quot;을(를) 입력하세요</Label>
            <Input
              id="confirm-dialog-text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={requireTextConfirm}
              autoComplete="off"
            />
          </div>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              취소
            </Button>
          </DialogClose>
          <Button variant="destructive" disabled={isPending || locked} onClick={onConfirm}>
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
