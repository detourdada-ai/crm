"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { analyzeImportFileAction, confirmImportAction } from "@/actions/import";
import type { ColumnMapping, MappableField, ParsedSheet } from "@/types/excel";
import type { ImportSummary } from "@/types/domain";
import { ImportDropzone } from "./import-dropzone";
import { ColumnMappingForm } from "./column-mapping-form";
import { ImportResultCards } from "./import-result-cards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Stage =
  | { step: "idle" }
  | { step: "mapping"; fileName: string; parsed: ParsedSheet; mapping: ColumnMapping; unmapped: MappableField[] }
  | { step: "done"; summary: ImportSummary };

export function ImportWorkspace() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ step: "idle" });
  const [isAnalyzing, startAnalyzing] = useTransition();
  const [isConfirming, startConfirming] = useTransition();

  function handleFileSelected(file: File) {
    startAnalyzing(async () => {
      const formData = new FormData();
      formData.append("file", file);
      const result = await analyzeImportFileAction(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setStage({
        step: "mapping",
        fileName: result.fileName,
        parsed: result.parsed,
        mapping: result.mapping,
        unmapped: result.unmapped,
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
      setStage({ step: "done", summary: result.summary });
      router.refresh();
    });
  }

  if (stage.step === "done") {
    return (
      <div className="space-y-4">
        <ImportResultCards summary={stage.summary} />
        <Button variant="outline" onClick={() => setStage({ step: "idle" })}>
          다른 파일 업로드
        </Button>
      </div>
    );
  }

  if (stage.step === "mapping") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>컬럼 매핑 확인 — {stage.fileName}</CardTitle>
        </CardHeader>
        <CardContent>
          <ColumnMappingForm
            parsed={stage.parsed}
            initialMapping={stage.mapping}
            initialUnmapped={stage.unmapped}
            onConfirm={handleConfirm}
            isSubmitting={isConfirming}
          />
        </CardContent>
      </Card>
    );
  }

  return <ImportDropzone onFileSelected={handleFileSelected} disabled={isAnalyzing} />;
}
