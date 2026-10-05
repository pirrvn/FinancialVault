import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations need a direct connection; hosted Postgres (e.g. Neon via Vercel) exposes it as
    // DATABASE_URL_UNPOOLED, while the app itself uses the pooled DATABASE_URL at runtime.
    url: process.env["DATABASE_URL_UNPOOLED"] ?? process.env["DATABASE_URL"],
  },
});
