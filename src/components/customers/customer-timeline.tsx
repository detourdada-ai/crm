import { ShoppingBag, Phone, MapPin, GitMerge, StickyNote, Info } from "lucide-react";
import { formatDateTime } from "@/lib/constants/order-status";
import type { TimelineEvent, TimelineEventType } from "@/lib/services/timeline.service";
import { cn } from "@/lib/utils";

const ICONS: Record<TimelineEventType, typeof ShoppingBag> = {
  order: ShoppingBag,
  phone_change: Phone,
  address_change: MapPin,
  merge: GitMerge,
  memo_change: StickyNote,
  info_change: Info,
};

const ICON_STYLES: Record<TimelineEventType, string> = {
  order: "bg-info-soft text-info",
  phone_change: "bg-warning-soft text-warning",
  address_change: "bg-success-soft text-success",
  merge: "bg-muted text-muted-foreground",
  memo_change: "bg-muted text-muted-foreground",
  info_change: "bg-muted text-muted-foreground",
};

export function CustomerTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">기록된 이벤트가 없습니다.</p>;
  }

  return (
    <ul className="space-y-0">
      {events.map((event, index) => {
        const Icon = ICONS[event.type];
        return (
          <li key={event.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", ICON_STYLES[event.type])}>
                <Icon className="size-4" />
              </div>
              {index < events.length - 1 ? <div className="w-px flex-1 bg-border" /> : null}
            </div>
            <div className="flex-1 pb-6">
              <p className="text-sm font-medium">{event.title}</p>
              <p className="text-sm text-muted-foreground">{event.description}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDateTime(event.occurredAt)}
                {event.performedBy ? ` · ${event.performedBy}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
