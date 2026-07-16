"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateCustomerAction, type UpdateCustomerActionState } from "@/actions/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Customer } from "@/types/domain";

const initialState: UpdateCustomerActionState = { ok: false, error: null };

export function CustomerEditForm({ customer }: { customer: Customer }) {
  const boundAction = updateCustomerAction.bind(null, customer.id);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  useEffect(() => {
    if (state.ok) toast.success("저장되었습니다.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="name">이름</Label>
        <Input id="name" name="name" defaultValue={customer.name} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">전화번호</Label>
        <Input id="phone" name="phone" defaultValue={customer.phone ?? ""} />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="address">주소</Label>
        <Input id="address" name="address" defaultValue={customer.address ?? ""} />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="memo">메모</Label>
        <Textarea id="memo" name="memo" defaultValue={customer.memo ?? ""} rows={3} />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="tags">태그 (쉼표로 구분)</Label>
        <Input id="tags" name="tags" defaultValue={customer.tags.join(", ")} placeholder="VIP, 알러지주의" />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "저장 중..." : "저장"}
        </Button>
      </div>
    </form>
  );
}
