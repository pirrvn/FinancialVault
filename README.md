# FinanceVault

A private personal-finance and wealth dashboard for **Revolut** and **Crédit Agricole** statements. It imports monthly CSV exports, normalizes them into one ledger and categorizes every transaction through a three-tier pipeline (rules, then AI, then you). On top of that it shows net worth, cash flow, subscriptions, a forecast with what-if scenarios, and a Copilot you can ask questions about your money.

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS 4, shadcn-style components on Radix and cmdk, Recharts, PostgreSQL via Prisma 7, and the Google Gen AI SDK (Gemini).

---

## Quick start

```bash
# 1. Postgres (or point DATABASE_URL at your own instance)
docker compose up -d

# 2. Configure
cp .env.example .env            # set GEMINI_API_KEY to enable AI categorization, the AI PDF reader + Copilot

# 3. Install, migrate, run
npm install                     # also runs `prisma generate`
npm run db:deploy
npm run dev                     # http://localhost:3000
```

To try it without real statements, run `npm run samples`. It writes 12 months of realistic exports to `samples/`: one Revolut CSV plus monthly Crédit Agricole files in Windows-1252. Drop them on the **Import** page.

| Script | What it does |
| --- | --- |
| `npm test` | Vitest suite: parsers, merchant normalization, rule engine, pipeline, analytics, Copilot tool loop |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Production build |
| `npm run samples [YYYY-MM]` | Regenerate demo statements ending at the given month |
| `npm run format` | Prettier, with the Tailwind class sorter |

FinanceVault still works without an API key. Rules and the built-in lexicon categorize what they can, everything else gets a default category and is flagged for one-click review, and the Copilot shows a setup message.

---

## Directory structure

```
prisma/
  schema.prisma              Users, Accounts, Categories, CategorizationRules, Transactions, ImportBatches
  migrations/
src/
  app/
    (app)/                   Authenticated app shell (sidebar, ⌘K palette, Copilot drawer)
      page.tsx               Overview dashboard
      transactions/          Ledger with inline categorization
      insights/              Subscriptions, concentration, savings opportunities
      forecast/              3/6/12-month projection + what-if simulator
      rules/                 Rule management
      import/                Drag-and-drop ingestion + history
    api/
      upload/                POST multipart statements → ImportSummary[]
      copilot/               POST chat → streamed NDJSON events
      transactions/          GET list · PATCH /:id manual override (+ learning)
      rules/                 GET rules
  lib/
    parsers/                 revolut.ts · credit-agricole.ts · csv.ts (encoding/delimiter sniffing) · detection
    categorization/
      merchant.ts            Bank-noise stripping → stable merchant keys
      rules.ts               Rule compiler/matcher (priority, specificity, direction, account scope)
      pipeline.ts            The 3-tier pipeline (pure, dependency-injected AI)
      defaults.ts            Default categories + French/EU merchant lexicon
    ai/
      client.ts              Gemini client, model, error mapping
      extract-statement.ts   AI reader for unusual or scanned PDF statements (reconciled before import)
      categorize.ts          Tier 2: batched structured-output categorization
      copilot.ts             Copilot agent loop + tools over your data
    analytics/               summary (KPIs, series, balance curve) · recurring · concentration · opportunities · forecast
    services/                import · learning (override, reapply) · queries · user
    actions.ts               Server Actions (override, confirm, rules CRUD, categories, notes)
  components/
    ui/                      Button, Card, Input/Select/Kbd, Segmented, Sheet, Slider, Switch, Toast
    charts/                  Cash-flow, balance, bar lists, tooltip/legend, theme-token bridge
    dashboard/ transactions/ insights/ forecast/ rules/ import/ copilot/
tests/                       Vitest + fixtures (real-format Revolut/CA files)
scripts/generate-samples.ts  Demo statement generator
```

---

## How it works

### Ingestion

