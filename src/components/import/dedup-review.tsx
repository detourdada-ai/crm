"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { DedupAnalysis, DedupGroupResult, DedupOrderSnapshot, DedupProductOrderItem } from "@/types/excel";

function formatDeliveryDate(iso: string | null): string {
  if (!iso) return "배송일 미지정";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "배송일 미지정";
  return `${d.getMonth() + 1}/${d.getDate()} 배송`;
}

function SnapshotLine({ snapshot }: { snapshot: DedupOrderSnapshot }) {
  return (
    <p className="space-y-0.5">
      <span className="block">{formatDeliveryDate(snapshot.deliveryDate)}</span>
      <span className="block">{snapshot.productSummary}</span>
      <span className="block text-muted-foreground/80">{snapshot.address ?? "-"}</span>
    </p>
  );
}

function CandidateCard({
  group,
  approved,
  onToggle,
}: {
  group: DedupGroupResult;
  approved: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`rounded-md border p-3 transition-colors ${approved ? "border-primary bg-primary-soft/30" : "bg-card"}`}>
      <p className="text-sm font-medium text-text-strong">
        {group.upload.recipientName} {group.upload.phone ? `· ${group.upload.phone}` : ""}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">이미 등록된 주문과 비슷한 정보가 있습니다. 기존 주문은 변경되지 않습니다.</p>
      <div className="mt-2 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        <div className="rounded-md bg-muted/50 p-2">
          <p className="mb-1 font-medium text-muted-foreground">기존 주문</p>
          {group.existing ? <SnapshotLine snapshot={group.existing} /> : null}
        </div>
        <div className="rounded-md bg-primary-soft/40 p-2">
          <p className="mb-1 font-medium text-muted-foreground">업로드 주문</p>
          <SnapshotLine snapshot={group.upload} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={approved ? "default" : "outline"} onClick={onToggle} className="gap-1.5">
          {approved ? "✓ 새 주문으로 등록" : "새 주문으로 등록"}
        </Button>
        {!approved ? <span className="text-xs text-muted-foreground">등록하지 않음(기본값)</span> : null}
      </div>
    </div>
  );
}

/**
 * STEP2(누적 스마트스토어 엑셀 중복판정 재설계, 2026-08 CPO 작업지시 §5/§6):
 * 같은 부모 주문(order_number) 안에 이미 등록된 상품주문과 신규 상품주문이
 * 섞인 "혼재 그룹"(Case D) — 신규 상품주문은 사용자 승인 없이도 자동으로
 * 기존 부모 주문에 추가 등록된다(애매한 후보가 아니라 명확한 판정이므로).
 * 여기서는 무엇이 신규로 추가되고 무엇이 이미 등록된 상태로 남는지, 그리고
 * "정보 차이"(배송일/주소가 이번 업로드 값과 다름 — 표시만 하고 아무 것도
 * 바꾸지 않음)가 있는지만 투명하게 보여준다.
 */
