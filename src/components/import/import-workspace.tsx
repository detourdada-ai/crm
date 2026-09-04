"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  analyzeImportFileAction,
  analyzeDuplicatesAction,
  confirmImportAction,
  saveDefaultImportScopeAction,
} from "@/actions/import";
import type {
  ColumnMapping,
  MappableField,
  ParsedSheet,
  DedupAnalysis,
  ImportDateFilterInput,
  ImportDateFilterMode,
} from "@/types/excel";
import type { ImportSummary, ImportRowError } from "@/types/domain";
import { ImportDropzone } from "./import-dropzone";
import { ColumnMappingForm } from "./column-mapping-form";
import { DedupReview } from "./dedup-review";
import { ImportResultCards } from "./import-result-cards";
import { LoadingOverlay } from "@/components/common/loading-overlay";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Stage =
  | { step: "idle" }
  | {
      step: "mapping";
      fileName: string;
      parsed: ParsedSheet;
      mapping: ColumnMapping;
      unmapped: MappableField[];
      unrecognizedHeaders: string[];
    }
  | {
      step: "review";
      fileName: string;
      parsed: ParsedSheet;
      mapping: ColumnMapping;
      analysis: DedupAnalysis;
      dateFilter: ImportDateFilterInput;
    }
  | { step: "done"; importId: string; summary: ImportSummary; errors: ImportRowError[] };

