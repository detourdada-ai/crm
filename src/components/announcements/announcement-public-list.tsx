import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatKstDateKorean } from "@/lib/utils/kst-date";
import type { Announcement } from "@/types/domain";

export function AnnouncementPublicList({ announcements }: { announcements: Announcement[] }) {
  if (announcements.length === 0) {
    return <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">등록된 공지가 없습니다.</p>;
  }

  return (
    <div className="space-y-2">
      {announcements.map((announcement) => (
        <Link
          key={announcement.id}
          href={`/announcements/${announcement.id}`}
          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-4 transition-colors hover:bg-muted"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Badge variant="outline">{announcement.category}</Badge>
            <span className="min-w-0 truncate text-sm font-medium text-text-strong">{announcement.title}</span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatKstDateKorean(announcement.published_at)}</span>
        </Link>
      ))}
    </div>
  );
}
