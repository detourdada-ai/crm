import { Truck } from "lucide-react";
import { CardSkeleton, TableSkeleton } from "@/components/common/page-skeleton";

/**
 * P15-A: 배송관리는 이제 조회 시 그룹을 재계산하지 않으므로(page.tsx 참고)
 * 이 로딩은 순수 조회 대기 상태만 나타낸다 — "배송그룹을 계산하고
 * 있습니다" 같은, 더 이상 사실이 아닌 문구를 쓰지 않는다(CPO 방침, 로딩
 * 메시지는 실제 수행 작업과 일치해야 함). 재계산이 실제로 도는 순간(주문
 * 저장/Excel 등록 완료)의 문구는 각 화면의 결과 토스트/요약에서 별도로
 * 다룬다.
 */
export default function DeliveryLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
        <Truck className="size-5 shrink-0 text-primary" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-text-strong">오늘의 배송을 준비하고 있습니다</p>
          <p className="text-xs text-muted-foreground">배송지역과 배송정보를 정리하고 있습니다.</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      <TableSkeleton />
    </div>
  );
}
