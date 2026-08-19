"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { LoadingOverlay } from "@/components/common/loading-overlay";
import { deleteAllImportsAction } from "@/actions/import";

/**
 * P5: "엑셀 이력 전체 삭제해도 최근 20건이 남는다"는 CEO 제보를 조사한 결과
 * 이 기능 자체가 코드에 없었다(행 단위 삭제만 존재) — 신규 구현. 내 계정
 * 소속 이력만 지운다(deleteAllImportsAction 참고).
 * P7 1/2번: 확인 UX를 공통 ConfirmDialog로 통일하고, 실제 삭제가 진행되는
 * 동안 전체화면 LoadingOverlay를 띄운다 — 대량 cascade 삭제(주문/품목/고객)라
 * 몇 초 걸릴 수 있고, 그 사이 버튼만 disabled로는 "멈춘 건가?" 불안이 남는다.
 */
export function ImportDeleteAllButton({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteAllImportsAction();
      if (!result.ok) {
        toast.error(result.error ?? "전체 삭제 중 오류가 발생했습니다.");
        return;
      }
      toast.success("엑셀 업로드 이력을 모두 삭제했습니다.");
      setOpen(false);
      // P7 4/6번: revalidatePath만으로도 대부분 반영되지만, 삭제 직후 같은
      // 화면(주문관리 등)으로 바로 이동했을 때 이전 렌더가 남아있던 사례가
      // 있어 router.refresh()로 현재 라우트 트리를 명시적으로 다시 가져온다.
      router.refresh();
    });
  }

  return (
    <>
      {isPending ? <LoadingOverlay message="엑셀 업로드 이력을 삭제하고 있습니다..." hint="잠시만 기다려 주세요." /> : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        isPending={isPending}
        onConfirm={handleDelete}
        title="엑셀 업로드 이력을 모두 삭제하시겠습니까?"
        target="엑셀 Import 이력 전체"
        description="내 계정의 모든 업로드 이력과 그 이력으로 등록된 주문을 삭제합니다. 각 업로드로 새로 생성되었고 다른 주문이 없는 고객도 함께 삭제됩니다."
        confirmLabel="전체 삭제"
        pendingLabel="삭제하는 중..."
        trigger={
          <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" disabled={disabled}>
            <Trash2 className="size-4" />
            전체 삭제
          </Button>
        }
      />
    </>
  );
}
