"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateRecruitApplicationStatusAction, updateRecruitInterviewAction } from "@/actions/beta-recruit";
import { formatKstDateKorean } from "@/lib/utils/kst-date";
import { PROBLEM_CATEGORIES } from "@/types/domain";
import type { BetaRecruitApplication, RecruitApplicationStatus } from "@/types/domain";

const STATUSES: RecruitApplicationStatus[] = ["신규", "연락예정", "인터뷰완료", "Beta후보", "Beta참여", "보류"];

// Section 9: 인터뷰 진행 시 참고할 정적 질문 가이드 — DB에 저장하지 않는 참고용 UI.
const INTERVIEW_QUESTIONS = [
  "지금 주문은 하루에 몇 건 정도, 어떤 채널로 들어오나요?",
  "주문이 들어오면 그다음엔 어떻게 처리하세요? (엑셀, 카톡, 수기 등 실제 순서 그대로)",
  "직접 배송하시나요, 아니면 기사님이 배송하시나요? 몇 분이 하시나요?",
  "담당자/기사님에게 배송 목록을 어떤 방식으로 전달하세요?",
  "배송이 끝났는지는 어떻게 확인/기록하세요?",
  "지금 방식에서 가장 번거롭거나 실수가 잦은 부분은 어디인가요?",
  "그 문제가 하루에/일주일에 몇 번 정도 발생하나요?",
  "지금은 그 문제를 어떻게 해결하고 계세요? (임시방편이라도 괜찮습니다)",
  "이 문제가 해결된다면 실제로 시간이나 비용이 얼마나 절약될까요?",
  "지금 쓰시는 도구(엑셀/카톡/스마트스토어) 중 계속 쓰고 싶은 것과 바꾸고 싶은 것은 무엇인가요?",
];

function StatusSelect({ application }: { application: BetaRecruitApplication }) {
  const [status, setStatus] = useState(application.status);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: RecruitApplicationStatus) {
    const prev = status;
    setStatus(next);
    startTransition(async () => {
      const result = await updateRecruitApplicationStatusAction(application.id, next);
      if (!result.ok) {
        toast.error(result.error ?? "상태 변경 중 오류가 발생했습니다.");
        setStatus(prev);
      }
    });
  }

  return (
    <select
      value={status}
      disabled={isPending}
      onChange={(e) => handleChange(e.target.value as RecruitApplicationStatus)}
      className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

function InterviewForm({ application }: { application: BetaRecruitApplication }) {
  const [fields, setFields] = useState({
    interviewNotes: application.interview_notes ?? "",
    problem: application.problem ?? "",
    currentSolution: application.current_solution ?? "",
    frequency: application.frequency ?? "",
    severity: application.severity ?? "",
    currentWorkaround: application.current_workaround ?? "",
    productFit: application.product_fit ?? "",
  });
  const [categories, setCategories] = useState<string[]>(application.problem_categories ?? []);
  const [isPending, startTransition] = useTransition();

  function toggleCategory(category: string) {
    setCategories((prev) => (prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]));
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateRecruitInterviewAction(application.id, { ...fields, problemCategories: categories });
      if (result.ok) toast.success("인터뷰 결과를 저장했습니다.");
      else toast.error(result.error ?? "저장 중 오류가 발생했습니다.");
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>검증 메모 (자유 기록)</Label>
        <Textarea
          rows={3}
          placeholder="예: 8/14 통화. 반찬가게, 하루 40건, 기사 1명. 배송 목록을 매일 아침 엑셀로 만들어 카톡 전달 — 오타/누락이 잦다고 함."
          value={fields.interviewNotes}
          onChange={(e) => setFields((f) => ({ ...f, interviewNotes: e.target.value }))}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Problem (문제)</Label>
          <Textarea rows={2} value={fields.problem} onChange={(e) => setFields((f) => ({ ...f, problem: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Current Solution (현재 해결 방법)</Label>
          <Textarea
            rows={2}
            value={fields.currentSolution}
            onChange={(e) => setFields((f) => ({ ...f, currentSolution: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Frequency (빈도)</Label>
          <Textarea rows={2} value={fields.frequency} onChange={(e) => setFields((f) => ({ ...f, frequency: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Severity (심각도)</Label>
          <Textarea rows={2} value={fields.severity} onChange={(e) => setFields((f) => ({ ...f, severity: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Current Workaround (임시 해결책)</Label>
          <Textarea
            rows={2}
            value={fields.currentWorkaround}
            onChange={(e) => setFields((f) => ({ ...f, currentWorkaround: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Product Fit (제품 적합도)</Label>
          <Textarea rows={2} value={fields.productFit} onChange={(e) => setFields((f) => ({ ...f, productFit: e.target.value }))} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>문제 분류 (해당되는 항목 모두 선택)</Label>
        <div className="flex flex-wrap gap-3">
          {PROBLEM_CATEGORIES.map((category) => (
            <label key={category} className="flex items-center gap-1.5 text-sm text-text-strong">
              <Checkbox checked={categories.includes(category)} onCheckedChange={() => toggleCategory(category)} />
              {category}
            </label>
          ))}
        </div>
      </div>

      <Button size="sm" disabled={isPending} onClick={handleSave}>
        {isPending ? "저장 중..." : "인터뷰 결과 저장"}
      </Button>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-text-strong">{value ?? "-"}</p>
    </div>
  );
}

export function RecruitApplicationDetailDialog({ application }: { application: BetaRecruitApplication }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          상세
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{application.company_name ?? application.contact_name}</DialogTitle>
          <DialogDescription>
            {application.business_type} · {formatKstDateKorean(application.created_at)} 접수
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <span className="text-sm font-medium text-text-strong">진행 상태</span>
            <StatusSelect application={application} />
          </div>

          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-xs font-semibold text-destructive">핵심 문제</p>
            <p className="mt-1 text-sm whitespace-pre-line text-text-strong">
              {application.biggest_pain_point ?? "아직 입력되지 않음 — 인터뷰로 확인이 필요합니다."}
            </p>
          </div>

          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <InfoRow label="업체명" value={application.company_name} />
            <InfoRow label="하루 평균 주문량" value={application.avg_daily_orders} />
            <InfoRow label="주문 채널" value={application.order_channels.join(", ") || null} />
            <InfoRow label="배송 방식" value={application.delivery_method} />
            <InfoRow
              label="직원 수 / 기사 수"
              value={[application.staff_count, application.driver_count].filter(Boolean).join(" / ") || null}
            />
            <InfoRow label="현재 주문 관리 방식" value={application.current_order_management} />
            <InfoRow label="현재 배송/업무 관리 방식" value={application.current_delivery_management} />
            <InfoRow
              label="사용 도구"
              value={
                [application.uses_excel ? "엑셀" : null, application.uses_kakao_sms ? "카카오톡/문자" : null]
                  .filter(Boolean)
                  .join(", ") || "없음"
              }
            />
            <InfoRow
              label="연락처"
              value={`${application.contact_name} · ${application.contact_phone}${application.contact_email ? ` · ${application.contact_email}` : ""}`}
            />
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-3 text-sm font-semibold text-text-strong">인터뷰 결과 기록</p>
            <InterviewForm application={application} />
          </div>

          <details className="rounded-lg border border-border bg-surface p-3">
            <summary className="cursor-pointer text-sm font-medium text-text-strong">인터뷰 질문 가이드 (참고용)</summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
              {INTERVIEW_QUESTIONS.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ol>
          </details>
        </div>
      </DialogContent>
    </Dialog>
  );
}
