import Papa from "papaparse";

/** Decode an uploaded file. French bank exports are frequently Windows-1252, not UTF-8. */
export function decodeStatement(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

/** Sniff the delimiter from the first lines that look tabular. */
export function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).slice(0, 30);
  const score = (d: string) => lines.reduce((acc, l) => acc + (l.split(d).length - 1), 0);
  return [";", ",", "\t"].sort((a, b) => score(b) - score(a))[0];
}

export function parseRows(text: string, delimiter = sniffDelimiter(text)): string[][] {
  const result = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: "greedy" });
  return result.data.map((row) => row.map((c) => (c ?? "").trim()));
}
