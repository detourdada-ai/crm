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
 *
 * S1-4: 건수의 기준은 "상품주문"(엑셀 원본 행)이다 — 한 주문번호에 상품주문이
 * 5개면 5건으로 센다. "원본 행 vs 생성된 주문" 같은 내부 처리 단위 설명이나
 * 좌표/geocoding 같은 기술적 세부사항은 사장님이 볼 필요가 없으므로 이 화면에
 * 노출하지 않는다.
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
        <p className="text-sm text-muted-foreground">
          총 <span className="font-semibold text-text-strong">{summary.totalRawRows.toLocaleString()}개</span> 상품주문
        </p>
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">신규 주문</dt>
            <dd className="font-medium text-text-strong">{summary.newOrders.toLocaleString()}건</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">재주문</dt>
            <dd className="font-medium text-text-strong">{summary.repeatOrders.toLocaleString()}건</dd>
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
        {summary.alreadyImportedOrders > 0 ? (
          <p className="text-xs text-muted-foreground">
            이미 등록된 주문 {summary.alreadyImportedOrders.toLocaleString()}건은 건너뛰었습니다(재업로드 시 정상).
          </p>
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
