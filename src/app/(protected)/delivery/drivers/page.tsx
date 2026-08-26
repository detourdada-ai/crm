import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { DriverLocationsView } from "@/components/delivery/driver-locations-view";

/**
 * CPO 지시(2026-08): 기사위치 화면을 배송관리 팝업에서 분리한 전용 페이지 —
 * 배송관리(/delivery)에서 새 탭으로 열어 계속 띄워두고 60초 자동 갱신으로
 * 기사 동선을 확인할 수 있게 한다. 데이터 조회/지도 표시 로직은
 * DriverLocationsView(기존 DriverLocationsDialog에서 그대로 옮김)가 담당한다.
 */
export default function DriverLocationsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="기사 위치"
        description="지금 운행 중인 기사들의 위치와 운행상태를 확인합니다. 기사가 앱에서 마지막으로 남긴 참고용 위치와, 오늘 배송의 완료/미완료 현황입니다."
        action={
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/delivery">
              <ArrowLeft className="size-4" />
              배송관리로
            </Link>
          </Button>
        }
      />
      <DriverLocationsView />
    </div>
  );
}
