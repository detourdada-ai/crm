"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type {
  DedupAnalysis,
  DedupGroupResult,
  DedupOrderSnapshot,
  DedupProductOrderItem,
  ImportDateFilterInput,
} from "@/types/excel";

/** STEP14: 이 결과가 "어떤 범위로 만들어진 결과인지"를 숫자 옆에서 바로 확인시킨다. */
function scopeLabelOf(dateFilter: ImportDateFilterInput | undefined): string {
  if (!dateFilter || dateFilter.mode === "all") return "전체 주문";
  if (dateFilter.mode === "today") return "오늘 주문";
  return `${dateFilter.date ?? "선택한 날짜"} 주문`;
}

/**
 * 주문관리·표준엑셀·배송관리 UX 개선(2026-08 CPO 작업지시) §3-2/§4 Phase1:
 * "identity_conflict" 그룹은 병합 선택지 없이 등록 자체를 차단한다 — 발견된
 * 서로 다른 고객을 전부 나열해, 사장님이 원본 엑셀에서 어떤 행을 고쳐야
 * 하는지 바로 알 수 있게 한다(전화/주소를 가리지 않는 이유: 이 화면의
 * 목적이 "본인 파일에서 실제 고객을 찾아 고치는 것"이라 마스킹하면 오히려
 * 방해가 된다).
 */
