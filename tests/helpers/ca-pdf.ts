import { PDFDocument, StandardFonts } from "pdf-lib";

export interface CaOp {
  date: string; // DD.MM
  valeur: string; // DD.MM
  label: string[]; // first line + continuation lines
  debit?: string; // "1 150,00"
  credit?: string;
}

/**
 * Builds a PDF laid out like a Crédit Agricole "Relevé de compte": header block, account line,
 * column headers, right-aligned Débit/Crédit amounts, wrapped labels, totals and balances.
 */
export async function buildCaStatementPdf(opts: {
  arrete: string; // "31 Janvier 2025"
  account: string; // "Compte de Dépôt carte n° 12345678901"
  ancien: { date: string; amount: string; side: "créditeur" | "débiteur" };
  nouveau: { date: string; amount: string; side: "créditeur" | "débiteur" };
  ops: CaOp[];
  opsPerPage?: number;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const size = 8.5;
  const X = { date: 40, valeur: 78, label: 118, debitRight: 470, creditRight: 545 };
  const right = (text: string, xr: number, y: number, page: ReturnType<typeof pdf.addPage>) =>
    page.drawText(text, { x: xr - font.widthOfTextAtSize(text, size), y, size, font });

  const perPage = opts.opsPerPage ?? 100;
  const chunks: CaOp[][] = [];
  for (let i = 0; i < opts.ops.length; i += perPage) chunks.push(opts.ops.slice(i, i + perPage));
  if (!chunks.length) chunks.push([]);

  chunks.forEach((ops, pageIndex) => {
    const page = pdf.addPage([595, 842]);
    let y = 800;
    page.drawText("CRÉDIT AGRICOLE", { x: 40, y, size: 12, font: bold });
    y -= 16;
    page.drawText("RELEVÉ DE COMPTE", { x: 40, y, size: 10, font: bold });
    page.drawText(`Date d'arrêté : ${opts.arrete}`, { x: 380, y, size, font });
    y -= 14;
    page.drawText(`Page ${pageIndex + 1} / ${chunks.length}`, { x: 480, y, size, font });
    y -= 22;
    if (pageIndex === 0) {
      page.drawText(opts.account, { x: 40, y, size: 10, font: bold });
      y -= 22;
    }
    // Column headers
    page.drawText("Date", { x: X.date, y: y + 9, size, font: bold });
    page.drawText("opé.", { x: X.date, y, size, font: bold });
    page.drawText("Date", { x: X.valeur, y: y + 9, size, font: bold });
    page.drawText("valeur", { x: X.valeur, y, size, font: bold });
    page.drawText("Libellé des opérations", { x: X.label, y, size, font: bold });
    page.drawText("Débit", { x: X.debitRight - 30, y, size, font: bold });
    page.drawText("Crédit", { x: X.creditRight - 32, y, size, font: bold });
    y -= 18;
    if (pageIndex === 0) {
      page.drawText(`Ancien solde ${opts.ancien.side} au ${opts.ancien.date}`, { x: X.label, y, size, font: bold });
      right(opts.ancien.amount, opts.ancien.side === "créditeur" ? X.creditRight : X.debitRight, y, page);
      y -= 14;
    }
    for (const op of ops) {
      page.drawText(op.date, { x: X.date, y, size, font });
      page.drawText(op.valeur, { x: X.valeur, y, size, font });
      page.drawText(op.label[0], { x: X.label, y, size, font });
      if (op.debit) right(op.debit, X.debitRight, y, page);
      if (op.credit) right(`${op.credit} ¨`, X.creditRight + 8, y, page);
      y -= 10;
      for (const cont of op.label.slice(1)) {
        page.drawText(cont, { x: X.label + 6, y, size, font });
        y -= 10;
      }
      y -= 3;
    }
    if (pageIndex === chunks.length - 1) {
      y -= 6;
      page.drawText("Total des opérations", { x: X.label, y, size, font: bold });
      right("9 999,99", X.debitRight, y, page);
      right("9 999,99", X.creditRight, y, page);
      y -= 14;
      page.drawText(`Nouveau solde ${opts.nouveau.side} au ${opts.nouveau.date}`, { x: X.label, y, size, font: bold });
      right(opts.nouveau.amount, opts.nouveau.side === "créditeur" ? X.creditRight : X.debitRight, y, page);
    }
  });
  return pdf.save();
}

export const SAMPLE_OPS: CaOp[] = [
  { date: "30.12", valeur: "30.12", label: ["PAIEMENT PAR CARTE X4821 MONOPRIX 28/12"], debit: "42,10" },
  { date: "02.01", valeur: "02.01", label: ["VIR SEPA RECU /DE ACME CONSULTING SAS", "/MOTIF SALAIRE JANVIER"], credit: "3 450,00" },
  { date: "03.01", valeur: "03.01", label: ["PRLV SEPA FONCIA LOCATION", "ECH/030125 ID EMETTEUR/FR45ZZZ001122", "MDT/LOY2023"], debit: "1 180,00" },
  { date: "05.01", valeur: "05.01", label: ["PAIEMENT PAR CARTE X4821 CARREFOUR CITY 04/01"], debit: "54,32" },
  { date: "08.01", valeur: "08.01", label: ["PRLV SEPA EDF CLIENTS PARTICULIERS"], debit: "87,45" },
  { date: "12.01", valeur: "12.01", label: ["VIR SEPA EMIS /A LIVRET A N° 0011223344", "/MOTIF EPARGNE"], debit: "400,00" },
  { date: "16.01", valeur: "16.01", label: ["VIR SEPA RECU /DE CPAM PARIS"], credit: "23,10" },
  { date: "20.01", valeur: "20.01", label: ["COTISATION OFFRE GLOBULE"], debit: "2,50" },
  { date: "22.01", valeur: "22.01", label: ["RETRAIT DAB 21/01 CARTE X4821"], debit: "60,00" },
];
// Ancien solde 1 000,00 + 3 473,10 − 1 826,37 = 2 646,73
