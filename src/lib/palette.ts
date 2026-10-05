/** Muted, desaturated category tones that read well on both light and dark surfaces. */
export const PALETTE: Record<string, string> = {
  sage: "#8FA98A",
  terracotta: "#C98B6B",
  slate: "#7D8CA3",
  stone: "#A39A8E",
  steel: "#6F8FA8",
  lavender: "#9D93C4",
  rose: "#C7909C",
  mint: "#7FB5A3",
  plum: "#A07AA6",
  ocean: "#5E9BB8",
  ochre: "#C4A15A",
  blush: "#D3A0A8",
  fog: "#9AA5AE",
  graphite: "#7A7A80",
  clay: "#B5836F",
  sand: "#C2AE8C",
  coral: "#D98E7E",
  peach: "#DDA77F",
  moss: "#8C9A63",
  ash: "#A0A0A5",
  emerald: "#4FA87A",
  teal: "#4E9E9C",
  jade: "#5FAF8F",
  seafoam: "#7CBDB0",
  mist: "#9BB0C1",
  indigo: "#7A86C2",
  wine: "#A8687A",
  espresso: "#9B7B66",
  honey: "#C9A25A",
};

export const PALETTE_KEYS = Object.keys(PALETTE);

export function colorOf(token: string | undefined): string {
  return (token && PALETTE[token]) || PALETTE.ash;
}