function ProductOrderItemRow({ item }: { item: DedupProductOrderItem }) {
  const isNew = item.status === "new";
  return (
    <div className="flex items-start justify-between gap-2 rounded-md bg-card/60 px-2 py-1.5 text-xs">
      <div className="min-w-0">
        <p className="truncate text-text-strong">{item.productSummary}</p>
        <p className="text-muted-foreground">
          {item.productOrderNumber} · {formatDeliveryDate(item.deliveryDate)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={isNew ? "font-medium text-primary" : "text-muted-foreground"}>{isNew ? "신규 추가" : "이미 등록됨"}</span>
        {item.infoDiffers ? <span className="text-warning">정보 차이 있음</span> : null}
      </div>
    </div>
  );
}

function PartialGroupCard({ group }: { group: DedupGroupResult }) {
  const items = group.productOrderItems ?? [];
  const newCount = items.filter((i) => i.status === "new").length;
  return (
    <div className="rounded-md border bg-card p-3">
      <p className="text-sm font-medium text-text-strong">
        {group.upload.recipientName} {group.upload.orderNumber ? `· 주문번호 ${group.upload.orderNumber}` : ""}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        이 주문의 상품 중 {newCount}건이 새로 추가됩니다. 이미 등록된 상품과 배송/기사배정 정보는 그대로 유지됩니다.
      </p>
      <div className="mt-2 space-y-1">
        {items.map((item, i) => (
          <ProductOrderItemRow key={`${item.productOrderNumber}-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}

/**
 * §CPO 작업지시(누적 표준 엑셀 중복방지, 2026-08): Analyze 직후 실제 등록
 * 전에 반드시 거치는 검토 화면 — 신규를 가장 먼저, 중복 후보를 그 다음,
 * 이미 등록된 주문은 접어서 보여준다(§8/§24). 중복 후보의 기본값은
 * "등록하지 않음"이며(§10 안전한 방향 우선), 사용자가 명시적으로 승인한
 * groupKey만 onConfirm으로 전달한다 — 실제 등록 여부는 Confirm 시점에
 * 서버가 다시 계산하므로(§14/§15) 여기서의 승인은 "의사"일 뿐이다.
 */
export function DedupReview({
  analysis,
  onConfirm,
  isSubmitting,
}: {
  analysis: DedupAnalysis;
  onConfirm: (approvedGroupKeys: string[]) => void;
  isSubmitting: boolean;
}) {
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const newGroups = analysis.groups.filter((g) => g.status === "new");
  const candidates = analysis.groups.filter((g) => g.status === "candidate");
  const confirmedDuplicates = analysis.groups.filter((g) => g.status === "confirmed_duplicate");
  const errorGroups = analysis.groups.filter((g) => g.status === "error");
  const partialGroups = analysis.groups.filter((g) => g.status === "partial");

  function toggle(key: string) {
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>엑셀 분석 완료</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          누적된 주문 엑셀을 매일 업로드해도 됩니다. 이미 등록된 주문은 자동으로 중복 처리되지 않습니다.
        </p>
        <p className="text-sm text-muted-foreground">
          총 <span className="font-semibold text-text-strong">{analysis.totalGroups.toLocaleString()}건</span>을 확인했습니다.
        </p>
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">신규 주문</dt>
            <dd className="font-medium text-text-strong">{newGroups.length.toLocaleString()}건</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className={candidates.length > 0 ? "text-warning" : "text-muted-foreground"}>중복 가능성이 있는 주문</dt>
            <dd className={`font-medium ${candidates.length > 0 ? "text-warning" : "text-text-strong"}`}>
              {candidates.length.toLocaleString()}건
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">이미 등록된 주문</dt>
            <dd className="font-medium text-text-strong">{confirmedDuplicates.length.toLocaleString()}건</dd>
          </div>
          {partialGroups.length > 0 ? (
            <div className="flex items-baseline justify-between">
              <dt className="text-muted-foreground">일부만 신규(같은 주문번호 안에 혼재)</dt>
              <dd className="font-medium text-text-strong">{partialGroups.length.toLocaleString()}건</dd>
            </div>
          ) : null}
          {errorGroups.length > 0 ? (
            <div className="flex items-baseline justify-between">
              <dt className="text-destructive">오류</dt>
              <dd className="font-medium text-destructive">{errorGroups.length.toLocaleString()}건</dd>
            </div>
          ) : null}
        </dl>

        {candidates.length > 0 ? (
          <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
            <p className="text-sm font-medium text-text-strong">⚠️ 중복 가능성이 있는 주문 {candidates.length}건</p>
            <div className="space-y-2">
              {candidates.map((g) => (
                <CandidateCard key={g.groupKey} group={g} approved={approved.has(g.groupKey)} onToggle={() => toggle(g.groupKey)} />
              ))}
            </div>
          </div>
        ) : null}

        {partialGroups.length > 0 ? (
          <div className="space-y-2 rounded-md border bg-muted/20 p-3">
            <p className="text-sm font-medium text-text-strong">일부만 신규인 주문 {partialGroups.length}건</p>
            <p className="text-xs text-muted-foreground">
              신규 상품주문은 사용자 확인 없이 기존 주문에 자동으로 추가 등록됩니다(기존 상품/배송/기사배정 정보는 그대로 유지).
            </p>
            <div className="space-y-2">
              {partialGroups.map((g) => (
                <PartialGroupCard key={g.groupKey} group={g} />
              ))}
            </div>
          </div>
        ) : null}

        {confirmedDuplicates.length > 0 ? (
          <details className="rounded-lg border">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm text-muted-foreground">
              이미 등록된 주문 {confirmedDuplicates.length}건
            </summary>
            <div className="space-y-1.5 border-t p-3 text-xs text-muted-foreground">
              {confirmedDuplicates.map((g) => {
                const infoDiffers = g.productOrderItems?.some((i) => i.infoDiffers) ?? false;
                return (
                  <p key={g.groupKey}>
                    {g.upload.recipientName} · {g.upload.productSummary}
                    {g.upload.orderNumber ? ` (주문번호 ${g.upload.orderNumber})` : ""}
                    {infoDiffers ? <span className="ml-1 text-warning">· 정보 차이 있음(배송일/주소 변경 없음)</span> : null}
                  </p>
                );
              })}
            </div>
          </details>
        ) : null}

        {errorGroups.length > 0 ? (
          <details className="rounded-lg border border-destructive/40">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm text-destructive">오류 {errorGroups.length}건</summary>
            <div className="space-y-1.5 border-t p-3 text-xs text-destructive">
              {errorGroups.map((g) => (
                <p key={g.groupKey}>
                  {g.upload.recipientName} — {g.reason}
                </p>
              ))}
            </div>
          </details>
        ) : null}

        <div className="flex justify-end pt-2">
          <Button disabled={isSubmitting} onClick={() => onConfirm([...approved])}>
            {isSubmitting ? "등록 중..." : "신규 주문 등록하기"}
          </Button>
        </div>
        <p className="text-right text-xs text-muted-foreground">
          신규 주문과 확인 후 등록한 주문만 등록됩니다. 이미 등록된 주문은 추가되지 않습니다.
        </p>
      </CardContent>
    </Card>
  );
}
