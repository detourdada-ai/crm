import Link from "next/link";
import { ArrowRight } from "lucide-react";

export interface TodayTask {
  label: string;
  count: number;
  cta: string;
  href: string;
}

/**
 * "오늘 왜 대시보드에 들어왔는지"에 바로 답하는 할 일 타일 — 숫자를 가장
 * 먼저 보여주고 그 아래 무엇을 해야 하는지, 바로 처리하러 가는 링크를
 * 순서대로 쌓아 보여준다(숫자 → 설명 → 바로가기).
 */
export function TodayTasks({ tasks }: { tasks: TodayTask[] }) {
  const active = tasks.filter((t) => t.count > 0);

  if (active.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">오늘 처리할 일이 없습니다.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {active.map((task) => (
        <Link
          key={task.label}
          href={task.href}
          className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-accent/30"
        >
          <span className="text-2xl font-bold text-text-strong">{task.count}</span>
          <span className="text-sm text-muted-foreground">{task.label}</span>
          <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary">
            {task.cta}
            <ArrowRight className="size-3" />
          </span>
        </Link>
      ))}
    </div>
  );
}
