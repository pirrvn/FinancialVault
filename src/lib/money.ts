/**
 * Parse a bank amount string into integer cents.
 * Handles "1234.56", "-12,50", "1 234,56", "1.234,56", "1,234.56", "+3,00 €", and non-breaking spaces.
 * Returns null for empty / unparseable values.
 */
export function parseAmountToCents(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw * 100) : null;
  let s = raw.replace(/[\s  €$£]|EUR|USD|GBP/gi, "").trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever separator comes last is the decimal separator.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimals = s.length - lastComma - 1;
    const commaCount = (s.match(/,/g) ?? []).length;
    // "1,234" with exactly 3 decimals and >1 groups is ambiguous; French banks use comma decimals, so prefer that.
    s = commaCount > 1 && decimals === 3 ? s.replace(/,/g, "") : s.replace(/,/g, ".");
  } else if (lastDot >= 0) {
    const dotCount = (s.match(/\./g) ?? []).length;
    if (dotCount > 1) s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [intPart, fracPart = ""] = s.split(".");
  const cents = Number(intPart) * 100 + Number((fracPart + "00").slice(0, 2)) + (Number(fracPart[2] ?? 0) >= 5 ? 1 : 0);
  return negative ? -cents : cents;
}

export function formatMoney(cents: number, currency = "EUR", opts: { compact?: boolean; sign?: boolean; decimals?: boolean } = {}): string {
  const value = cents / 100;
  const fmt = new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    notation: opts.compact ? "compact" : "standard",
    minimumFractionDigits: opts.compact || opts.decimals === false ? 0 : 2,
    maximumFractionDigits: opts.compact ? 1 : opts.decimals === false ? 0 : 2,
    signDisplay: opts.sign ? "exceptZero" : "auto",
  });
  return fmt.format(value);
}

export function formatPercent(ratio: number, digits = 0): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}
