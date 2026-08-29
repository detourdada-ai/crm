"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bulkAssignDeliveryDateAction } from "@/actions/import";
import { kstTodayIso } from "@/lib/utils/kst-date";
import type { ImportSummary, ImportRowError } from "@/types/domain";

/**
 * Phase 5 STEP4: 업로드 직후 "그래서 제대로 들어간 건가?"를 다시 주문관리에서
 * 찾아보지 않아도 되도록, 결과 요약 + 바로가기 버튼(주문 확인하기/동일인
 * 검토/오류 확인)을 한 화면에 모은다.
 *
 * S1-4: 건수의 기준은 "상품주문"(엑셀 원본 행)이다 — 한 주문번호에 상품주문이
 * 5개면 5건으로 센다. "원본 행 vs 생성된 주문" 같은 내부 처리 단위 설명이나
 * 좌표/geocoding 같은 기술적 세부사항은 사장님이 볼 필요가 없으므로 이 화면에
 * 노출하지 않는다.
 *
 * UX11-STEP1 P0-1/P0-2(CPO 정책, 2026-08): 일반 엑셀은 배송일 컬럼이 없는
 * 경우가 흔한데, 그 상태로 두면 주문은 등록됐지만 기본 화면(오늘)에는 안
 * 보이는 "숨은 주문"이 된다 — 그래서 업로드 직후 이 화면에서 바로 일괄
 * 지정할 수 있게 한다. 주문번호 없는 행이 개별 주문으로 처리된 것도(자동
 * 그룹핑 정책은 그대로 유지, 문구만 추가) 여기서 명시한다.
 */
