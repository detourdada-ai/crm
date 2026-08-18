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
        {/* P6 12번: "261건 → 157건, 104건은 어디 갔나"를 임의로 "정상 처리"라고
            뭉개지 않는다 — CPO가 지정한 6줄(원본 행/주문 생성/신규 고객/기존
            고객 매칭/동일인 검토/실패)을 값이 0이어도 항상 보여주고, 두 숫자가
            차이나는 이유를 바로 아래 문장으로 설명한다. */}
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">원본 행</dt>
          <dd className="text-right font-medium text-text-strong">{summary.totalRawRows.toLocaleString()}건</dd>
          <dt className="text-muted-foreground">주문 생성</dt>
          <dd className="text-right font-medium text-text-strong">{summary.totalOrderGroups.toLocaleString()}건</dd>
          <dt className="text-muted-foreground">신규 고객</dt>
          <dd className="text-right font-medium text-text-strong">{summary.newCustomers.toLocaleString()}명</dd>
          <dt className="text-muted-foreground">기존 고객 매칭</dt>
          <dd className="text-right font-medium text-text-strong">{summary.existingCustomers.toLocaleString()}명</dd>
          <dt className={summary.duplicateCandidates > 0 ? "text-warning" : "text-muted-foreground"}>동일인 검토</dt>
          <dd className={`text-right font-medium ${summary.duplicateCandidates > 0 ? "text-warning" : "text-text-strong"}`}>
            {summary.duplicateCandidates.toLocaleString()}건
          </dd>
          <dt className={summary.failedRows > 0 ? "text-destructive" : "text-muted-foreground"}>실패</dt>
          <dd className={`text-right font-medium ${summary.failedRows > 0 ? "text-destructive" : "text-text-strong"}`}>
            {summary.failedRows.toLocaleString()}건
          </dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          여러 행이 하나의 주문에 포함된 경우 주문 단위로 합쳐집니다.
          {summary.alreadyImportedOrders > 0
            ? ` 이 중 ${summary.alreadyImportedOrders.toLocaleString()}건은 이미 등록되어 있어 건너뛰었습니다(재업로드 시 정상).`
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
