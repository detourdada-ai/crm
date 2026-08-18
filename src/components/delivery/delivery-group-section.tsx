"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Users, MapPin, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DeliveryBoard } from "@/components/delivery/delivery-board";
import { assignGroupDriverAction } from "@/actions/delivery-groups";
import type { DeliveryGroupWithCandidates, UngroupedOrder } from "@/actions/delivery-groups";
import type { OrderItemSummary } from "@/actions/orders";
import type { Order, Driver } from "@/types/domain";

const UNASSIGNED_VALUE = "__unassigned__";

type GroupViewFilter = "all" | "grouped" | "ungrouped" | "unassigned" | string;

/** group_no(1,2,3...)를 CPO 목업과 동일한 "그룹 A/B/C..." 표기로 변환한다. */
function groupLabel(groupNo: number): string {
  if (groupNo >= 1 && groupNo <= 26) return `그룹 ${String.fromCharCode(64 + groupNo)}`;
  return `그룹 ${groupNo}`;
}

function representativeRegionLabel(group: DeliveryGroupWithCandidates): string {
  return [group.representative_sido, group.representative_sigungu, group.representative_eupmyeondong].filter(Boolean).join(" ") || "지역 미상";
}

/**
 * Phase 4: 배송관리에 추가되는 "배송 그룹" 섹션 — 좌표 50m 이내로 묶인 주문
 * 그룹을 카드로 보여주고, 그룹 필터를 고르면 아래 기존 DeliveryBoard 테이블을
 * 그 그룹의 주문만으로 필터링해서 재사용한다(새 테이블을 만들지 않고 기존
 * 컴포넌트를 그대로 재사용 — "기존 화면을 크게 깨지 않는다" 원칙).
 */
export function DeliveryGroupSection({
  groups,
  ungrouped,
  orders,
  drivers,
  itemSummaries,
  bagManagementEnabled,
}: {
  groups: DeliveryGroupWithCandidates[];
  ungrouped: UngroupedOrder[];
  orders: Order[];
  drivers: Driver[];
  itemSummaries: Record<string, OrderItemSummary>;
  bagManagementEnabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [assigningGroupId, setAssigningGroupId] = useState<string | null>(null);
  const [viewFilter, setViewFilter] = useState<GroupViewFilter>("all");

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const driverNames = useMemo(() => new Map(drivers.map((d) => [d.id, d.name])), [drivers]);

  function handleAssignDriver(groupId: string, driverId: string) {
    setAssigningGroupId(groupId);
    startTransition(async () => {
      const result = await assignGroupDriverAction(groupId, driverId === UNASSIGNED_VALUE ? null : driverId);
      if (result.ok) {
        toast.success(driverId === UNASSIGNED_VALUE ? "그룹 배정을 해제했습니다." : "그룹에 기사를 배정했습니다.");
        router.refresh();
      } else {
        toast.error(result.error ?? "그룹 기사 배정 중 오류가 발생했습니다.");
      }
      setAssigningGroupId(null);
    });
  }

  const filteredOrders = useMemo(() => {
    switch (viewFilter) {
      case "all":
        return orders;
      case "grouped":
        return orders.filter((o) => o.delivery_group_id !== null);
      case "ungrouped":
        return orders.filter((o) => o.delivery_group_id === null);
      case "unassigned":
        return orders.filter((o) => o.delivery_group_id !== null && groupById.get(o.delivery_group_id)?.driver_id === null);
      default:
        return orders.filter((o) => o.delivery_group_id === viewFilter);
    }
  }, [orders, viewFilter, groupById]);

  const filterChips: { value: GroupViewFilter; label: string }[] = [
    { value: "all", label: "전체" },
    { value: "grouped", label: "그룹 있음" },
    { value: "ungrouped", label: "미그룹" },
    { value: "unassigned", label: "기사 미배정" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text-strong">배송 그룹</h2>
        <p className="text-sm text-muted-foreground">
          좌표가 50m 이내로 가까운 주문들을 자동으로 묶습니다. 최적 경로가 아니라 &ldquo;가까운 주문 묶음&rdquo;입니다.
        </p>
      </div>

      {groups.length === 0 && ungrouped.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          아직 배송 그룹이 없습니다. 위의 &ldquo;배송 그룹 생성&rdquo; 버튼을 눌러 좌표가 확인된 주문을 그룹화해보세요.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">
              전체 {orders.length}건 / {groups.length}그룹
              {ungrouped.length > 0 ? ` · 미그룹 ${ungrouped.length}건` : ""}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {filterChips.map((chip) => (
              <button
                key={chip.value}
                type="button"
                onClick={() => setViewFilter(chip.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  viewFilter === chip.value ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {chip.label}
              </button>
            ))}
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => setViewFilter(group.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  viewFilter === group.id ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {groupLabel(group.group_no)}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => {
              const driverName = group.driver_id ? driverNames.get(group.driver_id) : undefined;
              const memberOrders = orders.filter((o) => o.delivery_group_id === group.id);
              const allCompleted = memberOrders.length > 0 && memberOrders.every((o) => o.delivery_status === "완료");
              return (
                <Card key={group.id} className={cn("space-y-3 p-4", viewFilter === group.id && "border-primary ring-1 ring-primary")}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-text-strong">{groupLabel(group.group_no)}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" />
                        {representativeRegionLabel(group)}
                      </p>
                    </div>
                    <Badge variant={allCompleted ? "success" : group.driver_id ? "info" : "warning"}>
                      {allCompleted ? "완료" : group.driver_id ? "배정완료" : "미배정"}
                    </Badge>
                  </div>

                  <p className="flex items-center gap-1 text-sm">
                    <Users className="size-3.5 text-muted-foreground" />
                    <span className="font-semibold text-text-strong">{group.order_count}건</span>
                    <span className="text-muted-foreground">· {driverName ?? "미배정"}</span>
                  </p>

                  <div className="space-y-1.5">
                    <Select
                      value={group.driver_id ?? UNASSIGNED_VALUE}
                      onValueChange={(v) => handleAssignDriver(group.id, v)}
                      disabled={isPending && assigningGroupId === group.id}
                    >
                      <SelectTrigger className="h-8 w-full text-xs">
                        <SelectValue placeholder="기사 배정" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED_VALUE}>미배정</SelectItem>
                        {drivers.map((d) => {
                          const isCandidate = group.candidateDrivers.some((c) => c.driver_id === d.id);
                          return (
                            <SelectItem key={d.id} value={d.id}>
                              {isCandidate ? "● " : "○ "}
                              {d.name}
                              {isCandidate ? ` — ${representativeRegionLabel(group)} 담당` : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant={viewFilter === group.id ? "default" : "outline"}
                    className="w-full"
                    onClick={() => setViewFilter(viewFilter === group.id ? "all" : group.id)}
                  >
                    {viewFilter === group.id ? "전체 보기로 돌아가기" : "그룹 펼치기"}
                  </Button>
                </Card>
              );
            })}
          </div>

          {ungrouped.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-dashed p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-text-strong">
                <AlertTriangle className="size-3.5 text-warning" />
                미그룹 주문 {ungrouped.length}건
              </p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {ungrouped.map(({ order, reason }) => (
                  <li key={order.id} className="flex items-center justify-between gap-2">
                    <span>{order.recipient_name}</span>
                    <span className="text-xs">{reason === "no_coordinates" ? "좌표 없음" : "주변 배송주문 없음"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      <div className="border-t pt-4">
        <DeliveryBoard orders={filteredOrders} drivers={drivers} itemSummaries={itemSummaries} bagManagementEnabled={bagManagementEnabled} />
      </div>
    </div>
  );
}
