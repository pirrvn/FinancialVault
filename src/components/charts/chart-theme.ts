"use client";

import * as React from "react";
import { useTheme } from "next-themes";

export interface ChartTheme {
  fg: string;
  muted: string;
  subtle: string;
  line: string;
  surface: string;
  accent: string;
  chartIn: string;
  chartOut: string;
}

const FALLBACK: ChartTheme = {
  fg: "#1d1d1f",
  muted: "#6e6e73",
  subtle: "#8e8e93",
  line: "rgba(0,0,0,0.08)",
  surface: "#fff",
  accent: "#0071e3",
  chartIn: "#3b7fc4",
  chartOut: "#d0703f",
};

/** SVG presentation attributes can't use var(); resolve the design tokens for the active theme. */
export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  const [theme, setTheme] = React.useState<ChartTheme>(FALLBACK);
  React.useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    setTheme({
      fg: v("--fg"),
      muted: v("--muted"),
      subtle: v("--subtle"),
      line: v("--line"),
      surface: v("--surface"),
      accent: v("--accent"),
      chartIn: v("--chart-in"),
      chartOut: v("--chart-out"),
    });
  }, [resolvedTheme]);
  return theme;
}