function IdentityConflictCard({ group }: { group: DedupGroupResult }) {
  const identities = group.conflictingIdentities ?? [];
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <p className="text-sm font-medium text-destructive">
        {group.upload.orderNumber ? `주문번호 ${group.upload.orderNumber}` : "주문번호 없음"} — 등록하지 않았습니다
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        같은 주문번호에 서로 다른 고객 정보가 섞여 있습니다. 아래 고객 중 이 주문번호에 실제로 해당하는 사람이 누구인지 원본 엑셀에서
        확인 후 각 고객마다 다른 주문번호를 쓰거나, 같은 주문번호를 쓰려면 이름·연락처·주소를 모두 동일하게 맞춰 다시
        업로드해주세요.
      </p>
      <div className="mt-2 space-y-1">
        {identities.map((entry, i) => (
          <p key={i} className="rounded-md bg-card/60 px-2 py-1.5 text-xs text-text-strong">
            {entry.recipientName} · {entry.phone ?? "연락처 없음"} · {entry.address ?? "주소 없음"}
            <span className="text-muted-foreground"> ({entry.productSummary})</span>
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * Phase 2(2026-08 CPO 작업지시) §2: 같은 고객이 같은 order_number를 반복
 * 사용한 그룹 — identity_conflict와 달리 등록을 아예 막지는 않지만, 시스템이
 * 임의로 "하나의 다상품 주문"이라고 확정하지 않고 상품/배송일을 그대로
 * 보여준 뒤 사장님이 직접 하나의 주문인지 확인하게 한다. 승인하지 않으면
 * 등록되지 않는다(안전한 방향 우선 — candidate와 동일 원칙).
 */
function RepeatConfirmCard({ group, approved, onToggle }: { group: DedupGroupResult; approved: boolean; onToggle: () => void }) {
  const rows = group.repeatRows ?? [];
  return (
    <div className={`rounded-md border p-3 transition-colors ${approved ? "border-primary bg-primary-soft/30" : "border-warning/40 bg-card"}`}>
      <p className="text-sm font-medium text-text-strong">
        {group.upload.recipientName} · 주문번호 {group.upload.orderNumber} — {rows.length}개 행에서 반복 사용
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        고객 정보가 같아 하나의 주문으로 묶을 수 있습니다. 상품/배송일이 다르면 별도 주문일 수 있으니 아래 목록을 확인해주세요.
      </p>
      <div className="mt-2 space-y-1">
        {rows.map((r, i) => (
          <p key={i} className="rounded-md bg-card/60 px-2 py-1.5 text-xs text-text-strong">
            {r.productSummary}
            <span className="text-muted-foreground"> · {formatDeliveryDate(r.deliveryDate)}</span>
          </p>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={approved ? "default" : "outline"} onClick={onToggle} className="gap-1.5">
          {approved ? "✓ 하나의 주문으로 등록" : "하나의 주문으로 등록"}
        </Button>
        {!approved ? (
          <span className="text-xs text-muted-foreground">등록하지 않음(기본값) — 별도 주문이면 엑셀에서 주문번호를 다르게 입력해 다시 업로드해주세요.</span>
        ) : null}
      </div>
    </div>
  );
}

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
  dateFilter,
  onConfirm,
  isSubmitting,
}: {
  analysis: DedupAnalysis;
  dateFilter?: ImportDateFilterInput;
  onConfirm: (approvedGroupKeys: string[]) => void;
  isSubmitting: boolean;
}) {
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const candidates = analysis.groups.filter((g) => g.status === "candidate");
  const confirmedDuplicates = analysis.groups.filter((g) => g.status === "confirmed_duplicate");
  const errorGroups = analysis.groups.filter((g) => g.status === "error");
  const partialGroups = analysis.groups.filter((g) => g.status === "partial");
  const identityConflictGroups = analysis.groups.filter((g) => g.status === "identity_conflict");
  const repeatConfirmGroups = analysis.groups.filter((g) => g.status === "repeat_confirm_needed");

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
        {/* STEP14: 경고를 한 번 더 반복하는 게 아니라, 내가 어떤 필터로 이
            결과를 만들었는지 확인시키는 용도다. */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">이번에 가져온 주문 범위</span>
          <span className="rounded-md bg-secondary px-2 py-0.5 font-medium text-text-strong">{scopeLabelOf(dateFilter)}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          총 <span className="font-semibold text-text-strong">{analysis.totalProductOrders.toLocaleString()}개 상품행</span>을
          확인했습니다(주문 묶음 {analysis.totalGroups.toLocaleString()}건).
        </p>
        {!dateFilter || dateFilter.mode === "all" ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-800">
            전체 주문을 선택하여 엑셀에 포함된 누적 주문을 확인했습니다. 오늘 처리할 주문만 접수하려면 이전 단계에서 &lsquo;오늘 주문
            가져오기&rsquo;를 선택하세요.
          </p>
        ) : null}
        {/* STEP11-2 Phase4(2026-08 CPO 작업지시): 날짜 필터로 제외된 건은
            중복/신규 판정 자체를 받지 않으므로 위 total과 별개로 먼저
            보여준다 — "왜 파일 건수보다 적게 처리됐는지"를 바로 알 수 있게. */}
        {analysis.dateExcludedCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            날짜 조건에 맞지 않아 <span className="font-semibold text-text-strong">{analysis.dateExcludedCount.toLocaleString()}건</span>을
            제외했습니다(중복이나 오류가 아닙니다).
          </p>
        ) : null}
        {/*
          STEP2(2026-08 CPO 작업지시): 아래 숫자는 반드시 상품주문(엑셀 원본 행)
          단위로 세어 위 총 개수와 정확히 합이 맞아야 한다 — 부모 주문(그룹) 수로
          세면 "421건 중 몇 건이 처리됐는지" 사장님이 검증할 수 없다(예: 혼재
          그룹 하나 안에 신규 1개+기존 4개가 섞여 있으면 그룹 수로는 "1건"이지만
          실제로는 신규 1개/기존 4개로 나뉜다). analysis.newCount 등은
          import-dedup.service.ts가 이미 상품주문 단위로 계산해 둔 값이라
          newCount+confirmedDuplicateCount+candidateCount+errorCount는 항상
          totalProductOrders와 정확히 일치한다.
        */}
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">신규 상품행</dt>
            <dd className="font-medium text-text-strong">{analysis.newCount.toLocaleString()}건</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className={analysis.candidateCount > 0 ? "text-warning" : "text-muted-foreground"}>중복 가능성이 있는 상품행</dt>
            <dd className={`font-medium ${analysis.candidateCount > 0 ? "text-warning" : "text-text-strong"}`}>
              {analysis.candidateCount.toLocaleString()}건
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">이미 등록된 상품행</dt>
            <dd className="font-medium text-text-strong">{analysis.confirmedDuplicateCount.toLocaleString()}건</dd>
          </div>
          {analysis.identityConflictCount > 0 ? (
            <div className="flex items-baseline justify-between">
              <dt className="text-destructive">등록 차단(다른 고객 정보 혼재)</dt>
              <dd className="font-medium text-destructive">{analysis.identityConflictCount.toLocaleString()}건</dd>
            </div>
          ) : null}
          {analysis.repeatConfirmCount > 0 ? (
            <div className="flex items-baseline justify-between">
              <dt className="text-warning">확인이 필요한 상품행(주문번호 반복)</dt>
              <dd className="font-medium text-warning">{analysis.repeatConfirmCount.toLocaleString()}건</dd>
            </div>
          ) : null}
          {analysis.errorCount - analysis.identityConflictCount > 0 ? (
            <div className="flex items-baseline justify-between">
              <dt className="text-destructive">오류</dt>
              <dd className="font-medium text-destructive">{(analysis.errorCount - analysis.identityConflictCount).toLocaleString()}건</dd>
            </div>
          ) : null}
        </dl>
        {partialGroups.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            이 중 {partialGroups.length.toLocaleString()}개 주문 묶음은 같은 주문번호 안에 신규/기존 상품행이 섞여 있어, 신규
            상품행만 자동으로 추가 등록됩니다(아래 상세 참고).
          </p>
        ) : null}
        {analysis.unrecognizedPaymentStatusCount > 0 ? (
          <p className="text-xs text-warning">
            결제상태 값을 인식할 수 없는 주문 {analysis.unrecognizedPaymentStatusCount.toLocaleString()}건이 있습니다 — 결제완료로
            임의 처리하지 않고 등록 시 &ldquo;확인 필요&rdquo;로 남깁니다.
          </p>
        ) : null}

        {identityConflictGroups.length > 0 ? (
          <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <p className="text-sm font-medium text-destructive">
              🚫 서로 다른 고객이 같은 주문번호를 사용해 등록이 차단된 주문 {identityConflictGroups.length}건
            </p>
            <div className="space-y-2">
              {identityConflictGroups.map((g) => (
                <IdentityConflictCard key={g.groupKey} group={g} />
              ))}
            </div>
          </div>
        ) : null}

        {repeatConfirmGroups.length > 0 ? (
          <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
            <p className="text-sm font-medium text-text-strong">⚠️ 같은 주문번호가 여러 행에서 사용된 주문 {repeatConfirmGroups.length}건 — 확인해주세요</p>
            <div className="space-y-2">
              {repeatConfirmGroups.map((g) => (
                <RepeatConfirmCard key={g.groupKey} group={g} approved={approved.has(g.groupKey)} onToggle={() => toggle(g.groupKey)} />
              ))}
            </div>
          </div>
        ) : null}

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
              신규 상품행은 사용자 확인 없이 기존 주문에 자동으로 추가 등록됩니다(기존 상품/배송/기사배정 정보는 그대로 유지).
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
