import { CheckCircle2 } from "lucide-react";
import { listPendingDuplicatesAction } from "@/actions/duplicates";
import { DuplicateReviewCard } from "@/components/duplicates/duplicate-review-card";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";

export default async function DuplicatesPage() {
  const views = await listPendingDuplicatesAction();

  return (
    <div className="space-y-6">
      <PageHeader
        title="동일인 검토"
        description="동일인 후보는 자동으로 병합되지 않습니다. 아래 내용을 확인하고 직접 결정해주세요."
      />

      {views.length === 0 ? (
        // Phase 6 STEP10: 검토할 항목이 없는 것은 "비어서 문제"가 아니라
        // "정리할 게 없는 정상 상태"이므로 체크 아이콘 + 긍정적 문구로 표현한다.
        <EmptyState
          icon={CheckCircle2}
          title="검토할 동일인 후보가 없습니다."
          description="현재 모든 고객 정보가 정리된 상태입니다. 새로운 주문이 들어오면 필요할 때 자동으로 다시 감지됩니다."
        />
      ) : (
        <div className="space-y-4">
          {views.map((view) => (
            <DuplicateReviewCard key={view.candidate.id} view={view} />
          ))}
        </div>
      )}
    </div>
  );
}
