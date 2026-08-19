"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ImportSummary, ImportRowError } from "@/types/domain";

/**
 * Phase 5 STEP4: 업로드 직후 "그래서 제대로 들어간 건가?"를 다시 주문관리에서
 * 찾아보지 않아도 되도록, 결과 요약 + 바로가기 버튼(주문 확인하기/동일인
 * 검토/오류 확인)을 한 화면에 모은다.
 */
export function ImportResultCards({ summary, errors }: { summary: ImportSummary; errors: ImportRowError[] }) {
  const [showErrors, setShowErrors] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <CheckCircle2 className="size-5 text-success" />
          업로드 완료
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* P8 3번: "신규 주문"/"반복 주문"은 고객 레코드가 새로 생겼는지가
            아니라 "이 주문이 그 고객의 진짜 첫 주문인지"로 정의한다
            (customer_order_stats 기준, runImport 참고) — 기존 고객이어도
            이전 주문이 0건이면 신규 주문으로 잡힌다. 원본 행과는 다른
            단위(행 vs 주문)라는 걸 명확히 분리해서, "261행인데 왜 157건이냐"
            는 의문에 숫자를 억지로 맞추지 않고 각 줄이 무엇을 세는지로 답한다. */}
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">원본 행</dt>
            <dd className="font-medium text-text-strong">{summary.totalRawRows.toLocaleString()}행</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">생성된 주문</dt>
            <dd className="font-medium text-text-strong">{summary.newOrdersCreated.toLocaleString()}건</dd>
          </div>
          <div className="flex items-baseline justify-between pl-4">
            <dt className="text-muted-foreground">├─ 신규 주문</dt>
            <dd className="text-text-strong">{summary.newOrders.toLocaleString()}건</dd>
          </div>
          <div className="flex items-baseline justify-between pl-4">
            <dt className="text-muted-foreground">└─ 반복 주문</dt>
            <dd className="text-text-strong">{summary.repeatOrders.toLocaleString()}건</dd>
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
          {summary.geocodeSuccess + summary.geocodeFailed > 0 ? (
            <>
              <div className="flex items-baseline justify-between pt-1">
                <dt className="text-muted-foreground">배송지 좌표 확보</dt>
                <dd className="text-text-strong">{summary.geocodeSuccess.toLocaleString()}건</dd>
              </div>
              {summary.geocodeFailed > 0 ? (
                <div className="flex items-baseline justify-between">
                  <dt className="text-warning">좌표 확보 실패</dt>
                  <dd className="font-medium text-warning">{summary.geocodeFailed.toLocaleString()}건</dd>
                </div>
              ) : null}
            </>
          ) : null}
        </dl>
        <p className="text-xs text-muted-foreground">
          엑셀은 상품 단위 행이라 여러 행이 하나의 주문으로 합쳐질 수 있어, 원본 행과 생성된 주문 수는 서로 다른
          기준입니다.
          {summary.alreadyImportedOrders > 0
            ? ` 이미 등록된 주문번호 ${summary.alreadyImportedOrders.toLocaleString()}건은 건너뛰었습니다(재업로드 시 정상).`
            : ""}
          {summary.geocodeFailed > 0
            ? ` 좌표 확보에 실패한 주문도 정상 등록되며, 주문 상세에서 주소를 다시 저장하면 재시도됩니다.`
            : ""}
        </p>

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
