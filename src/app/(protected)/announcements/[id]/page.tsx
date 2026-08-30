import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { getAnnouncementAction } from "@/actions/announcements";
import { BackButton } from "@/components/common/back-button";
import { formatKstDateKorean } from "@/lib/utils/kst-date";

export const dynamic = "force-dynamic";

export default async function AnnouncementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const announcement = await getAnnouncementAction(id);
  if (!announcement) notFound();

  return (
    <div className="space-y-6">
      <BackButton fallbackHref="/announcements" />

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{announcement.category}</Badge>
            {announcement.status === "종료" ? <Badge variant="outline">종료된 공지</Badge> : null}
          </div>
          <h1 className="text-xl font-semibold text-text-strong">{announcement.title}</h1>
          <p className="text-xs text-muted-foreground">{formatKstDateKorean(announcement.published_at)}</p>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-line text-text-strong">{announcement.body}</p>
        </CardContent>
        {/* STEP11-14(CPO 작업지시): 팝업의 "자세히 보기"로 곧장 이 상세로 들어온
            경우 상단 BackButton(router.back())은 방문 이력에 따라 공지사항이
            아닌 다른 화면으로 돌아갈 수 있다 — 항상 공지사항 화면으로 갈 수
            있는 링크를 본문 하단에 별도로 둔다. */}
        <CardFooter>
          <Link href="/announcements" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-text-strong hover:underline">
            <ArrowLeft className="size-3.5" />
            공지사항으로
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
