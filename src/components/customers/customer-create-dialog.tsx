"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createCustomerAction } from "@/actions/customers";
import { LegacyAddressInput } from "@/components/common/legacy-address-input";

/**
 * Phase 2 P1: 주문 없이 고객만 먼저 등록하는 화면 진입점 ("+ 고객 등록").
 * 중복 판단은 createCustomerAction이 엑셀/수동주문과 동일한 로직으로 처리한다.
 */
export function CustomerCreateDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createCustomerAction({ ok: false, error: null }, formData);
      if (!result.ok) {
        toast.error(result.error ?? "고객 등록 중 오류가 발생했습니다.");
        return;
      }
      toast.success(result.isNew ? "고객을 등록했습니다." : "이미 등록된 고객이라 기존 고객으로 연결했습니다.");
      formRef.current?.reset();
      setOpen(false);
      if (result.customerId) router.push(`/customers/${result.customerId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Plus className="size-4" />
          고객 등록
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>고객 등록</DialogTitle>
          <DialogDescription>
            주문 없이 고객 정보만 먼저 등록합니다. 이름/전화번호/주소가 기존 고객과 정확히 일치하면 새로 만들지
            않고 기존 고객으로 연결됩니다.
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={handleSubmit} className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="createName">고객 이름</Label>
            <Input id="createName" name="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="createPhone">전화번호</Label>
            <Input id="createPhone" name="phone" placeholder="010-0000-0000" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="createAddress">주소</Label>
            <LegacyAddressInput id="createAddress" name="address" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="createMemo">메모</Label>
            <Textarea id="createMemo" name="memo" rows={2} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "등록하는 중..." : "등록"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
