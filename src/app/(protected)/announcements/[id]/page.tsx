import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
      </Card>
    </div>
  );
}
