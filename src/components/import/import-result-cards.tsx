"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, ChevronDown } from "lucide-react";
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
        {/* P5: "261건 → 157건, 104건은 어디 갔나"를 임의로 "정상 처리"라고
            뭉개지 않고 원본 행 → 주문 그룹 → 신규/이미등록/실패로 단계별
            분해해 보여준다. totalRawRows = totalOrderGroups로 그룹화되기
            전의 엑셀 원본 행(상품 라인) 수 — 한 주문에 상품이 여러 개면
            자연히 줄어드는 것이지 유실이 아니다. */}
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            엑셀 원본 {summary.totalRawRows.toLocaleString()}행 → 주문번호 기준 {summary.totalOrderGroups.toLocaleString()}건으로
            그룹화 (한 주문에 상품이 여러 개면 여러 행이 하나로 합쳐집니다)
          </p>
        </div>
        <ul className="space-y-1.5 text-sm">
          <li className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-success" />
            신규 주문 생성 {summary.newOrdersCreated}건
          </li>
          {summary.alreadyImportedOrders > 0 ? (
            <li className="flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="size-4" />
              이미 등록되어 건너뜀 {summary.alreadyImportedOrders}건 (재업로드 시 정상)
            </li>
          ) : null}
          <li className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-success" />
            신규 고객 {summary.newCustomers}명 · 기존 고객 매칭 {summary.existingCustomers}명
          </li>
          {summary.duplicateCandidates > 0 ? (
            <li className="flex items-center gap-2 text-warning">
              <AlertTriangle className="size-4" />
              동일인 검토 필요 {summary.duplicateCandidates}건
            </li>
          ) : null}
          {summary.failedRows > 0 ? (
            <li className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" />
              오류 {summary.failedRows}건
            </li>
          ) : null}
        </ul>

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
