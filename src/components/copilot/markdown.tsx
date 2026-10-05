import * as React from "react";

/** Minimal, safe markdown renderer for Copilot answers: paragraphs, lists, tables, bold/italic/code. No HTML injection. */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith("**"))
      out.push(
        <strong key={k} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>,
      );
    else if (tok.startsWith("`"))
      out.push(
        <code key={k} className="rounded bg-fill px-1 py-0.5 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i]
          .trim()
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={`t${i}`} className="my-2 overflow-x-auto rounded-xl border border-line">
          <table className="w-full tabular text-[12.5px]">
            <thead className="bg-fill">
              <tr>
                {head?.map((c, j) => (
                  <th key={j} className="px-3 py-1.5 text-left font-medium">
                    {inline(c, `h${i}${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri} className="border-t border-line">
                  {r.map((c, j) => (
                    <td key={j} className="px-3 py-1.5">
                      {inline(c, `c${i}${ri}${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={`l${i}`} className={ordered ? "my-1.5 list-decimal space-y-1 pl-5" : "my-1.5 list-disc space-y-1 pl-5 marker:text-subtle"}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `li${i}${j}`)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      blocks.push(
        <p key={`h${i}`} className="mt-3 mb-1 font-semibold">
          {inline(heading[1], `hd${i}`)}
        </p>,
      );
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(\||[-*•]\s|\d+[.)]\s|#)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`p${i}`} className="my-1.5 leading-relaxed">
        {inline(para.join(" "), `p${i}`)}
      </p>,
    );
  }
  return <div className="text-[14px]">{blocks}</div>;
}
