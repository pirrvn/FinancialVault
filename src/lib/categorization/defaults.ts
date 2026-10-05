export type Kind = "EXPENSE" | "INCOME" | "TRANSFER";

export interface DefaultCategory {
  name: string;
  kind: Kind;
  color: string; // palette token, see lib/palette.ts
  icon: string; // lucide icon name, see components/category-icon.tsx
  description: string; // given to the AI categorizer
}

/** Category names referenced by code. Changing these requires a data migration. */
export const FALLBACK_EXPENSE = "Miscellaneous";
export const FALLBACK_INCOME = "Other Income";
export const TRANSFER_CATEGORY = "Transfers";

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: "Groceries", kind: "EXPENSE", color: "sage", icon: "ShoppingBasket", description: "Supermarkets, food stores, bakeries, markets" },
  { name: "Dining Out", kind: "EXPENSE", color: "terracotta", icon: "UtensilsCrossed", description: "Restaurants, cafés, bars, fast food, food delivery" },
  {
    name: "Transport",
    kind: "EXPENSE",
    color: "slate",
    icon: "TramFront",
    description: "Public transit, ride hailing, taxis, fuel, parking, tolls, car rental, bikes/scooters",
  },
  { name: "Housing", kind: "EXPENSE", color: "stone", icon: "House", description: "Rent, mortgage payments, property fees, home maintenance" },
  { name: "Utilities", kind: "EXPENSE", color: "steel", icon: "Plug", description: "Electricity, gas, water, internet, mobile phone plans" },
  { name: "Subscriptions", kind: "EXPENSE", color: "lavender", icon: "Repeat", description: "Streaming, software, SaaS, memberships, cloud storage" },
  { name: "Shopping", kind: "EXPENSE", color: "rose", icon: "ShoppingBag", description: "Clothing, electronics, online marketplaces, home goods" },
  { name: "Health", kind: "EXPENSE", color: "mint", icon: "HeartPulse", description: "Pharmacy, doctors, dentists, opticians, mutuelle co-pays" },
  { name: "Entertainment", kind: "EXPENSE", color: "plum", icon: "Ticket", description: "Cinema, concerts, events, games, hobbies" },
  { name: "Travel", kind: "EXPENSE", color: "ocean", icon: "Plane", description: "Flights, trains for trips, hotels, holiday rentals" },
  { name: "Education", kind: "EXPENSE", color: "ochre", icon: "GraduationCap", description: "Courses, books, tuition, school fees" },
  { name: "Personal Care", kind: "EXPENSE", color: "blush", icon: "Sparkles", description: "Hairdresser, beauty, gym, wellness" },
  { name: "Insurance", kind: "EXPENSE", color: "fog", icon: "ShieldCheck", description: "Home, car, health, life insurance premiums" },
  { name: "Taxes", kind: "EXPENSE", color: "graphite", icon: "Landmark", description: "Income tax, property tax, government fees" },
  { name: "Fees & Charges", kind: "EXPENSE", color: "clay", icon: "Receipt", description: "Bank fees, card fees, overdraft charges, FX fees" },
  { name: "Cash", kind: "EXPENSE", color: "sand", icon: "Banknote", description: "ATM withdrawals" },
  { name: "Gifts & Donations", kind: "EXPENSE", color: "coral", icon: "Gift", description: "Gifts, charity, donations" },
  { name: "Kids & Family", kind: "EXPENSE", color: "peach", icon: "Baby", description: "Childcare, school activities, family expenses" },
  { name: "Pets", kind: "EXPENSE", color: "moss", icon: "PawPrint", description: "Vet, pet food, pet supplies" },
  { name: FALLBACK_EXPENSE, kind: "EXPENSE", color: "ash", icon: "CircleDashed", description: "Expenses that fit no other category" },
  { name: "Salary", kind: "INCOME", color: "emerald", icon: "BriefcaseBusiness", description: "Wages, payroll, bonuses" },
  { name: "Refunds", kind: "INCOME", color: "teal", icon: "Undo2", description: "Merchant refunds, reimbursements (e.g. CPAM, mutuelle)" },
  { name: "Investment Income", kind: "INCOME", color: "jade", icon: "TrendingUp", description: "Interest, dividends, capital gains" },
  { name: FALLBACK_INCOME, kind: "INCOME", color: "seafoam", icon: "Coins", description: "Any other incoming money" },
  {
    name: TRANSFER_CATEGORY,
    kind: "TRANSFER",
    color: "mist",
    icon: "ArrowLeftRight",
    description: "Moves between the user's own accounts, top-ups, currency exchanges",
  },
  {
    name: "Savings & Investments",
    kind: "TRANSFER",
    color: "indigo",
    icon: "PiggyBank",
    description: "Transfers into savings, brokerage, crypto, pension accounts",
  },
];

