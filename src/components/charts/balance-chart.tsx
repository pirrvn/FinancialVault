"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useChartTheme } from "./chart-theme";
import { axisMoney, ChartTooltipCard } from "./tooltip";

export function BalanceChart({ data, currency }: { data: { date: string; balanceCents: number }[]; currency: string }) {
  const t = useChartTheme();
  const fmtDate = (d: string, long = false) =>
    new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: long ? "numeric" : undefined, timeZone: "UTC" });
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={t.accent} stopOpacity={0.22} />
              <stop offset="100%" stopColor={t.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={t.line} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tick={{ fill: t.subtle, fontSize: 11 }}
            tickFormatter={(d) => fmtDate(d)}
            minTickGap={48}
            dy={6}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: t.subtle, fontSize: 11 }}
            tickFormatter={axisMoney(currency)}
            width={56}
            domain={["auto", "auto"]}
          />
          <Tooltip
            cursor={{ stroke: t.subtle, strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as { date: string; balanceCents: number } | undefined;
              if (!active || !p) return null;
              return (
                <ChartTooltipCard
                  title={fmtDate(p.date, true)}
                  currency={currency}
                  rows={[{ label: "Balance", valueCents: p.balanceCents, color: t.accent }]}
                />
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="balanceCents"
            stroke={t.accent}
            strokeWidth={2}
            fill="url(#balanceFill)"
            activeDot={{ r: 4.5, stroke: t.surface, strokeWidth: 2, fill: t.accent }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
