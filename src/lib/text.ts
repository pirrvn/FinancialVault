/** Upper-case, strip accents, collapse whitespace. The canonical form every rule is matched against. */
export function foldText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[  \t\r\n]+/g, " ")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** "CARREFOUR CITY" -> "Carrefour City" (keeps short all-caps tokens like "SNCF", "EDF"). */
export function titleCase(input: string): string {
  return input
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length <= 4 && /^[a-z]+$/.test(w) && !COMMON_WORDS.has(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

const COMMON_WORDS = new Set([
  "the",
  "de",
  "du",
  "la",
  "le",
  "les",
  "des",
  "and",
  "et",
  "city",
  "bio",
  "shop",
  "pay",
  "food",
  "cafe",
  "bar",
  "app",
  "uber",
  "free",
  "home",
  "plus",
  "one",
  "mini",
  "max",
  "go",
  "sas",
  "via",
  "eats",
  "zinc",
  "chez",
  "pret",
  "mart",
  "pain",
  "lime",
  "bolt",
  "dott",
  "alan",
  "port",
  "noe",
  "velo",
  "yoga",
  "lab",
  "spa",
  "gym",
  "tea",
  "wok",
  "sun",
  "sky",
  "box",
  "net",
  "web",
  "art",
  "car",
  "taxi",
  "hall",
  "club",
  "parc",
  "bois",
  "lyon",
  "nice",
  "rue",
  "avenue",
  "maison",
  "cave",
  "vin",
  "pub",
]);
