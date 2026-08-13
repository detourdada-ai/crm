import Link from "next/link";
import { ArrowRight } from "lucide-react";

export interface TodayTask {
  label: string;
  count: number;
  cta: string;
  href: string;
}

/** "오늘 왜 대시보드에 들어왔는지"에 바로 답하는 할 일 목록 — KPI 숫자보다 한 단계 더 구체적인, 클릭하면 바로 처리하러 갈 수 있는 목록. */
export function TodayTasks({ tasks }: { tasks: TodayTask[] }) {
  const active = tasks.filter((t) => t.count > 0);

  if (active.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">오늘 처리할 일이 없습니다.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {active.map((task) => (
        <li key={task.label}>
          <Link href={task.href} className="flex items-center justify-between gap-3 py-3 text-sm hover:text-primary">
            <span className="text-text-strong">
              {task.label} <span className="font-semibold">{task.count}건</span>
            </span>
            <span className="flex shrink-0 items-center gap-1 font-medium text-primary">
              {task.cta}
              <ArrowRight className="size-3.5" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
