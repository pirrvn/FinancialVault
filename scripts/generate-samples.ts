/**
 * Generates 12 months of realistic demo statements in the exact bank export formats:
 *   samples/revolut-statement.csv           (Revolut, comma CSV, ISO dates)
 *   samples/credit-agricole-<month>.csv     (Crédit Agricole, ; CSV, Windows-1252, DD/MM/YYYY, one file per month)
 * Usage: npx tsx scripts/generate-samples.ts [endMonth=YYYY-MM]
 */
import { mkdirSync, writeFileSync } from "node:fs";

let seed = 42;
const rand = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const between = (a: number, b: number) => a + rand() * (b - a);
const pad = (n: number) => String(n).padStart(2, "0");

const end = process.argv[2] ?? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const [ey, em] = end.split("-").map(Number);
const months = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(ey, em - 1 - (11 - i), 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, days: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() };
});

// ---------- Crédit Agricole: salary, rent, bills, groceries, some obscure local merchants ----------
type CaRow = { day: number; label: string; amount: number };
const caFiles: { name: string; content: string }[] = [];
let caBalance = 6200;
months.forEach(({ y, m, days }, idx) => {
  const rows: CaRow[] = [];
  rows.push({ day: 1, label: `VIR SEPA RECU /DE ACME CONSULTING SAS /MOTIF SALAIRE ${pad(m)}/${y}`, amount: 3450 + (idx >= 8 ? 150 : 0) });
  rows.push({ day: 3, label: `PRLV SEPA FONCIA LOCATION\nECH/${pad(3)}${pad(m)}${String(y).slice(2)} ID EMETTEUR/FR45ZZZ001122 MDT/LOY2023`, amount: -1180 });
  rows.push({ day: 5, label: "PRLV SEPA FREE MOBILE\nMDT/FM0001", amount: -19.99 });
  rows.push({ day: 6, label: "PRLV SEPA FREE TELECOM FREEBOX", amount: -29.99 });
  rows.push({ day: 8, label: "PRLV SEPA EDF CLIENTS PARTICULIERS", amount: -round(between(62, 118)) });
  rows.push({ day: 10, label: "PRLV SEPA MAIF ASSURANCE HABITATION", amount: -24.5 });
  rows.push({ day: 12, label: "PRLV SEPA ALAN SA MUTUELLE", amount: -38 });
  rows.push({ day: 15, label: "VIR SEPA EMIS /A LIVRET A /MOTIF EPARGNE", amount: -400 });
  rows.push({ day: 20, label: "COTISATION OFFRE GLOBULE", amount: -2.5 });
  rows.push({ day: 2, label: `VIR SEPA EMIS /A REVOLUT /MOTIF TOP UP`, amount: -600 });
  for (let i = 0; i < 6; i++) {
    const shop = pick(["CARREFOUR CITY", "MONOPRIX", "FRANPRIX", "BIOCOOP", "LIDL", "PICARD"]);
    const d = Math.ceil(between(1, days));
    rows.push({ day: d, label: `PAIEMENT PAR CARTE X4821 ${shop} ${pad(Math.max(1, d - 1))}/${pad(m)}`, amount: -round(between(14, 92)) });
  }
  for (let i = 0; i < 2; i++) {
    const d = Math.ceil(between(1, days));
    rows.push({
      day: d,
      label: `PAIEMENT PAR CARTE X4821 ${pick(["PHARMACIE DU MARCHE", "BOULANGERIE MAISON LAMBERT", "SARL LE COMPTOIR DE NOE", "TABAC PRESSE DU PORT"])} ${pad(d)}/${pad(m)}`,
      amount: -round(between(4, 38)),
    });
  }
  if (idx % 4 === 1) rows.push({ day: 18, label: `PAIEMENT PAR CARTE X4821 ATELIER VELO ZORBLAX 17/${pad(m)}`, amount: -round(between(35, 140)) });
  if (idx % 3 === 0) rows.push({ day: 22, label: "RETRAIT DAB 21/" + pad(m) + " CARTE X4821", amount: -60 });
  if (idx === 6) rows.push({ day: 14, label: "VIR SEPA RECU /DE DGFIP /MOTIF REMBOURSEMENT IMPOT", amount: 312 });
  if (idx === 9) rows.push({ day: 25, label: "PAIEMENT PAR CARTE X4821 DARTY GRANDS MAGASINS 24/" + pad(m), amount: -649 });
  if (idx % 2 === 0) rows.push({ day: 16, label: "VIR SEPA RECU /DE CPAM PARIS /MOTIF REMB SOINS", amount: round(between(18, 55)) });
  rows.sort((a, b) => a.day - b.day);
  const lines = rows.map(
    (r) => `${pad(Math.min(r.day, days))}/${pad(m)}/${y};"${r.label}\n";${r.amount < 0 ? fr(-r.amount) : ""};${r.amount > 0 ? fr(r.amount) : ""};`,
  );
  caBalance += rows.reduce((a, r) => a + r.amount, 0);
  const asOf = `${pad(days)}/${pad(m)}/${y}`;
  const content = [
    `Téléchargement du ${asOf};`,
    "",
    "M. CAMILLE MARTIN;",
    "Compte de Dépôt carte n° 00012345678;",
    `Solde au ${asOf} ${fr(caBalance)} €`,
    ";",
    `Liste des opérations du compte entre le 01/${pad(m)}/${y} et le ${asOf};`,
    "",
    "Date;Libellé;Débit euros;Crédit euros;",
    ...lines,
    "",
  ].join("\r\n");
  caFiles.push({ name: `credit-agricole-${y}-${pad(m)}.csv`, content });
});

