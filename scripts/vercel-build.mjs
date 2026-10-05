// Build entry point used by Vercel (`vercel-build` script).
// Applies pending database migrations when a database is connected, then builds the app.
import "dotenv/config";
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

if (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL) {
  run("npx prisma migrate deploy");
} else {
  console.warn("⚠ No DATABASE_URL yet: skipping migrations. Connect a database, then redeploy.");
}
run("npx next build");