export function ImportResultCards({
  importId,
  summary,
  errors,
}: {
  importId: string;
  summary: ImportSummary;
  errors: ImportRowError[];
}) {
  const router = useRouter();
  const [showErrors, setShowErrors] = useState(false);
  const [missingCount, setMissingCount] = useState(summary.missingDeliveryDateOrders);
  const [pickedDate, setPickedDate] = useState(kstTodayIso());
  const [isAssigning, startAssigning] = useTransition();

  function handleBulkAssign() {
    startAssigning(async () => {
      const result = await bulkAssignDeliveryDateAction(importId, pickedDate);
      if (!result.ok) {
        toast.error(result.error ?? "배송일 지정 중 오류가 발생했습니다.");
        return;
      }
      toast.success(`배송일 미지정 ${result.updated.toLocaleString()}건이 ${pickedDate} 배송으로 등록되었습니다.`);
      setMissingCount(0);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <CheckCircle2 className="size-5 text-success" />
          업로드 완료
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          총 <span className="font-semibold text-text-strong">{summary.totalRawRows.toLocaleString()}개</span> 상품주문
        </p>
        {summary.dateExcludedRows > 0 ? (
          <p className="text-sm text-muted-foreground">
            날짜 조건 제외 <span className="font-semibold text-text-strong">{summary.dateExcludedRows.toLocaleString()}건</span>
            (중복이나 실패가 아니라 선택한 날짜 범위에 해당하지 않아 가져오지 않았습니다)
          </p>
        ) : null}
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">신규 주문</dt>
            <dd className="font-medium text-text-strong">{summary.newOrders.toLocaleString()}건</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">재주문</dt>
            <dd className="font-medium text-text-strong">{summary.repeatOrders.toLocaleString()}건</dd>
          </div>
          {/*
            STEP2(2026-08 CPO 작업지시): "421건 중 몇 건이 실제 처리됐는지"를
            사장님이 검증할 수 있어야 한다 — alreadyImportedOrders(부모 주문
            묶음 수)가 아니라 alreadyImportedRows(상품주문 단위)를 써야
            newOrders+repeatOrders+alreadyImportedRows+failedRows+
            candidateSkippedRows의 합이 위 totalRawRows와 정확히 일치한다.
          */}
          <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">이미 등록된 상품주문</dt>
            <dd className="font-medium text-text-strong">{summary.alreadyImportedRows.toLocaleString()}건</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">신규 고객</dt>
            <dd className="font-medium text-text-strong">{summary.newCustomers.toLocaleString()}건</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className={summary.duplicateCandidates > 0 ? "text-warning" : "text-muted-foreground"}>동일인 검토</dt>
            <dd className={`font-medium ${summary.duplicateCandidates > 0 ? "text-warning" : "text-text-strong"}`}>
              {summary.duplicateCandidates.toLocaleString()}건
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className={summary.failedRows > 0 ? "text-destructive" : "text-muted-foreground"}>실패</dt>
            <dd className={`font-medium ${summary.failedRows > 0 ? "text-destructive" : "text-text-strong"}`}>
              {summary.failedRows.toLocaleString()}건
            </dd>
          </div>
        </dl>
        {summary.alreadyImportedRows > 0 ? (
          <p className="text-xs text-muted-foreground">
            이미 등록된 상품주문(위 {summary.alreadyImportedRows.toLocaleString()}건)은 건너뛰었습니다(재업로드 시 정상) — 부모 주문
            {summary.alreadyImportedOrders.toLocaleString()}건 전체가 이미 등록된 경우와, 그중 일부 상품주문만 신규였던 경우가 모두
            포함된 숫자입니다.
          </p>
        ) : null}
        {summary.rowsWithoutOrderNumber > 0 ? (
          <p className="text-xs text-muted-foreground">
            주문번호가 없는 {summary.rowsWithoutOrderNumber.toLocaleString()}개 행은 각각 별도 주문으로 등록되었습니다.
          </p>
        ) : null}
        {summary.candidateSkippedOrders > 0 ? (
          <p className="text-xs text-warning">
            중복 가능성이 있어 등록하지 않은 주문 {summary.candidateSkippedOrders.toLocaleString()}건이 있습니다(검토 화면에서 승인하지 않은 후보).
          </p>
        ) : null}
        {summary.repeatConfirmSkippedOrders > 0 ? (
          <p className="text-xs text-warning">
            같은 주문번호가 반복 사용되어 확인이 필요했지만 승인하지 않은 주문 {summary.repeatConfirmSkippedOrders.toLocaleString()}건이
            있습니다(검토 화면에서 &ldquo;하나의 주문으로 등록&rdquo;을 누르지 않은 경우).
          </p>
        ) : null}
        {summary.unrecognizedPaymentStatusOrders > 0 ? (
          <p className="text-xs text-warning">
            결제상태 값을 인식할 수 없는 주문 {summary.unrecognizedPaymentStatusOrders.toLocaleString()}건은 결제완료로 임의 처리하지
            않고 &ldquo;확인 필요&rdquo;로 등록했습니다 — 주문관리에서 직접 확인해주세요.
          </p>
        ) : null}

        {missingCount > 0 ? (
          <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
            <p className="text-sm text-text-strong">
              배송일 미지정 <span className="font-semibold">{missingCount.toLocaleString()}건</span> — 이 상태로 두면
              주문관리 기본 화면(오늘)에 보이지 않습니다.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={pickedDate}
                onChange={(e) => setPickedDate(e.target.value)}
                className="w-40"
                disabled={isAssigning}
              />
              <Button size="sm" onClick={handleBulkAssign} disabled={isAssigning || !pickedDate}>
                {isAssigning ? "지정 중..." : "일괄 지정"}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button asChild size="sm">
            <Link href="/orders">주문 확인하기</Link>
          </Button>
          {summary.duplicateCandidates > 0 ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/duplicates">동일인 검토</Link>
            </Button>
          ) : null}
          {summary.failedRows > 0 ? (
            <Button size="sm" variant="outline" onClick={() => setShowErrors((v) => !v)} className="gap-1.5">
              오류 확인
              <ChevronDown className={`size-4 transition-transform ${showErrors ? "rotate-180" : ""}`} />
            </Button>
          ) : null}
        </div>

        {showErrors && errors.length > 0 ? (
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-md bg-muted/40 p-3 text-xs">
            {errors.map((e, i) => (
              <p key={i} className="text-destructive">
                {e.row > 0 ? `${e.row}행: ` : ""}
                {e.reason}
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
