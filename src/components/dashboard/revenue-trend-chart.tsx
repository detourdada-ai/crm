"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function formatMonthLabel(month: string): string {
  const [, m] = month.split("-");
  return `${Number(m)}월`;
}

function formatCompactCurrency(value: number): string {
  if (value >= 10000) return `${Math.round(value / 10000)}만`;
  return String(value);
}

export function RevenueTrendChart({ data }: { data: { month: string; revenue: number }[] }) {
  const chartData = data.map((d) => ({ ...d, label: formatMonthLabel(d.month) }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
          <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={formatCompactCurrency} width={40} />
          <Tooltip
            formatter={(value) => [`${Number(value).toLocaleString("ko-KR")}원`, "매출"]}
            labelFormatter={(label) => label}
          />
          <Bar dataKey="revenue" radius={[4, 4, 0, 0]} className="fill-primary" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
