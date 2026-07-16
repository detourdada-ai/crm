import { UserSearch } from "lucide-react";
import { listPendingDuplicatesAction } from "@/actions/duplicates";
import { DuplicateReviewCard } from "@/components/duplicates/duplicate-review-card";

export default async function DuplicatesPage() {
  const views = await listPendingDuplicatesAction();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">동일인 검토</h1>
        <p className="text-sm text-muted-foreground">
          동일인 후보는 자동으로 병합되지 않습니다. 아래 내용을 확인하고 직접 결정해주세요.
        </p>
      </div>

      {views.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-16 text-center text-muted-foreground">
          <UserSearch className="size-8" />
          <p>검토가 필요한 동일인 후보가 없습니다.</p>
        </div>
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