- **Revolut**: handles the current `Type,Product,Started Date,Completed Date,…` export (English or French headers) and the legacy `Paid Out/Paid In` format. Fees are netted into the amount. `REVERTED`/`DECLINED` rows are dropped. `PENDING` rows are skipped with a warning, because they change date and amount when they settle. Each product and currency pair becomes its own account (`Current:EUR`, `Current:USD`, …), and the statement's running balance becomes the account balance.
- **Crédit Agricole**: semicolon CSV, often **Windows-1252** (detected automatically), with `DD/MM/YYYY` dates, `1 234,56` amounts, labels that span several lines inside quotes, and a preamble. The account number and the `Solde au …` closing balance are read from the preamble. Both `Débit/Crédit` and signed `Montant` layouts work.
- **Crédit Agricole PDF statements** ("Relevé de compte", from Mes documents › e-relevés): the text layer is rebuilt into lines. Amounts are assigned to Débit or Crédit from their position under the column headers, labels that wrap onto several lines are joined, and the year of each `DD.MM` operation comes from the statement's closing date (December operations on a January statement land in the right year). Several accounts in one PDF (compte courant + livret) are supported. **Every PDF must reconcile**: ancien solde + operations = nouveau solde, to the cent. If it doesn't, or the PDF is scanned with no text, the Gemini reader takes over, and its result must reconcile too. A statement that doesn't add up is rejected; it's never imported silently.
- **Idempotent re-imports**: each row gets a fingerprint (account, day, amount, normalized label, and an occurrence index for identical same-day rows). Re-uploading a statement, or uploading overlapping ones, never duplicates anything.
- **Balances only move forward**: importing an older statement never rewinds an account's balance.

### Categorization: the zero-uncategorized guarantee

1. **Rules.** Every transaction is checked against compiled rules ordered by priority: **learned** (1000) › **yours** (500) › **AI** (200) › **built-in lexicon** (100). Ties go to the longer, more specific pattern, so `UBER EATS` beats `UBER`. `CONTAINS` matches at word starts, so `FEE` doesn't match `COFFEE`. Rules can be limited to money in or money out, and to one account.
2. **AI.** Transactions that are still unmatched are grouped by *merchant and direction* and sent to Gemini in batches, using structured outputs with the category list as an enum. That's one decision per merchant, not per row. The model's category must agree with the money direction, so an expense can't land in Salary. Answers with ≥ 0.7 confidence are **saved as AI rules**, so the same merchant is never sent twice. Answers below 0.85 are flagged for review.
3. **Fallback + you.** Anything still unresolved, including when there's no API key or the API is down, is assigned *Miscellaneous* or *Other income* and flagged. Fixing it in the table takes one click (or the keyboard: `C`). That **creates a learned merchant rule** and, by default, re-categorizes every similar transaction that you haven't already set manually.

Merchant keys come from `merchant.ts`, which strips the noise French banks wrap around merchant names (`PAIEMENT PAR CARTE X1234 … 04/02`, `PRLV SEPA … MDT/…`, `VIR SEPA RECU /DE … /MOTIF …`, card masks, dates, references). That way `CB CARREFOUR CITY 12/03` and `PAIEMENT PAR CARTE X4821 CARREFOUR CITY 04/02` both become `CARREFOUR CITY`.

### Analytics

- **KPIs** are anchored on a selectable month. Net worth is the sum of statement balances, rolled forward by any later transactions. Cash flow covers the month. Savings rate and burn rate use a trailing 3-month window, and runway is net worth divided by burn rate. Transfers between your own accounts and into savings never count as income or spending. Refunds booked in an expense category reduce that category's spend.
- **Recurring detection** looks at intervals per merchant (weekly, monthly, quarterly, yearly, with tolerances and a ≥ 70 % regularity requirement) and at amount stability (median absolute deviation). It reports active vs stopped charges, next expected date, monthly and yearly cost, and price increases.
- **Savings opportunities** cover overlapping services (e.g. two video streaming apps), price increases, category spikes vs the trailing average, bank fees, merchant concentration (HHI), and the load from discretionary subscriptions. Each is ranked by estimated yearly savings.
- **Forecast** splits history into committed flows (detected recurring income and expenses) and variable spend (the median per category over 6 months). It projects 3, 6 or 12 months with inflation and an ~80 % band derived from the volatility of monthly net cash flow. The what-if simulator (income and spend sliders, per-category changes, cancelling subscriptions, one-off or recurring events) runs **in the browser**, so results update instantly.

### Copilot

The drawer (`⌘J`, or type a question into `⌘K`) streams answers from Gemini. Gemini doesn't receive your raw ledger. Instead it calls tools that run on the server against your data:

