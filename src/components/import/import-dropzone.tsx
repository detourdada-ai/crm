"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

const ACCEPT = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-excel": [".xls"],
  "text/csv": [".csv"],
};

export function ImportDropzone({ onFileSelected, disabled }: { onFileSelected: (file: File) => void; disabled?: boolean }) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles[0]) onFileSelected(acceptedFiles[0]);
    },
    [onFileSelected]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    multiple: false,
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors",
        isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:bg-muted/40",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <input {...getInputProps()} />
      <UploadCloud className="size-8 text-muted-foreground" />
      <p className="text-sm font-medium">파일을 이곳에 드래그하거나 클릭하여 선택하세요</p>
      <p className="text-xs text-muted-foreground">지원 형식: xlsx, xls, csv</p>
    </div>
  );
}
