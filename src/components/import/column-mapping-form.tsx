"use client";

import { useMemo, useState } from "react";
import { MAPPABLE_FIELDS } from "@/types/excel";
import type { ColumnMapping, MappableField, ParsedSheet } from "@/types/excel";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const NONE_VALUE = "__none__";

export function ColumnMappingForm({
  parsed,
  initialMapping,
  initialUnmapped,
  unrecognizedHeaders,
  onConfirm,
  isSubmitting,
}: {
  parsed: ParsedSheet;
  initialMapping: ColumnMapping;
  initialUnmapped: MappableField[];
  unrecognizedHeaders: string[];
  onConfirm: (mapping: ColumnMapping) => void;
  isSubmitting: boolean;
}) {
  const [mapping, setMapping] = useState<ColumnMapping>(initialMapping);

  const requiredButUnmapped = useMemo(
    () => MAPPABLE_FIELDS.filter((f) => f.required && !mapping[f.key]),
    [mapping]
  );

  const canConfirm = requiredButUnmapped.length === 0;

  return (
    <div className="space-y-4">
      {initialUnmapped.length > 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          자동으로 인식되지 않은 필수 항목이 있습니다. 아래에서 직접 컬럼을 선택해주세요.
        </p>
      ) : (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          모든 필수 항목이 자동으로 매핑되었습니다. 내용을 확인하고 가져오기를 진행하세요.
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">CRM 항목</TableHead>
            <TableHead>업로드 파일의 컬럼</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {MAPPABLE_FIELDS.map((field) => (
            <TableRow key={field.key}>
              <TableCell className="font-medium">
                {field.label}
                {field.required ? <span className="ml-1 text-destructive">*</span> : null}
              </TableCell>
              <TableCell>
                <Select
                  value={mapping[field.key] ?? NONE_VALUE}
                  onValueChange={(value) =>
                    setMapping((prev) => ({ ...prev, [field.key]: value === NONE_VALUE ? undefined : value }))
                  }
                >
                  <SelectTrigger className="w-full max-w-xs">
                    <SelectValue placeholder="선택 안 함" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>선택 안 함</SelectItem>
                    {parsed.headers.map((header) => (
                      <SelectItem key={header} value={header}>
                        {header}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {unrecognizedHeaders.length > 0 ? (
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="mb-1.5 font-medium text-foreground">
            아래 {unrecognizedHeaders.length}개 컬럼은 CRM 항목과 매핑되지 않지만, 삭제되지 않고 각 주문상품의
            원본 데이터로 그대로 저장됩니다 (주문 상세 화면의 &ldquo;엑셀 원본 데이터&rdquo;에서 확인 가능).
          </p>
          <div className="flex flex-wrap gap-1">
            {unrecognizedHeaders.map((header) => (
              <Badge key={header} variant="outline">
                {header}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {requiredButUnmapped.map((f) => (
            <Badge key={f.key} variant="destructive">
              {f.label} 필요
            </Badge>
          ))}
        </div>
        <Button disabled={!canConfirm || isSubmitting} onClick={() => onConfirm(mapping)}>
          {isSubmitting ? "가져오는 중..." : `${parsed.rows.length}행 가져오기`}
        </Button>
      </div>
    </div>
  );
}
