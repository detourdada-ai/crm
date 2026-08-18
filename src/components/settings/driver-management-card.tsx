"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, X, MapPinPlus } from "lucide-react";
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
import { addDriverRegionAction, deleteDriverRegionAction } from "@/actions/driver-regions";
import { LegacyAddressInput } from "@/components/common/legacy-address-input";
import { SIDO_LIST } from "@/lib/constants/region";

type KnownRegion = { sido: string; sigungu: string | null; eupmyeondong: string | null };

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
            <LegacyAddressInput id="address" name="address" />
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

/**
 * Phase 1: 시/도는 고정 목록에서 고르고, 시/군/구·읍/면/동은 자유 입력 +
 * 이미 지오코딩된 이 계정 고객 주소에서 뽑은 자동완성(datalist)으로
 * 지원한다 — 전국 지역 마스터 테이블 없이 "계층형 선택"에 가까운 UX를
 * 제공하기 위한 절충(작업지시서 8/10번).
 */
function AddDriverRegionDialog({ driverId, knownRegions }: { driverId: string; knownRegions: KnownRegion[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [sido, setSido] = useState("");
  const [sigungu, setSigungu] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const sigunguOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of knownRegions) if (r.sido === sido && r.sigungu) set.add(r.sigungu);
    return Array.from(set).sort();
  }, [knownRegions, sido]);

  const eupmyeondongOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of knownRegions) if (r.sido === sido && r.sigungu === sigungu && r.eupmyeondong) set.add(r.eupmyeondong);
    return Array.from(set).sort();
  }, [knownRegions, sido, sigungu]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await addDriverRegionAction(driverId, { ok: false, error: null }, formData);
      if (!result.ok) {
        toast.error(result.error ?? "담당지역 추가 중 오류가 발생했습니다.");
        return;
      }
      toast.success("담당지역을 추가했습니다.");
      formRef.current?.reset();
      setSido("");
      setSigungu("");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <MapPinPlus className="size-4" />
          지역 추가
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>담당지역 추가</DialogTitle>
          <DialogDescription>
            시/군/구·읍/면/동을 비워두면 그 상위 단계 전체를 담당하는 것으로 등록됩니다(예: 시/군/구를 비우면 시/도
            전체를 담당).
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`sido-${driverId}`}>시/도</Label>
            <Select
              name="sido"
              required
              value={sido}
              onValueChange={(v) => {
                setSido(v);
                setSigungu("");
              }}
            >
              <SelectTrigger id={`sido-${driverId}`} className="w-full">
                <SelectValue placeholder="시/도 선택" />
              </SelectTrigger>
              <SelectContent>
                {SIDO_LIST.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`sigungu-${driverId}`}>시/군/구 (선택)</Label>
            <Input
              id={`sigungu-${driverId}`}
              name="sigungu"
              list={`sigungu-options-${driverId}`}
              value={sigungu}
              onChange={(e) => setSigungu(e.target.value)}
              placeholder="비워두면 시/도 전체 담당"
              autoComplete="off"
            />
            <datalist id={`sigungu-options-${driverId}`}>
              {sigunguOptions.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`eupmyeondong-${driverId}`}>읍/면/동 (선택)</Label>
            <Input
              id={`eupmyeondong-${driverId}`}
              name="eupmyeondong"
              list={`eupmyeondong-options-${driverId}`}
              placeholder="비워두면 시/군/구 전체 담당"
              autoComplete="off"
            />
            <datalist id={`eupmyeondong-options-${driverId}`}>
              {eupmyeondongOptions.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending || !sido}>
              {isPending ? "추가하는 중..." : "추가"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DriverRegionBadge({ region }: { region: DriverWithAccount["regions"][number] }) {
  const [isPending, startTransition] = useTransition();
  const label = [region.sido, region.sigungu, region.eupmyeondong].filter(Boolean).join(" ");

  function handleRemove() {
    startTransition(async () => {
      const result = await deleteDriverRegionAction(region.id);
      if (!result.ok) toast.error(result.error ?? "담당지역 삭제 중 오류가 발생했습니다.");
    });
  }

  return (
    <Badge variant="secondary" className="gap-1 pr-1">
      {label}
      <button
        type="button"
        onClick={handleRemove}
        disabled={isPending}
        className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
        aria-label={`${label} 담당지역 삭제`}
      >
        <X className="size-3" />
      </button>
    </Badge>
  );
}

function DriverRegionsCell({ driver, knownRegions }: { driver: DriverWithAccount; knownRegions: KnownRegion[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {driver.regions.map((region) => (
        <DriverRegionBadge key={region.id} region={region} />
      ))}
      <AddDriverRegionDialog driverId={driver.id} knownRegions={knownRegions} />
    </div>
  );
}

export function DriverManagementCard({
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
              <TableHead>담당지역</TableHead>
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
                  <DriverRegionsCell driver={driver} knownRegions={knownRegions} />
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