/**
 * Built-in keyword lexicon (lowest priority). Patterns are matched with CONTAINS against the
 * normalized description. Users can override any of these with their own or learned rules.
 */
export const SYSTEM_RULES: { pattern: string; category: string; direction?: "DEBIT" | "CREDIT" }[] = [
  // Groceries
  ...[
    "CARREFOUR",
    "LECLERC",
    "AUCHAN",
    "INTERMARCHE",
    "MONOPRIX",
    "FRANPRIX",
    "LIDL",
    "ALDI",
    "CASINO",
    "SUPER U",
    "HYPER U",
    "BIOCOOP",
    "NATURALIA",
    "PICARD",
    "GRAND FRAIS",
    "LA VIE CLAIRE",
    "SPAR",
    "NETTO",
    "G20",
    "COCCINELLE",
  ].map((p) => ({ pattern: p, category: "Groceries" })),
  // Dining
  ...[
    "UBER EATS",
    "UBER *EATS",
    "DELIVEROO",
    "JUST EAT",
    "MCDONALD",
    "BURGER KING",
    "KFC",
    "STARBUCKS",
    "PAUL ",
    "RESTAURANT",
    "BRASSERIE",
    "BOULANGERIE",
    "PIZZA",
    "SUSHI",
    "CAFE ",
    "COLUMBUS",
    "FIVE GUYS",
    "O TACOS",
    "DOMINOS",
    "PRET A MANGER",
    "BISTROT",
    "TRAITEUR",
    "CREPERIE",
  ].map((p) => ({ pattern: p, category: "Dining Out" })),
  // Transport
  ...[
    "UBER",
    "BOLT",
    "HEETCH",
    "G7",
    "RATP",
    "NAVIGO",
    "SNCF CONNECT",
    "TOTAL ENERGIES",
    "TOTALENERGIES",
    "ESSO",
    "SHELL",
    "AVIA",
    "LIME",
    "DOTT",
    "VELIB",
    "INDIGO",
    "SANEF",
    "VINCI AUTOROUTES",
    "APRR",
    "BLABLACAR",
    "GETAROUND",
    "TCL",
    "RTM",
    "TISSEO",
  ].map((p) => ({ pattern: p, category: "Transport", direction: "DEBIT" as const })),
  // Travel
  ...[
    "AIR FRANCE",
    "EASYJET",
    "RYANAIR",
    "TRANSAVIA",
    "VUELING",
    "BOOKING.COM",
    "BOOKING COM",
    "AIRBNB",
    "HOTEL",
    "EXPEDIA",
    "OUIGO",
    "TRAINLINE",
    "SNCF",
    "EUROSTAR",
    "LUFTHANSA",
    "KLM",
  ].map((p) => ({ pattern: p, category: "Travel", direction: "DEBIT" as const })),
  // Utilities
  ...[
    "EDF",
    "ENGIE",
    "TOTALENERGIES ELEC",
    "VEOLIA",
    "SUEZ",
    "FREE MOBILE",
    "FREE TELECOM",
    "ORANGE",
    "SFR",
    "BOUYGUES",
    "SOSH",
    "RED BY SFR",
    "EKWATEUR",
    "ENERCOOP",
  ].map((p) => ({ pattern: p, category: "Utilities", direction: "DEBIT" as const })),
  // Subscriptions
  ...[
    "NETFLIX",
    "SPOTIFY",
    "DISNEY PLUS",
    "DISNEYPLUS",
    "CANAL+",
    "CANAL PLUS",
    "DEEZER",
    "APPLE.COM/BILL",
    "APPLE COM BILL",
    "ICLOUD",
    "GOOGLE STORAGE",
    "GOOGLE ONE",
    "YOUTUBE PREMIUM",
    "AMAZON PRIME",
    "PRIME VIDEO",
    "CHATGPT",
    "OPENAI",
    "ANTHROPIC",
    "CLAUDE.AI",
    "MICROSOFT 365",
    "ADOBE",
    "DROPBOX",
    "NOTION",
    "GITHUB",
    "PLAYSTATION",
    "XBOX",
    "NINTENDO",
    "AUDIBLE",
    "MOLOTOV",
    "PARAMOUNT",
    "MAX.COM",
    "DAZN",
    "BEIN",
  ].map((p) => ({ pattern: p, category: "Subscriptions", direction: "DEBIT" as const })),
  // Shopping
  ...[
    "AMAZON",
    "AMZN",
    "FNAC",
    "DARTY",
    "BOULANGER",
    "ZARA",
    "H&M",
    "UNIQLO",
    "DECATHLON",
    "IKEA",
    "LEROY MERLIN",
    "CASTORAMA",
    "SEPHORA",
    "ZALANDO",
    "VINTED",
    "LEBONCOIN",
    "ALIEXPRESS",
    "SHEIN",
    "TEMU",
    "APPLE STORE",
    "ACTION",
    "KIABI",
    "PRIMARK",
  ].map((p) => ({ pattern: p, category: "Shopping", direction: "DEBIT" as const })),
  // Health
  ...["PHARMACIE", "PHARMA", "DOCTOLIB", "DENTISTE", "OPTIC", "LABORATOIRE", "MEDECIN", "HOPITAL", "CLINIQUE", "KINE"].map((p) => ({
    pattern: p,
    category: "Health",
    direction: "DEBIT" as const,
  })),
  // Entertainment
  ...["UGC", "PATHE", "GAUMONT", "MK2", "FNAC SPECTACLES", "TICKETMASTER", "STEAM", "EPIC GAMES", "SHOTGUN", "DICE.FM"].map((p) => ({
    pattern: p,
    category: "Entertainment",
    direction: "DEBIT" as const,
  })),
  // Personal care
  ...["BASIC FIT", "BASIC-FIT", "FITNESS PARK", "NEONESS", "CLUB MED GYM", "COIFF", "BARBER", "YVES ROCHER", "NOCIBE", "MARIONNAUD"].map((p) => ({
    pattern: p,
    category: "Personal Care",
    direction: "DEBIT" as const,
  })),
  // Insurance
  ...["ASSURANCE", "AXA", "MAIF", "MACIF", "MAAF", "MATMUT", "ALLIANZ", "GROUPAMA", "PACIFICA", "MUTUELLE", "GMF", "LUKO"].map((p) => ({
    pattern: p,
    category: "Insurance",
    direction: "DEBIT" as const,
  })),
  // Taxes
  ...["DGFIP", "IMPOT", "TRESOR PUBLIC", "FINANCES PUBLIQUES", "URSSAF", "ANTS"].map((p) => ({ pattern: p, category: "Taxes", direction: "DEBIT" as const })),
  // Fees
  ...["COTISATION", "FRAIS", "COMMISSION", "AGIOS", "OFFRE GLOBULE", "FEE", "INTERETS DEBITEURS"].map((p) => ({
    pattern: p,
    category: "Fees & Charges",
    direction: "DEBIT" as const,
  })),
  // Cash
  ...["RETRAIT DAB", "RETRAIT GAB", "RETRAIT", "CASH WITHDRAWAL", "CASH AT", "ATM"].map((p) => ({ pattern: p, category: "Cash", direction: "DEBIT" as const })),
  // Housing
  ...["LOYER", "FONCIA", "NEXITY", "ORPI", "SYNDIC", "CITYA", "ECHEANCE PRET", "PRET IMMO"].map((p) => ({
    pattern: p,
    category: "Housing",
    direction: "DEBIT" as const,
  })),
  // Pets
  ...["VETERINAIRE", "VETO", "MAXI ZOO", "ANIMALIS", "TRUFFAUT"].map((p) => ({ pattern: p, category: "Pets", direction: "DEBIT" as const })),
  // Gifts
  ...["UNICEF", "CROIX ROUGE", "MSF", "RESTOS DU COEUR", "LEETCHI", "LYDIA CAGNOTTE"].map((p) => ({
    pattern: p,
    category: "Gifts & Donations",
    direction: "DEBIT" as const,
  })),
  // Income
  ...["SALAIRE", "PAYROLL", "SALARY", "REMUNERATION"].map((p) => ({ pattern: p, category: "Salary", direction: "CREDIT" as const })),
  ...["REMBOURSEMENT", "REFUND", "AVOIR", "CPAM", "AMELI"].map((p) => ({ pattern: p, category: "Refunds", direction: "CREDIT" as const })),
  ...["INTERETS", "INTEREST", "DIVIDEND", "COUPON"].map((p) => ({ pattern: p, category: "Investment Income", direction: "CREDIT" as const })),
  // Transfers between own accounts
  ...[
    "TOP-UP",
    "TOP UP",
    "TOPUP",
    "EXCHANGED TO",
    "EXCHANGE TO",
    "TO EUR",
    "FROM EUR",
    "VIREMENT INTERNE",
    "VIR INTERNE",
    "APPLE PAY TOP",
    "POCKET",
    "VAULT",
  ].map((p) => ({ pattern: p, category: TRANSFER_CATEGORY })),
  ...[
    "LIVRET A",
    "LDDS",
    "ASSURANCE VIE",
    "BOURSORAMA BANQUE",
    "TRADE REPUBLIC",
    "DEGIRO",
    "BOURSE DIRECT",
    "COINBASE",
    "BINANCE",
    "KRAKEN",
    "YOMONI",
    "NALO",
    "SAVINGS",
    "EPARGNE",
  ].map((p) => ({ pattern: p, category: "Savings & Investments" })),
];

/** Default priority per source; learned corrections must beat everything else. */
export const PRIORITY = { LEARNED: 1000, USER: 500, AI: 200, SYSTEM: 100 } as const;