export function ImportWorkspace() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ step: "idle" });
  // STEP14: 이 사업장이 저장해둔 기본 주문 범위. 파일 분석 응답으로 받아오고,
  // 사용자가 명시적으로 기본값을 바꿨을 때만 갱신한다(미설정 = null 유지).
  const [defaultScope, setDefaultScope] = useState<ImportDateFilterMode | null>(null);
  const [isAnalyzing, startAnalyzing] = useTransition();
  const [isCheckingDuplicates, startCheckingDuplicates] = useTransition();
  const [isConfirming, startConfirming] = useTransition();
  const isBusy = isAnalyzing || isCheckingDuplicates || isConfirming;

  // Guard against the user navigating away or refreshing mid-upload — this
  // is exactly how a duplicate registration happened before (no feedback
  // that the upload was in progress, so the user re-triggered it).
  useEffect(() => {
    if (!isBusy) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isBusy]);

  function handleFileSelected(file: File) {
    startAnalyzing(async () => {
      const formData = new FormData();
      formData.append("file", file);
      const result = await analyzeImportFileAction(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Sprint 14-H CASE 4: parsing succeeded (headers exist) but there's no
      // data to map/import — surface the same "no data" wording as a
      // genuinely empty file (CASE 2), never the corrupted-file message,
      // and skip the pointless column-mapping step entirely.
      if (result.parsed.rows.length === 0) {
        toast.error("업로드할 데이터가 없습니다.");
        return;
      }
      setStage({
        step: "mapping",
        fileName: result.fileName,
        parsed: result.parsed,
        mapping: result.mapping,
        unmapped: result.unmapped,
        unrecognizedHeaders: result.unrecognizedHeaders,
      });
      setDefaultScope(result.defaultScope);
    });
  }

  // §CPO 작업지시(누적 표준 엑셀 중복방지, 2026-08): 컬럼 매핑 확정 →
  // 즉시 등록이 아니라 중복 분석(읽기 전용)을 먼저 거친다. 사용자가 검토
  // 화면에서 확인한 뒤에만 실제 등록(handleFinalConfirm)이 실행된다.
  function handleCheckDuplicates(mapping: ColumnMapping, dateFilter: ImportDateFilterInput, saveAsDefault: boolean) {
    if (stage.step !== "mapping") return;
    const { fileName, parsed } = stage;
    startCheckingDuplicates(async () => {
      // 기본값 저장은 체크박스를 켠 경우에만 — 실패해도 이번 업로드는 계속
      // 진행한다(설정 저장 실패로 접수를 막지 않는다).
      if (saveAsDefault) {
        const saved = await saveDefaultImportScopeAction(dateFilter.mode);
        if (saved.ok) {
          setDefaultScope(dateFilter.mode);
          toast.success("앞으로 이 방식을 기본으로 사용합니다.");
        } else {
          toast.error(saved.error);
        }
      }
      const result = await analyzeDuplicatesAction(parsed, mapping, dateFilter);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setStage({ step: "review", fileName, parsed, mapping, analysis: result.analysis, dateFilter });
    });
  }

  function handleFinalConfirm(approvedCandidateGroupKeys: string[]) {
    if (stage.step !== "review") return;
    startConfirming(async () => {
      const result = await confirmImportAction(
        stage.fileName,
        stage.parsed,
        stage.mapping,
        approvedCandidateGroupKeys,
        stage.dateFilter
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("엑셀 업로드가 완료되었습니다.");
      setStage({ step: "done", importId: result.importId, summary: result.summary, errors: result.errors });
      router.refresh();
    });
  }

  return (
    <>
      {isBusy ? (
        <LoadingOverlay
          message={
            isAnalyzing ? "파일을 확인하고 있습니다..." : isCheckingDuplicates ? "중복 여부를 확인하고 있습니다..." : "엑셀 주문을 처리하고 있습니다..."
          }
          hint={isConfirming ? "파일 크기에 따라 시간이 걸릴 수 있습니다." : undefined}
        />
      ) : null}
      {stage.step === "done" ? (
        <div className="space-y-4">
          <ImportResultCards importId={stage.importId} summary={stage.summary} errors={stage.errors} />
          <Button variant="outline" onClick={() => setStage({ step: "idle" })}>
            다른 파일 업로드
          </Button>
        </div>
      ) : stage.step === "review" ? (
        <DedupReview
          analysis={stage.analysis}
          dateFilter={stage.dateFilter}
          onConfirm={handleFinalConfirm}
          isSubmitting={isConfirming}
        />
      ) : stage.step === "mapping" ? (
        <Card>
          <CardHeader>
            <CardTitle>컬럼 매핑 확인 — {stage.fileName}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <LargeFileNotice rowCount={stage.parsed.rows.length} />
            <ColumnMappingForm
              defaultScope={defaultScope}
              parsed={stage.parsed}
              initialMapping={stage.mapping}
              initialUnmapped={stage.unmapped}
              unrecognizedHeaders={stage.unrecognizedHeaders}
              onConfirm={handleCheckDuplicates}
              isSubmitting={isCheckingDuplicates}
            />
          </CardContent>
        </Card>
      ) : (
        <ImportDropzone onFileSelected={handleFileSelected} disabled={isAnalyzing} />
      )}
    </>
  );
}

// Sprint 14-I: thresholds are based on real measurements after the batch-
// import rewrite (100~5,000행 실측: 1~8초) — not a guess. Under 5,000행 the
// upload is fast enough that no warning is shown at all; over that
// (untested territory) we suggest splitting rather than promise a time.
const LARGE_FILE_HEADS_UP_THRESHOLD = 1000;
const LARGE_FILE_SPLIT_SUGGESTION_THRESHOLD = 5000;

function LargeFileNotice({ rowCount }: { rowCount: number }) {
  if (rowCount > LARGE_FILE_SPLIT_SUGGESTION_THRESHOLD) {
    const half = Math.ceil(rowCount / 2);
    return (
      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
        💡 주문이 매우 많습니다 ({rowCount.toLocaleString()}건). 파일을 나누어 등록하면 더 안정적으로 처리할 수
        있습니다. 예: {rowCount.toLocaleString()}건 → {half.toLocaleString()}건씩 2개 파일로 나누어 업로드
      </p>
    );
  }
  if (rowCount > LARGE_FILE_HEADS_UP_THRESHOLD) {
    return (
      <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
        총 {rowCount.toLocaleString()}건입니다. 등록에 몇 초 정도 걸릴 수 있습니다.
      </p>
    );
  }
  return null;
}
