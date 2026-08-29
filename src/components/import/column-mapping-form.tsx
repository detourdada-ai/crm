"use client";

import { useMemo, useState } from "react";
import { MAPPABLE_FIELDS } from "@/types/excel";
import type { ColumnMapping, MappableField, ParsedSheet, ImportDateFilterInput, ImportDateFilterField, ImportDateFilterMode } from "@/types/excel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { kstTodayIso } from "@/lib/utils/kst-date";

const NONE_VALUE = "__none__";

/** STEP11-2 Phase4(2026-08 CPO 작업지시): "발송일/수령일"이 별도 필드로
 *  독립 존재하지 않으므로(조사 결과, delivery_date가 "배송일(발송 희망일)"로
 *  이미 그 의미를 겸함) 새 필드를 만들지 않고 기존 날짜 성격 MappableField
 *  3개 중 실제 매핑된 것만 "기준 날짜 컬럼" 후보로 제시한다. */
const DATE_FILTER_FIELDS: ImportDateFilterField[] = ["delivery_date", "order_date", "shipped_at"];

function labelOf(field: ImportDateFilterField): string {
  return MAPPABLE_FIELDS.find((f) => f.key === field)?.label ?? field;
}

/** 미리보기용 — 첫 행의 원본 셀 값을 화면에 보여줄 수 있는 짧은 문자열로 바꾼다. */
function cellPreview(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = value instanceof Date ? value.toLocaleString() : String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

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
  onConfirm: (mapping: ColumnMapping, dateFilter: ImportDateFilterInput) => void;
  isSubmitting: boolean;
}) {
  const [mapping, setMapping] = useState<ColumnMapping>(initialMapping);

  const requiredButUnmapped = useMemo(
    () => MAPPABLE_FIELDS.filter((f) => f.required && !mapping[f.key]),
    [mapping]
  );

  const canConfirm = requiredButUnmapped.length === 0;

  // STEP11-2 Phase4: "가져올 주문 범위" — 매핑된 날짜 컬럼이 하나도 없으면
  // 기준으로 삼을 값 자체가 없으므로 섹션을 아예 숨긴다(기본값 "전체
  // 주문 가져오기"만 존재하는 것과 동일한 결과 — 기존 사용자 흐름에
  // 영향 없음).
  const availableDateFields = useMemo(() => DATE_FILTER_FIELDS.filter((f) => !!mapping[f]), [mapping]);
  const [dateFilterMode, setDateFilterMode] = useState<ImportDateFilterMode>("all");
  const [dateFilterField, setDateFilterField] = useState<ImportDateFilterField>(availableDateFields[0] ?? "delivery_date");
  const [specificDate, setSpecificDate] = useState(kstTodayIso());

  function handleConfirm() {
    const dateFilter: ImportDateFilterInput = {
      mode: dateFilterMode,
      field: dateFilterField,
      date: dateFilterMode === "specific_date" ? specificDate : undefined,
    };
    onConfirm(mapping, dateFilter);
  }

  return (
    <div className="space-y-4">
      {initialUnmapped.length > 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          필수 컬럼을 확인해주세요. 자동으로 인식되지 않은 필수 항목이 있습니다. 아래에서 직접 컬럼을 선택해주세요.
        </p>
      ) : (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          모든 필수 항목이 자동으로 매핑되었습니다. 내용을 확인하고 가져오기를 진행하세요.
        </p>
      )}

      {/* S1-6/긴급수정(2026-08): "구분 | 업로드 파일 컬럼 | 데이터" — 예전엔
          "업로드 파일 컬럼" 헤더 밑에 CRM 필드명과 실제 파일 컬럼 select가 한
          셀에 같이 있어서, 헤더가 가리키는 게 뭔지 헷갈렸다. 구분(CRM 필드명)과
          업로드 파일 컬럼(실제 select)을 별도 열로 분리해 헤더-내용이 정확히
          대응하게 한다(카테고리 배지는 CPO 지시로 제거 — 구분 열 하나로 충분).
          마지막 열은 첫 번째 행의 실제 값을 그대로 보여줘서 "이 컬럼이 실제로
          이런 값이 들어오는구나"를 매핑을 바꾸지 않고도 바로 확인할 수 있게
          한다. */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">구분</TableHead>
            <TableHead className="w-56">업로드 파일 컬럼</TableHead>
            <TableHead>데이터</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {MAPPABLE_FIELDS.map((field) => {
            const selectedHeader = mapping[field.key];
            const sampleValue = selectedHeader ? cellPreview(parsed.rows[0]?.[selectedHeader]) : null;
            return (
              <TableRow key={field.key}>
                <TableCell className="align-top">
                  <p className="text-sm font-medium">
                    {field.label}
                    {field.required ? <span className="ml-1 text-destructive">*</span> : null}
                  </p>
                </TableCell>
                <TableCell className="align-top">
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
                <TableCell className="align-top text-sm text-muted-foreground">
                  {sampleValue !== null ? sampleValue : <span className="text-muted-foreground/60">-</span>}
                </TableCell>
              </TableRow>
            );
          })}
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

      {availableDateFields.length > 0 ? (
        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
          <p className="text-sm font-medium text-text-strong">가져올 주문 범위</p>
          <p className="text-xs text-muted-foreground">
            기본값은 파일의 모든 주문을 그대로 가져오는 것입니다. 특정 날짜의 주문만 골라 받고 싶다면 아래에서 기준 날짜 컬럼과 범위를
            선택하세요.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={dateFilterMode} onValueChange={(v) => setDateFilterMode(v as ImportDateFilterMode)}>
              <SelectTrigger className="w-56" aria-label="가져올 주문 범위">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 주문 가져오기(기본)</SelectItem>
                <SelectItem value="today">오늘 주문만 가져오기</SelectItem>
                <SelectItem value="specific_date">특정 날짜 주문만 가져오기</SelectItem>
              </SelectContent>
            </Select>
            {dateFilterMode !== "all" ? (
              <>
                <span className="text-sm text-muted-foreground">기준:</span>
                <Select value={dateFilterField} onValueChange={(v) => setDateFilterField(v as ImportDateFilterField)}>
                  <SelectTrigger className="w-40" aria-label="기준 날짜 컬럼">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableDateFields.map((f) => (
                      <SelectItem key={f} value={f}>
                        {labelOf(f)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ) : null}
            {dateFilterMode === "specific_date" ? (
              <Input
                type="date"
                aria-label="특정 날짜"
                value={specificDate}
                onChange={(e) => setSpecificDate(e.target.value)}
                className="w-40"
              />
            ) : null}
          </div>
          {dateFilterMode !== "all" ? (
            <p className="text-xs text-muted-foreground">
              {labelOf(dateFilterField)} 기준으로 {dateFilterMode === "today" ? "오늘" : specificDate || "선택한 날짜"}에 해당하지 않는
              주문은 등록되지 않고 &ldquo;날짜 조건 제외&rdquo;로 별도 집계됩니다(중복/오류와 다름).
            </p>
          ) : null}
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
        <Button disabled={!canConfirm || isSubmitting} onClick={handleConfirm}>
          {isSubmitting ? "확인 중..." : "다음: 중복 확인"}
        </Button>
      </div>
    </div>
  );
}