// ---------- Revolut: daily card spending, subscriptions, travel ----------
const rev: string[] = ["Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance"];
let revBalance = 340;
const push = (type: string, date: string, desc: string, amount: number, fee = 0, state = "COMPLETED") => {
  if (state === "COMPLETED") revBalance = round(revBalance + amount - fee);
  rev.push(
    `${type},Current,${date} 10:${pad(Math.floor(rand() * 59))}:00,${state === "COMPLETED" ? `${date} 12:00:00` : ""},${desc},${amount.toFixed(2)},${fee.toFixed(2)},EUR,${state},${state === "COMPLETED" ? revBalance.toFixed(2) : ""}`,
  );
};
months.forEach(({ y, m, days }, idx) => {
  const day = (d: number) => `${y}-${pad(m)}-${pad(Math.min(d, days))}`;
  const events: [number, () => void][] = [];
  events.push([2, () => push("TOPUP", day(2), "Top-Up by *4821", 600)]);
  events.push([4, () => push("CARD_PAYMENT", day(4), "Netflix", idx >= 7 ? -15.99 : -13.49)]);
  events.push([7, () => push("CARD_PAYMENT", day(7), "Spotify", -11.12)]);
  events.push([9, () => push("CARD_PAYMENT", day(9), "Disney Plus", -9.99)]);
  events.push([11, () => push("CARD_PAYMENT", day(11), "Basic-Fit", -29.99)]);
  events.push([13, () => push("CARD_PAYMENT", day(13), "iCloud+", -2.99)]);
  if (idx < 7) events.push([20, () => push("CARD_PAYMENT", day(20), "Deezer", -11.99)]);
  for (let i = 0; i < 9; i++) {
    const d = Math.ceil(between(1, days));
    const [desc, lo, hi] = pick<[string, number, number]>([
      ["Uber", 9, 28],
      ["Uber Eats", 18, 42],
      ["Deliveroo", 17, 39],
      ["Le Petit Zinc", 22, 68],
      ["Starbucks", 4, 9],
      ["Pret A Manger", 8, 15],
      ["RATP", 2.15, 2.15],
      ["Lime", 3, 8],
      ["Fnac", 15, 80],
      ["Amazon", 12, 95],
      ["Zara", 30, 90],
      ["Chez Bébert Bistrot", 19, 45],
    ]);
    events.push([d, () => push("CARD_PAYMENT", day(d), desc, -round(between(lo, hi)))]);
  }
  if (idx === 4) events.push([17, () => push("CARD_PAYMENT", day(17), "Booking.com", -486)]);
  if (idx === 4) events.push([18, () => push("CARD_PAYMENT", day(18), "Ryanair", -138.4)]);
  if (idx === 10) events.push([12, () => push("CARD_PAYMENT", day(12), "Kobalt Studio Yoga", -95)]);
  if (idx === 3) events.push([28, () => push("ATM", day(28), "Cash at Distributeur", -100, 2)]);
  events.push([25, () => push("CARD_PAYMENT", day(25), "Pending Coffee", -3.5, 0, "PENDING")]);
  events.sort((a, b) => a[0] - b[0]).forEach(([, f]) => f());
});

function round(n: number) {
  return Math.round(n * 100) / 100;
}
function fr(n: number) {
  const [i, d] = n.toFixed(2).split(".");
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${d}`;
}

mkdirSync("samples", { recursive: true });
writeFileSync("samples/revolut-statement.csv", rev.join("\n") + "\n");
/** Windows-1252, like real Crédit Agricole exports (Latin-1 plus "€" at 0x80). */
const cp1252 = (text: string) => Buffer.from([...text].map((ch) => (ch === "€" ? 0x80 : ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 0x3f)));
for (const f of caFiles) writeFileSync(`samples/${f.name}`, cp1252(f.content));
console.log(`Wrote samples/revolut-statement.csv and ${caFiles.length} Crédit Agricole monthly files ending ${end}.`);
