"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createDriverAction, deleteDriverAction, updateDriverStatusAction } from "@/actions/drivers";
import type { DriverWithAccount } from "@/actions/drivers";
import { AddressSearchInput } from "@/components/common/address-search-input";

function CreateDriverDialog({ isAdmin, accountUsernames }: { isAdmin: boolean; accountUsernames: string[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createDriverAction({ ok: false, error: null }, formData);
      if (!result.ok) {
        toast.error(result.error ?? "기사 등록 중 오류가 발생했습니다.");
        return;
      }
      toast.success("기사를 등록했습니다.");
      formRef.current?.reset();
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" />
          기사 등록
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>기사 등록</DialogTitle>
          <DialogDescription>배송 기사 정보와 로그인 계정을 함께 등록합니다.</DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          {isAdmin ? (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="ownerUsername">담당 계정</Label>
              <Select name="ownerUsername" required>
                <SelectTrigger id="ownerUsername" className="w-full">
                  <SelectValue placeholder="이 기사가 속할 계정을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {accountUsernames.map((username) => (
                    <SelectItem key={username} value={username}>
                      {username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="name">이름</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">연락처</Label>
            <Input id="phone" name="phone" placeholder="010-0000-0000" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="address">주소</Label>
            <AddressSearchInput id="address" name="address" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vehicleNumber">차량번호</Label>
            <Input id="vehicleNumber" name="vehicleNumber" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ratePerDelivery">건당 배송비</Label>
            <Input id="ratePerDelivery" name="ratePerDelivery" type="number" min={0} defaultValue={0} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="username">로그인 아이디</Label>
            <Input id="username" name="username" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">초기 비밀번호</Label>
            <Input id="password" name="password" type="password" required minLength={4} />
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "등록하는 중..." : "등록"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DriverStatusToggle({ driverId, status }: { driverId: string; status: "active" | "inactive" }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await updateDriverStatusAction(driverId, status === "active" ? "inactive" : "active");
      if (!result.ok) toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
    });
  }

  return (
    <Button variant="outline" size="sm" disabled={isPending} onClick={handleClick}>
      {status === "active" ? "비활성화" : "활성화"}
    </Button>
  );
}

function DriverDeleteButton({ driverId }: { driverId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteDriverAction(driverId);
      if (!result.ok) {
        toast.error(result.error ?? "삭제 중 오류가 발생했습니다.");
        return;
      }
      toast.success("기사를 삭제했습니다.");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive">
          <Trash2 className="size-4" />
          삭제
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>기사를 삭제하시겠습니까?</DialogTitle>
          <DialogDescription>
            배정된 배송 이력이 있는 기사는 삭제할 수 없습니다(비활성화를 사용해주세요). 이력이 없는 기사만 완전히
            삭제됩니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            취소
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
            {isPending ? "삭제하는 중..." : "삭제"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DriverManagementCard({
  drivers,
  isAdmin,
  accountUsernames,
}: {
  drivers: DriverWithAccount[];
  isAdmin: boolean;
  accountUsernames: string[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateDriverDialog isAdmin={isAdmin} accountUsernames={accountUsernames} />
      </div>
      {drivers.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">등록된 배송 기사가 없습니다.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {isAdmin ? <TableHead>담당 계정</TableHead> : null}
              <TableHead>이름</TableHead>
              <TableHead>아이디</TableHead>
              <TableHead>연락처</TableHead>
              <TableHead>차량번호</TableHead>
              <TableHead className="text-right">건당 배송비</TableHead>
              <TableHead>상태</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {drivers.map((driver) => (
              <TableRow key={driver.id}>
                {isAdmin ? (
                  <TableCell>
                    <Badge variant="secondary">{driver.owner_username}</Badge>
                  </TableCell>
                ) : null}
                <TableCell className="font-medium">{driver.name}</TableCell>
                <TableCell className="text-muted-foreground">{driver.username ?? "-"}</TableCell>
                <TableCell>{driver.phone ?? "-"}</TableCell>
                <TableCell>{driver.vehicle_number ?? "-"}</TableCell>
                <TableCell className="text-right">{driver.rate_per_delivery.toLocaleString("ko-KR")}원</TableCell>
                <TableCell>
                  <Badge variant={driver.status === "active" ? "outline" : "secondary"}>
                    {driver.status === "active" ? "활성" : "비활성"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <DriverStatusToggle driverId={driver.id} status={driver.status} />
                    {isAdmin ? <DriverDeleteButton driverId={driver.id} /> : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
