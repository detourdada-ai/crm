"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { analyzeImportFileAction, confirmImportAction } from "@/actions/import";
import type { ColumnMapping, MappableField, ParsedSheet } from "@/types/excel";
import type { ImportSummary, ImportRowError } from "@/types/domain";
import { ImportDropzone } from "./import-dropzone";
import { ColumnMappingForm } from "./column-mapping-form";
import { ImportResultCards } from "./import-result-cards";
import { ImportLoadingOverlay } from "./import-loading-overlay";
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
  | { step: "done"; summary: ImportSummary; errors: ImportRowError[] };

export function ImportWorkspace() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ step: "idle" });
  const [isAnalyzing, startAnalyzing] = useTransition();
  const [isConfirming, startConfirming] = useTransition();
  const isBusy = isAnalyzing || isConfirming;

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
    });
  }

  function handleConfirm(mapping: ColumnMapping) {
    if (stage.step !== "mapping") return;
    startConfirming(async () => {
      const result = await confirmImportAction(stage.fileName, stage.parsed, mapping);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("엑셀 업로드가 완료되었습니다.");
      setStage({ step: "done", summary: result.summary, errors: result.errors });
      router.refresh();
    });
  }

  return (
    <>
      {isBusy ? (
        <ImportLoadingOverlay
          message={isAnalyzing ? "파일을 확인하고 있습니다..." : "엑셀 주문을 처리하고 있습니다..."}
          hint={isAnalyzing ? undefined : "파일 크기에 따라 시간이 걸릴 수 있습니다."}
        />
      ) : null}
      {stage.step === "done" ? (
        <div className="space-y-4">
          <ImportResultCards summary={stage.summary} errors={stage.errors} />
          <Button variant="outline" onClick={() => setStage({ step: "idle" })}>
            다른 파일 업로드
          </Button>
        </div>
      ) : stage.step === "mapping" ? (
        <Card>
          <CardHeader>
            <CardTitle>컬럼 매핑 확인 — {stage.fileName}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <LargeFileNotice rowCount={stage.parsed.rows.length} />
            <ColumnMappingForm
              parsed={stage.parsed}
              initialMapping={stage.mapping}
              initialUnmapped={stage.unmapped}
              unrecognizedHeaders={stage.unrecognizedHeaders}
              onConfirm={handleConfirm}
              isSubmitting={isConfirming}
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