- `query_transactions` filters by date, category, kind, bank and merchant, with totals and grouping
- `get_financial_overview`
- `get_subscriptions_and_savings`
- `run_forecast` (what-if parameters)

So an answer like *"how much did I spend on dining out across both banks this month?"* is computed, not estimated. The model's turns are replayed unchanged within a turn (Gemini needs its thought signatures back), and safety blocks or truncation are reported instead of failing silently.

### Design system

Apple-inspired: system font stack (SF Pro on Apple devices), `rounded-3xl` cards with hairline shadows, glass sidebar and sheets, iOS segmented controls and switches, restrained motion (all animations respect `prefers-reduced-motion`), and dark mode tuned separately from light mode rather than inverted. Category colors are muted tones used **only next to an icon and a text label**. Charts encode series with a colorblind-validated blue/orange pair. Part-to-whole breakdowns use directly-labelled bar lists instead of donuts, so identity never depends on color alone.

**Keyboard**: `⌘K` command palette · `⌘J` Copilot · `G` then `O/T/I/F/R/U` to navigate · in Transactions: `/` search, `J/K` move, `C` or `↵` categorize, `Y` confirm, `O` details.

---

## Deploying (Vercel + Neon)

The app is ready for Vercel with a Neon Postgres database:

1. On [vercel.com](https://vercel.com), import this GitHub repository.
2. Under **Environment Variables**, add `FINANCEVAULT_PASSWORD`, `AUTH_SECRET` (a random string of at least 32 characters) and, optionally, `GEMINI_API_KEY`. Then deploy.
3. In the project's **Storage** tab, create a **Neon** database and connect it to the project. This sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct).
4. Redeploy. The `vercel-build` script (`scripts/vercel-build.mjs`) applies migrations through the direct connection, then builds. Before a database is connected it skips migrations, so the first deploy still succeeds.

Uploads are sent one file per request, because Vercel caps request bodies at 4.5 MB.

On iPhone, open the site in Safari and use **Share › Add to Home Screen**. It then opens full-screen with its own icon.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `GEMINI_API_KEY` | — | Enables AI categorization, the AI PDF reader and the Copilot. Get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). |
| `FINANCEVAULT_AI_MODEL` | `gemini-3.8-flash` | Gemini model used for every AI feature |
| `FINANCEVAULT_USER_EMAIL` | `owner@financevault.local` | Identity of the single owner (see below) |
| `FINANCEVAULT_PASSWORD` | — | Password for the sign-in screen. **Required in production**: without it the app refuses to serve any data. Optional locally (no password, no login screen). |
| `AUTH_SECRET` | — | Random string (≥ 32 characters) that signs session cookies. Required in production. Changing it, or the password, signs everyone out. |
| `DATABASE_URL_UNPOOLED` | — | Optional direct connection used for migrations (set automatically by the Vercel/Neon integration). |

## Privacy

Statement files are parsed on your server and aren't sent anywhere, except a PDF the built-in reader can't reconcile, which goes to Gemini only if a key is set. With AI enabled, the categorizer sends Google only *unrecognized* merchants: normalized name, up to three sample descriptions, direction, typical amount and bank. The Copilot sends your question plus the aggregated tool results it asks for. Nothing is sent when no API key is set. **On Google's free tier, prompts and responses may be used to improve Google's products**; enable billing on the API key's project (the paid tier) to opt out.

## Current limitations

- **Single user, single password.** A sign-in screen protects every page, API route and server action: `src/proxy.ts` checks the session first, then `getCurrentUser()` checks it again. Sessions are signed, HTTP-only cookies that last 30 days. Every query is already scoped by `userId`, so going multi-tenant means swapping in an auth provider (Auth.js, Clerk, …) inside `getCurrentUser()`. Failed logins are slowed down, but there's no per-IP lockout: use a long password.
- **Formats**: Revolut CSV; Crédit Agricole PDF or CSV. Revolut PDFs and Crédit Agricole Excel/OFX exports aren't supported. The PDF reader was built from the public layout of Crédit Agricole statements and tested on synthetic statements; if a real statement doesn't reconcile, the AI reader or the error message will say so.
- **One base currency.** Analytics use the base currency (EUR). Accounts in other currencies (e.g. a Revolut USD pocket) are listed with their balance but not converted.
- The forecast is a statistical projection from your own history, not financial advice.
