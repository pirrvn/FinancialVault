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

export interface ModernOp {
  date: string; // DD.MM
  valeur: string;
  type: "Carte" | "Virement" | "Prlv" | "Cotis";
  label: string; // text after the type word
  cardDate?: string; // "11/04" printed as its own item on card lines
  debit?: string;
  credit?: string;
}

/**
 * Same geometry as current Crédit Agricole PDFs (2026): two-line "Date / opé." headers, a tick-box
 * column ("þ" header, "¨" marks often 1pt off the row), the type word ("Carte", "Virement") as its own
 * item, card dates as separate items, and a "(suite)" header on following pages.
 */
export async function buildModernCaStatementPdf(opts: {
  arrete: string;
  holder: string;
  accountNumber: string;
  ancien: { date: string; amount: string };
  nouveau: { date: string; amount: string };
  ops: ModernOp[];
  opsPerPage?: number;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const size = 7.5;
  const right = (page: ReturnType<typeof pdf.addPage>, text: string, xr: number, y: number) =>
    page.drawText(text, { x: xr - font.widthOfTextAtSize(text, size), y, size, font });
  const perPage = opts.opsPerPage ?? 24;
  const chunks: ModernOp[][] = [];
  for (let i = 0; i < opts.ops.length; i += perPage) chunks.push(opts.ops.slice(i, i + perPage));
  chunks.forEach((ops, p) => {
    const page = pdf.addPage([595, 842]);
    page.drawText("RELEVE DE COMPTES EN EUROS N° 005", { x: 335, y: 832, size, font });
    page.drawText(`Date d'arrêté : ${opts.arrete}`, { x: 425, y: 818, size, font });
    let y = 760;
    if (p === 0) {
      page.drawText("SYNTHESE", { x: 241, y: 573, size, font });
      page.drawText(`Compte Chèque n° ${opts.accountNumber}`, { x: 241, y: 547, size, font });
      right(page, `+ ${opts.nouveau.amount}`, 545, 546);
      y = 488;
    }
    page.drawText(`${opts.holder} - Compte Chèque n° ${opts.accountNumber}${p ? " (suite)" : ""}`, { x: 14, y, size, font });
    y -= 27;
    page.drawText("Date", { x: 20, y, size, font });
    page.drawText("Date", { x: 51, y, size, font });
    page.drawText("Libellé des opérations", { x: 79, y: y - 4, size, font });
    page.drawText("Débit", { x: 437, y: y - 4, size, font });
    page.drawText("Crédit", { x: 519, y: y - 4, size, font });
    page.drawText("þ", { x: 551, y: y - 4, size, font });
    page.drawText("opé.", { x: 21, y: y - 8, size, font });
    page.drawText("valeur", { x: 48, y: y - 8, size, font });
    y -= 25;
    if (p === 0) {
      page.drawText(`Ancien solde créditeur au ${opts.ancien.date}`, { x: 206, y, size, font });
      right(page, opts.ancien.amount, 544, y + 1);
      y -= 16;
    }
    ops.forEach((op, i) => {
      // Printer sorting code in the left margin, on the same baseline as the page's first operation.
      if (i === 0 && p > 0) page.drawText("001303", { x: 6, y: y + 1, size: 5, font });
      page.drawText(op.date, { x: 19, y, size, font });
      page.drawText(op.valeur, { x: 50, y, size, font });
      page.drawText(op.type, { x: 79, y, size, font });
      page.drawText(op.label, { x: op.type === "Virement" ? 123 : 117, y, size, font });
      if (op.cardDate) page.drawText(op.cardDate, { x: 232, y, size, font });
      if (op.debit) right(page, op.debit, 459, y);
      if (op.credit) right(page, op.credit, 544, y);
      page.drawText("¨", { x: 551, y: y + (i % 2 ? 1 : 0), size, font });
      y -= 12;
    });
    if (p === chunks.length - 1) {
      y -= 8;
      page.drawText("Total des opérations", { x: 206, y, size, font });
      y -= 14;
      page.drawText(`Nouveau solde créditeur au ${opts.nouveau.date}`, { x: 206, y, size, font });
      right(page, opts.nouveau.amount, 544, y + 1);
    }
    page.drawText(`Page ${p + 1} /`, { x: 271, y: 40, size, font });
    page.drawText(String(chunks.length), { x: 313, y: 41, size, font });
  });
  return pdf.save();
}

export const MODERN_OPS: ModernOp[] = [
  { date: "07.04", valeur: "08.04", type: "Cotis", label: "** Offre Essentiel", debit: "3,00" },
  { date: "12.04", valeur: "12.04", type: "Virement", label: "Vir Inst Wero de Jean Dupont", credit: "20,00" },
  { date: "13.04", valeur: "13.04", type: "Carte", label: "X1111 Intermarche Paris", cardDate: "11/04", debit: "11,04" },
  { date: "13.04", valeur: "13.04", type: "Carte", label: "X1111 Le Bar Du Coin Paris", cardDate: "12/04", debit: "19,50" },
  { date: "14.04", valeur: "14.04", type: "Carte", label: "X1111 Allianz Paris La Def 13/04", debit: "50,00" },
  { date: "14.04", valeur: "14.04", type: "Carte", label: "X1111 Uber * Eats Pending", cardDate: "12/04", debit: "19,16" },
  { date: "17.04", valeur: "17.04", type: "Virement", label: "Wero vers Marie Martin", debit: "75,00" },
  { date: "27.04", valeur: "27.04", type: "Carte", label: "X1111 MONOP4801 Paris", cardDate: "24/04", debit: "4,50" },
  { date: "28.04", valeur: "28.04", type: "Virement", label: "Acme Corp A6126108-00115000022026000000000274PAIE0426", credit: "1 028,64" },
  { date: "28.04", valeur: "28.04", type: "Virement", label: "Vir Inst vers Jean Revolut", debit: "500,00" },
  { date: "29.04", valeur: "29.04", type: "Carte", label: "X1111 Maxicoffee Idf Gones 28/04", debit: "0,80" },
  { date: "06.05", valeur: "06.05", type: "Prlv", label: "Prixtel", debit: "7,99" },
];
// 1 000,00 − 3,00 + 20,00 − 11,04 − 19,50 − 50,00 − 19,16 − 75,00 − 4,50 + 1 028,64 − 500,00 − 0,80 − 7,99 = 1 357,65
