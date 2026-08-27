import { listPublishedAnnouncementsAction } from "@/actions/announcements";
import { AnnouncementPublicList } from "@/components/announcements/announcement-public-list";
import { PageHeader } from "@/components/common/page-header";

// 공지 목록은 계속 갱신되므로("게시중" 상태가 실시간으로 바뀔 수 있음) 정적
// 프리렌더 대상이 아니다 — 주문/배송 목록 페이지와 동일한 이유로 dynamic 처리한다.
export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  const announcements = await listPublishedAnnouncementsAction();

  return (
    <div className="space-y-6">
      <PageHeader title="공지사항" description="주문한장의 새로운 기능과 안내사항을 확인하세요." />
      <AnnouncementPublicList announcements={announcements} />
    </div>
  );
}
