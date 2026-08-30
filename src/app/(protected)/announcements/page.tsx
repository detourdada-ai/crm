import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getLatestPublishedAnnouncementAction } from "@/actions/announcements";
import { PageHeader } from "@/components/common/page-header";
import { formatKstDateKorean } from "@/lib/utils/kst-date";

// 공지는 실시간으로 바뀔 수 있으므로("게시중" 상태 전환) 정적 프리렌더 대상이
// 아니다 — 주문/배송 목록 페이지와 동일한 이유로 dynamic 처리한다.
export const dynamic = "force-dynamic";

/**
 * STEP11-14(CPO 작업지시, 2026-08-31): 공지사항 화면은 "게시판"이 아니라
 * "지금 알아야 할 최신 안내 1개"만 보여준다 — 과거 공지가 쌓여 보이지
 * 않도록 목록이 아니라 최신 공지 본문을 이 화면에서 바로 보여준다.
 */
export default async function AnnouncementsPage() {
  const announcement = await getLatestPublishedAnnouncementAction();

  return (
    <div className="space-y-6">
      <PageHeader title="공지사항" description="주문한장의 새로운 기능과 안내사항을 확인하세요." />

      {!announcement ? (
        <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          등록된 공지가 없습니다.
        </p>
      ) : (
        <Card>
          <CardHeader className="space-y-2">
            <Badge variant="outline" className="w-fit">
              {announcement.category}
            </Badge>
            <h1 className="text-xl font-semibold text-text-strong">{announcement.title}</h1>
            <p className="text-xs text-muted-foreground">{formatKstDateKorean(announcement.published_at)}</p>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-line text-text-strong">{announcement.body}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
