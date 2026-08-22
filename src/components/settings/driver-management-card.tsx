"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, X, MapPinPlus, MapPin, Pencil } from "lucide-react";
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
import {
  checkDriverUsernameAvailableAction,
  createDriverAction,
  deleteDriverAction,
  updateDriverInfoAction,
  updateDriverStatusAction,
} from "@/actions/drivers";
import type { DriverWithAccount } from "@/actions/drivers";
import { addDriverRegionAction, deleteDriverRegionAction } from "@/actions/driver-regions";
import { getDriverLatestLocationAction } from "@/actions/driver-shifts";
import { LegacyAddressInput } from "@/components/common/legacy-address-input";
import { SIDO_LIST } from "@/lib/constants/region";
import { formatPhoneNumber } from "@/lib/utils/phone";

type KnownRegion = { sido: string; sigungu: string | null; eupmyeondong: string | null };
type PendingRegion = { sido: string; sigungu: string | null; eupmyeondong: string | null };

function pendingRegionLabel(r: PendingRegion): string {
  return [r.sido, r.sigungu, r.eupmyeondong].filter(Boolean).join(" ");
}

function CreateDriverDialog({
  isAdmin,
  accountUsernames,
  knownRegions,
}: {
  isAdmin: boolean;
  accountUsernames: string[];
  knownRegions: KnownRegion[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [pendingRegions, setPendingRegions] = useState<PendingRegion[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const [usernameCheck, setUsernameCheck] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [isCheckingUsername, startUsernameCheck] = useTransition();

  function handleUsernameBlur(e: React.FocusEvent<HTMLInputElement>) {
    const value = e.currentTarget.value.trim();
    if (!value) {
      setUsernameCheck("idle");
      return;
    }
    setUsernameCheck("checking");
    startUsernameCheck(async () => {
      const result = await checkDriverUsernameAvailableAction(value);
      setUsernameCheck(result.available ? "available" : "taken");
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createDriverAction({ ok: false, error: null }, formData);
      if (!result.ok || !result.driverId) {
        toast.error(result.error ?? "기사 등록 중 오류가 발생했습니다.");
        return;
      }
      // P6 10번: 등록과 동시에 담당지역을 설정할 수 있게 한다 — 폼 안에서는
      // 로컬 상태로만 모아뒀다가, 기사(및 driver_id)가 실제로 생긴 뒤에
      // 기존 addDriverRegionAction을 그대로 반복 호출한다(새 API 없음).
      for (const region of pendingRegions) {
        const regionForm = new FormData();
        regionForm.set("sido", region.sido);
        if (region.sigungu) regionForm.set("sigungu", region.sigungu);
        if (region.eupmyeondong) regionForm.set("eupmyeondong", region.eupmyeondong);
        const regionResult = await addDriverRegionAction(result.driverId, { ok: false, error: null }, regionForm);
        if (!regionResult.ok) {
          toast.error(`담당지역(${pendingRegionLabel(region)}) 추가 실패: ${regionResult.error ?? ""}`);
        }
      }
      toast.success("기사를 등록했습니다.");
      formRef.current?.reset();
      setPendingRegions([]);
      setUsernameCheck("idle");
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setPendingRegions([]);
          setUsernameCheck("idle");
        }
      }}
    >
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
            <Input
              id="username"
              name="username"
              required
              onBlur={handleUsernameBlur}
              onChange={() => setUsernameCheck("idle")}
            />
            {usernameCheck === "checking" || isCheckingUsername ? (
              <p className="text-xs text-muted-foreground">확인하는 중...</p>
            ) : usernameCheck === "available" ? (
              <p className="text-xs text-emerald-600">사용 가능한 아이디입니다</p>
            ) : usernameCheck === "taken" ? (
              <p className="text-xs text-destructive">이미 사용 중인 아이디입니다</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">초기 비밀번호</Label>
            <Input id="password" name="password" type="password" required minLength={4} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>담당지역</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {pendingRegions.map((r, i) => (
                <Badge key={`${pendingRegionLabel(r)}-${i}`} variant="secondary" className="gap-1 pr-1">
                  {pendingRegionLabel(r)}
                  <button
                    type="button"
                    onClick={() => setPendingRegions((prev) => prev.filter((_, idx) => idx !== i))}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                    aria-label={`${pendingRegionLabel(r)} 담당지역 제거`}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
              <PendingRegionAddDialog
                knownRegions={knownRegions}
                onAdd={(region) => setPendingRegions((prev) => [...prev, region])}
              />
            </div>
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

/**
 * P5 1-3/1-4: 기사 정보 수정 — 로그인 아이디는 필드 자체를 두지 않아 변경
 * 불가능하게 한다. 1-4(담당지역 CRUD를 등록/수정 팝업 안에 포함)는 이미 있는
 * DriverRegionsCell(추가 다이얼로그+배지 삭제)을 그대로 이 다이얼로그 안에
 * 재사용해서 새 로직을 만들지 않는다.
 */
function EditDriverDialog({ driver, knownRegions }: { driver: DriverWithAccount; knownRegions: KnownRegion[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateDriverInfoAction(driver.id, { ok: false, error: null }, formData);
      if (!result.ok) {
        toast.error(result.error ?? "기사 정보 수정 중 오류가 발생했습니다.");
        return;
      }
      toast.success("기사 정보를 수정했습니다.");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Pencil className="size-4" />
          수정
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>기사 정보 수정</DialogTitle>
          <DialogDescription>로그인 아이디는 최초 등록 후 변경할 수 없습니다.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`edit-name-${driver.id}`}>이름</Label>
            <Input id={`edit-name-${driver.id}`} name="name" defaultValue={driver.name} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`edit-phone-${driver.id}`}>연락처</Label>
            <Input id={`edit-phone-${driver.id}`} name="phone" defaultValue={formatPhoneNumber(driver.phone) ?? ""} placeholder="010-0000-0000" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`edit-address-${driver.id}`}>주소</Label>
            <LegacyAddressInput id={`edit-address-${driver.id}`} name="address" defaultValue={driver.address ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`edit-vehicle-${driver.id}`}>차량번호</Label>
            <Input id={`edit-vehicle-${driver.id}`} name="vehicleNumber" defaultValue={driver.vehicle_number ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`edit-rate-${driver.id}`}>건당 배송비</Label>
            <Input
              id={`edit-rate-${driver.id}`}
              name="ratePerDelivery"
              type="number"
              min={0}
              defaultValue={driver.rate_per_delivery}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>담당지역</Label>
            <DriverRegionsCell driver={driver} knownRegions={knownRegions} />
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "저장하는 중..." : "저장"}
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

/**
 * P6 10번: 기사 등록 팝업 전용 — driver_id가 아직 없으므로 서버 액션을 바로
 * 호출하지 못하고, 선택한 지역을 로컬 목록에 담아뒀다가 등록이 끝난 뒤
 * CreateDriverDialog가 addDriverRegionAction을 반복 호출한다. 필드 구성/자동완성
 * 로직은 AddDriverRegionDialog와 동일 — 로직을 새로 만들지 않고 저장 시점만 다르다.
 */
function PendingRegionAddDialog({ knownRegions, onAdd }: { knownRegions: KnownRegion[]; onAdd: (region: PendingRegion) => void }) {
  const [open, setOpen] = useState(false);
  const [sido, setSido] = useState("");
  const [sigungu, setSigungu] = useState("");
  const [eupmyeondong, setEupmyeondong] = useState("");

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

  function handleAdd() {
    if (!sido) return;
    onAdd({ sido, sigungu: sigungu || null, eupmyeondong: eupmyeondong || null });
    setSido("");
    setSigungu("");
    setEupmyeondong("");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <MapPinPlus className="size-4" />
          지역 추가
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>담당지역 추가</DialogTitle>
          <DialogDescription>
            시/군/구·읍/면/동을 비워두면 그 상위 단계 전체를 담당하는 것으로 등록됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pending-sido">시/도</Label>
            <Select
              value={sido}
              onValueChange={(v) => {
                setSido(v);
                setSigungu("");
              }}
            >
              <SelectTrigger id="pending-sido" className="w-full">
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
            <Label htmlFor="pending-sigungu">시/군/구 (선택)</Label>
            <Input
              id="pending-sigungu"
              list="pending-sigungu-options"
              value={sigungu}
              onChange={(e) => setSigungu(e.target.value)}
              placeholder="비워두면 시/도 전체 담당"
              autoComplete="off"
            />
            <datalist id="pending-sigungu-options">
              {sigunguOptions.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pending-eupmyeondong">읍/면/동 (선택)</Label>
            <Input
              id="pending-eupmyeondong"
              list="pending-eupmyeondong-options"
              value={eupmyeondong}
              onChange={(e) => setEupmyeondong(e.target.value)}
              placeholder="비워두면 시/군/구 전체 담당"
              autoComplete="off"
            />
            <datalist id="pending-eupmyeondong-options">
              {eupmyeondongOptions.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>
          <DialogFooter>
            <Button type="button" onClick={handleAdd} disabled={!sido}>
              추가
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DriverRegionBadge({ region }: { region: DriverWithAccount["regions"][number] }) {
  const [isPending, startTransition] = useTransition();
  const label = [region.sido, region.sigungu, region.eupmyeondong].filter(Boolean).join(" ");

  function handleRemove() {
    // P10-3: 삭제 기능 전수조사에서 이 담당지역 배지만 확인 절차 없이 즉시
    // 삭제되는 유일한 지점으로 확인됨 — 배지 UI 특성상 전체 ConfirmDialog
    // 모달은 과하므로 가벼운 native confirm으로 최소한의 방지막을 둔다.
    if (!window.confirm(`담당지역 "${label}"을(를) 삭제하시겠습니까?`)) return;
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

/**
 * S2-C: "기사님 지금 어디예요?" CS 대응용 참고 정보 — 배송 상태와 무관하게
 * 기사가 앱에서 마지막으로 남긴 위치 하나만 보여준다(이력 아님). 클릭 시에만
 * 조회한다(목록 진입 때마다 전체 기사 위치를 미리 불러오지 않는다).
 */
function DriverLocationButton({ driverId }: { driverId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const shift = await getDriverLatestLocationAction(driverId);
      if (!shift?.last_latitude || !shift?.last_longitude) {
        toast.info("아직 기록된 위치가 없습니다. 기사가 앱에서 운행시작을 누르면 위치가 표시됩니다.");
        return;
      }
      const minutesAgo = shift.last_location_at
        ? Math.max(0, Math.round((Date.now() - new Date(shift.last_location_at).getTime()) / 60000))
        : null;
      toast.success(minutesAgo != null ? `${minutesAgo}분 전 위치를 지도에서 엽니다.` : "위치를 지도에서 엽니다.");
      window.open(`https://map.kakao.com/link/map/기사 위치,${shift.last_latitude},${shift.last_longitude}`, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <Button type="button" variant="ghost" size="icon-sm" disabled={isPending} onClick={handleClick} aria-label="최근 위치 확인">
      <MapPin className="size-4" />
    </Button>
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
        <CreateDriverDialog isAdmin={isAdmin} accountUsernames={accountUsernames} knownRegions={knownRegions} />
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
                <TableCell>{formatPhoneNumber(driver.phone) ?? "-"}</TableCell>
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
                    <DriverLocationButton driverId={driver.id} />
                    <EditDriverDialog driver={driver} knownRegions={knownRegions} />
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
