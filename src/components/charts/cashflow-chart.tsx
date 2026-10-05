"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import type { MonthPoint } from "@/lib/analytics/summary";
import { monthLabel } from "@/lib/dates";
import { useChartTheme } from "./chart-theme";
import { axisMoney, ChartTooltipCard, Legend } from "./tooltip";

/** Income vs expenses per month, with net cash flow — all on one money axis. */
export function CashflowChart({
  data,
  currency,
  focusMonth,
  onSelectMonth,
}: {
  data: MonthPoint[];
  currency: string;
  focusMonth?: string;
  onSelectMonth?: (m: string) => void;
}) {
  const t = useChartTheme();
  const rows = data.map((p) => ({ ...p, label: monthLabel(p.month) }));
  return (
    <div>
      <div className="mb-3 px-1">
        <Legend
          items={[
            { label: "Income", color: t.chartIn },
            { label: "Expenses", color: t.chartOut },
            { label: "Net", color: t.fg, kind: "line" },
          ]}
        />
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            barGap={2}
            barCategoryGap="28%"
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            onClick={(s) => {
              const idx = typeof s?.activeTooltipIndex === "number" ? s.activeTooltipIndex : Number(s?.activeTooltipIndex);
              if (onSelectMonth && Number.isFinite(idx) && rows[idx]) onSelectMonth(rows[idx].month);
            }}
          >
            <CartesianGrid vertical={false} stroke={t.line} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: t.subtle, fontSize: 11 }} dy={6} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: t.subtle, fontSize: 11 }} tickFormatter={axisMoney(currency)} width={56} />
            <ReferenceLine y={0} stroke={t.line} />
            <Tooltip
              cursor={{ fill: t.line, radius: 8 }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                if (!active || !p) return null;
                return (
                  <ChartTooltipCard
                    title={monthLabel(p.month, "long")}
                    currency={currency}
                    rows={[
                      { label: "Income", valueCents: p.incomeCents, color: t.chartIn },
                      { label: "Expenses", valueCents: p.expenseCents, color: t.chartOut },
                      { label: "Net", valueCents: p.netCents, color: t.fg },
                    ]}
                  />
                );
              }}
            />
            <Bar
              dataKey="incomeCents"
              name="Income"
              fill={t.chartIn}
              radius={[4, 4, 0, 0]}
              maxBarSize={18}
              style={{ cursor: onSelectMonth ? "pointer" : undefined }}
              fillOpacity={1}
              isAnimationActive={false}
              shape={(props: unknown) => <FocusBar {...(props as BarShape)} focus={focusMonth} />}
            />
            <Bar
              dataKey="expenseCents"
              name="Expenses"
              fill={t.chartOut}
              radius={[4, 4, 0, 0]}
              maxBarSize={18}
              style={{ cursor: onSelectMonth ? "pointer" : undefined }}
              isAnimationActive={false}
              shape={(props: unknown) => <FocusBar {...(props as BarShape)} focus={focusMonth} />}
            />
            <Line
              dataKey="netCents"
              name="Net"
              stroke={t.fg}
              strokeWidth={2}
              dot={{ r: 3, fill: t.surface, stroke: t.fg, strokeWidth: 2 }}
              activeDot={{ r: 4.5, stroke: t.surface, strokeWidth: 2, fill: t.fg }}
              type="monotone"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface BarShape {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  payload: { month: string };
}

/** Rounded bar anchored to the baseline; months other than the focused one recede. */
function FocusBar({ x, y, width, height, fill, payload, focus }: BarShape & { focus?: string }) {
  if (!height || height <= 0) return null;
  const r = Math.min(4, width / 2, height);
  const dim = focus && payload.month !== focus;
  return (
    <path
      d={`M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`}
      fill={fill}
      opacity={dim ? 0.45 : 1}
      style={{ transition: "opacity 200ms" }}
    />
  );
}
