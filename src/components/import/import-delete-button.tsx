"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { deleteImportAction } from "@/actions/import";

export function ImportDeleteButton({ importId, fileName }: { importId: string; fileName: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteImportAction(importId);
      if (!result.ok) {
        toast.error(result.error ?? "삭제 중 오류가 발생했습니다.");
        return;
      }
      toast.success("업로드 기록과 관련 주문을 삭제했습니다.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      isPending={isPending}
      onConfirm={handleDelete}
      title="업로드 삭제"
      target={`"${fileName}" 업로드`}
      description="이 업로드로 등록된 주문을 모두 삭제합니다. 이 업로드로 새로 생성되었고 다른 주문이 없는 고객도 함께 삭제됩니다."
      trigger={
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
          <Trash2 className="size-4" />
        </Button>
      }
    />
  );
}
