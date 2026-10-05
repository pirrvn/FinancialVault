import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma's generated client and the pg driver must stay server-side, unbundled.
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
};

export default nextConfig;
